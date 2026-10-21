import "../../src/lib/installTruncationGuard";
/**
 * 일일 배치 직후 결과 검증 — 오늘 거래일 데이터가 실제로, 충분히 적재됐는지 확인한다.
 *
 * 정합성 크론(KST 16:10)과 장 전 브리핑은 다음 날에야 지연을 알린다. 배치가 도중에 끊기거나(60분 제한)
 * 일부 종목만 적재하고 끝나도 워크플로 자체는 성공으로 보일 수 있어, 배치 바로 뒤에 한 번 더 확인해 즉시 알린다.
 *
 * 사용: pnpm exec tsx scripts/ops/verify_batch_result.ts   (이상이면 종료코드 1 + 텔레그램 관리자 알림)
 */
import "dotenv/config";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { checkDataFreshness } from "../../src/services/dataFreshnessMonitorService";
import { evaluateDailyDistribution, type DailyBar } from "../../src/services/dataDistributionCheck";
import { expectedTradingDay } from "../../src/services/batchVerifyDay";
import { nextKrxTradingDate, previousKrxTradingDate } from "../../src/lib/krxCalendar";
import {
  buildQualityAlert,
  buildWeeklyQualitySummary,
  evaluateQualityTrend,
  findBadNames,
  findLimitBreaches,
  findNewlyMissing,
  isLastTradingDayOfWeek,
  type DailyMetrics,
  type MetricSpec,
} from "../../src/services/dataQualityTrend";

/** 배치가 당일 거래일 값으로 채워야 하는 테이블. 수급·신용은 공급처 게시가 늦어 제외한다 */
const MUST_BE_TODAY = new Set(["ohlcv", "indicators", "scores"]);
/** 일부만 적재돼도 매수 게이트에 반영되지 않는 항목(dataFreshnessMonitorService.NON_GATING_KEYS와 같다). 실패 처리·알림 대상이 아니다 */
const NON_GATING_KEYS = new Set(["credit"]);

