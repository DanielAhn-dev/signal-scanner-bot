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

/** 배치가 당일 거래일 값으로 채워야 하는 테이블. 수급·신용은 공급처 게시가 늦어 제외한다 */
const MUST_BE_TODAY = new Set(["ohlcv", "indicators", "scores"]);

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
  if (ohlcv?.latestDate) {
    const { data: prevRow } = await supabase.from("stock_daily").select("date").lt("date", ohlcv.latestDate).order("date", { ascending: false }).limit(1).maybeSingle();
    const prevDate = prevRow ? String((prevRow as { date: string }).date).slice(0, 10) : null;
    if (prevDate) {
      const [latestBars, prevBars] = await Promise.all([fetchBars(supabase, ohlcv.latestDate), fetchBars(supabase, prevDate)]);
      distributionIssues.push(...evaluateDailyDistribution(latestBars, prevBars).issues);
    }
  }
  const problems = [...report.freshItems, ...report.staleItems].filter(
    (i) => i.isLowCoverage || (MUST_BE_TODAY.has(i.key) && i.latestDate !== batchDay)
  );
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

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (token && chatId) {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
  }
  process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