async function fetchBars(supabase: SupabaseClient, ymd: string): Promise<DailyBar[]> {
  const rows: DailyBar[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await supabase
      .from("stock_daily")
      .select("ticker, close, volume")
      .eq("date", ymd)
      .order("ticker")
      .range(off, off + 999);
    if (error) throw new Error(`stock_daily 조회 실패(${ymd}): ${error.message}`);
    rows.push(...((data ?? []) as DailyBar[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

/** 행 안의 상태까지 보는 품질 항목. floorShare는 유니버스 대비 만성 부족 기준 */
const QUALITY_SPECS: (MetricSpec & { table: string; column: string; filter?: [string, string] })[] = [
  { key: "ohlcv", label: "시세", table: "stock_daily", column: "date", floorShare: 0.95 },
  { key: "indicators", label: "기술지표", table: "daily_indicators", column: "trade_date", floorShare: 0.95 },
  { key: "scores", label: "종목 점수", table: "scores", column: "asof", floorShare: 0.9 },
  { key: "credit_volume_ok", label: "공매도 거래량(정상)", table: "stock_credit_short_daily", column: "date", filter: ["volume_status", "ok"], floorShare: 0.8 },
  // KRX 전용이고 하루 수십 종목 뒤 차단된다 — 하루치보다 아래 10거래일 누적 채움률(돌려받기 효과)이 중요하다
  { key: "credit_balance_ok", label: "공매도 잔고(KRX 정상)", table: "stock_credit_short_daily", column: "date", filter: ["balance_status", "ok"], trackOnly: true },
];

function nextDay(ymd: string): string {
  return new Date(Date.parse(`${ymd}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
}

async function countOn(supabase: SupabaseClient, spec: (typeof QUALITY_SPECS)[number], ymd: string): Promise<number | null> {
  let q = supabase.from(spec.table).select(spec.column, { count: "exact", head: true }).gte(spec.column, ymd).lt(spec.column, nextDay(ymd));
  if (spec.filter) q = q.eq(spec.filter[0], spec.filter[1]);
  const { count, error } = await q;
  return error ? null : count ?? null;
}

async function fetchAllPaged<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  what: string
): Promise<T[]> {
  const rows: T[] = [];
  for (let off = 0; ; off += 1000) {
    const { data, error } = await build(off, off + 999);
    if (error) throw new Error(`${what} 조회 실패: ${error.message}`);
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

async function sendTelegram(text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!token || !chatId) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
}

/**
 * 값의 질 점검(평소 대비 급감·가격제한폭 초과·새로 빠진 종목·이름 이상)과 주간 요약.
 * 경고만 하고 종료코드는 바꾸지 않는다 — 이 점검이 실패해도 배치 결과 판정을 흔들지 않게 호출부에서 감싼다.
 */
async function runQualityChecks(supabase: SupabaseClient, batchDay: string, latestBars: DailyBar[], prevBars: DailyBar[]) {
  const dates: string[] = [batchDay];
  while (dates.length < 8) dates.unshift(previousKrxTradingDate(dates[0]));

  // 날짜는 차례로, 항목만 동시에 센다(한 번에 40개 요청이 몰리지 않게)
  const history: DailyMetrics[] = [];
  for (const date of dates) {
    const counts = await Promise.all(QUALITY_SPECS.map((spec) => countOn(supabase, spec, date)));
    history.push({ date, values: Object.fromEntries(QUALITY_SPECS.map((spec, i) => [spec.key, counts[i]])) });
  }

  const universe = (
    await fetchAllPaged<{ code: string }>(
      (a, b) => supabase.from("stocks").select("code").in("universe_level", ["core", "extended"]).eq("is_active", true).order("code").range(a, b),
      "유니버스"
    )
  ).map((r) => r.code);
  const activeNames = await fetchAllPaged<{ code: string; name: string | null }>(
    (a, b) => supabase.from("stocks").select("code, name").eq("is_active", true).order("code").range(a, b),
    "종목 이름"
  );
  const since = previousKrxTradingDate(batchDay, 9);
  const balanceRows = await fetchAllPaged<{ code: string }>(
    (a, b) =>
      supabase.from("stock_credit_short_daily").select("code").gte("date", since).eq("balance_status", "ok").order("date").order("code").range(a, b),
    "공매도 잔고 이력"
  );
  const universeSet = new Set(universe);
  const balanceCovered = new Set(balanceRows.map((r) => r.code).filter((c) => universeSet.has(c))).size;

  const trend = evaluateQualityTrend(history, QUALITY_SPECS, universe.length || null);
  const balanceShare = universe.length ? balanceCovered / universe.length : 0;
  if (universe.length && balanceShare < 0.9) {
    trend.chronic.push({ key: "credit_balance_10d", label: "공매도 잔고 최근 10거래일 누적", latest: balanceCovered, share: balanceShare, floorShare: 0.9 });
  }

  const alert = buildQualityAlert({
    trend,
    limitBreaches: findLimitBreaches(latestBars, prevBars),
    newlyMissing: latestBars.length && prevBars.length ? findNewlyMissing(universe, latestBars.map((b) => b.ticker), prevBars.map((b) => b.ticker)) : [],
    badNames: findBadNames(activeNames),
    nameByCode: new Map(activeNames.filter((r) => r.name).map((r) => [r.code, String(r.name)])),
  });
  console.log(
    "품질 지표:",
    QUALITY_SPECS.map((q) => `${q.key}=${history[history.length - 1].values[q.key] ?? "?"}`).join(" "),
    `credit_balance_10d=${balanceCovered}/${universe.length}`
  );
  for (const c of trend.chronic) console.warn(`만성 부족: ${c.label} ${(c.share * 100).toFixed(0)}% (기준 ${(c.floorShare * 100).toFixed(0)}%)`);
  if (alert) {
    console.warn(alert);
    await sendTelegram(alert);
  }
  if (isLastTradingDayOfWeek(batchDay, nextKrxTradingDate(batchDay)) || process.env.QUALITY_WEEKLY_SUMMARY === "1") {
    await sendTelegram(buildWeeklyQualitySummary(history, QUALITY_SPECS, universe.length || null, trend.chronic));
  }
}

async function main() {
  // 배치가 자정을 넘겨 끝나거나 휴장일에 돌아도, 배치가 채웠어야 하는 거래일 기준으로 판단한다
  const batchDay = expectedTradingDay(new Date());

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.");

  const supabase = createClient(url, key);
  const report = await checkDataFreshness(supabase);

  // 날짜·행 수가 정상이어도 값이 이상할 수 있다(단위 변경, 동결, 거래량 0 채우기)
  const ohlcv = report.freshItems.concat(report.staleItems).find((i) => i.key === "ohlcv");
  const distributionIssues: string[] = [];
  let latestBars: DailyBar[] = [];
  let prevBars: DailyBar[] = [];
  if (ohlcv?.latestDate) {
    const { data: prevRow } = await supabase.from("stock_daily").select("date").lt("date", ohlcv.latestDate).order("date", { ascending: false }).limit(1).maybeSingle();
    const prevDate = prevRow ? String((prevRow as { date: string }).date).slice(0, 10) : null;
    if (prevDate) {
      [latestBars, prevBars] = await Promise.all([fetchBars(supabase, ohlcv.latestDate), fetchBars(supabase, prevDate)]);
      distributionIssues.push(...evaluateDailyDistribution(latestBars, prevBars).issues);
    }
  }
  try {
    await runQualityChecks(supabase, batchDay, latestBars, prevBars);
  } catch (e) {
    console.warn(`[품질 점검] 실패(무시): ${e instanceof Error ? e.message : String(e)}`);
  }
  const problems = [...report.freshItems, ...report.staleItems].filter(
    (i) => (i.isLowCoverage && !NON_GATING_KEYS.has(i.key)) || (MUST_BE_TODAY.has(i.key) && i.latestDate !== batchDay)
  );
  for (const i of [...report.freshItems, ...report.staleItems]) {
    if (i.isLowCoverage && NON_GATING_KEYS.has(i.key)) {
      console.warn(`참고: ${i.label} 일부만 적재(${i.latestCount ?? "?"}행, 직전 ${i.prevCount ?? "?"}행) — 매수 판단에 쓰이지 않아 알림 생략`);
    }
  }
  if (problems.length === 0 && distributionIssues.length === 0) {
    console.log("배치 결과 정상:", report.freshItems.map((i) => `${i.key}=${i.latestDate}(${i.latestCount ?? "?"}행)`).join(" "));
    return;
  }

  const lines = ["⚠️ <b>일일 배치 결과 이상</b>", "배치는 끝났지만 오늘 데이터가 충분히 적재되지 않았습니다.\n"];
  for (const p of problems) {
    const rows = p.latestCount != null && p.prevCount != null ? ` · ${p.latestCount}행 (직전 ${p.prevCount}행)` : "";
    lines.push(`• ${p.label}: 최근 ${p.latestDate ?? "없음"}${rows}`);
  }
  for (const issue of distributionIssues) lines.push(`• 시세 값 이상: ${issue}`);
  lines.push("\n→ 일부만 적재된 경우 신규 매수는 데이터 품질 게이트가 막습니다. GitHub Actions 로그를 확인하세요.");
  const text = lines.join("\n");
  console.error(text);

  await sendTelegram(text);
  process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
