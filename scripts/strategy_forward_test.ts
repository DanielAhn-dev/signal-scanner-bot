/**
 * 전략 경쟁 측정 실행 (src/services/strategyForwardTest.ts).
 *
 *   pnpm ops:forward-test                          # 운영 시작일(2026-09-28) 이후 전향 검증
 *   pnpm ops:forward-test -- --start=2025-11-03    # 과거 기준일(백테스트)
 *   pnpm ops:forward-test -- --record              # 오늘 실적 관문 판정·봇 평가액 저장 + 웹 결과 갱신 (매일)
 *   pnpm ops:forward-test -- --telegram            # --record + 결과를 TELEGRAM_ADMIN_CHAT_ID로 전송 (금요일)
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { isExchangeTradedProduct } from "../src/lib/securitiesTax";
import { fetchEtfDistributions } from "../src/services/etfDistribution";
import { computeFlowScore, pickHeavyNetSelling } from "../src/services/investorFlowFilter";
import { fetchFundamentalGateResults } from "../src/services/fundamentalQualityGate";
import { buildPromotionKeyboard } from "../src/services/strategyPromotion";
import { PROFILE_CODES, fetchNaverCloses, simulateAllCoreProfiles, type CloseBar } from "../src/services/coreProfiles";
import {
  buildGoalTrackerView,
  fetchAccountEquity,
  fetchMonthRealized,
  formatGoalLine,
  loadGoalFile,
  recordGoalEquity,
} from "../src/services/goalTracker";
import {
  GATE_CORE_SLOTS,
  planGateCoreRebalance,
  resolveGateCoreSlotBudget,
  selectGateCoreTargets,
} from "../src/services/gateCoreStrategy";
import {
  firstTradingDaysOfWeeks,
  firstTradingDaysOfMonths,
  pickSnapshotOnOrBefore,
  simulateBotAccount,
  computeBotCapture,
  detectBotEquityJump,
  simulateGateCore,
  reviewStrategies,
  FORWARD_TEST_GATE_DIR,
  FORWARD_TEST_BOT_EQUITY_DIR,
  INDEX_CORE_SMA_WINDOW,
  type GateSnapshot,
  type BotEquitySnapshot,
  formatForwardTestReport,
  buildDistributionNetPerShareByDate,
  simulateIndexStrategies,
  simulateOrderSheetStrategy,
  simulateWeeklyStrategy,
  FORWARD_TEST_RESULT_PATH,
  type ForwardTestSnapshot,
  type SavedOrderSheet,
  type DailyBar,
  type StrategyResult,
} from "../src/services/strategyForwardTest";

const arg = (name: string, fallback: string) =>
  process.argv.find((x) => x.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
const START = arg("start", "2026-09-28");
const SEND_TELEGRAM = process.argv.includes("--telegram");
const RECORD = SEND_TELEGRAM || process.argv.includes("--record");
// 이미 기록된 그날 관문·봇 평가액을 다시 쓴다(기록을 바로잡을 때만)
const OVERWRITE = process.argv.includes("--overwrite");

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function fetchPaged<T>(build: (from: number, to: number) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return out;
  }
}

function shiftDate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

async function loadOrderSheets(start: string): Promise<SavedOrderSheet[]> {
  const bucket = supabase.storage.from("market-snapshots");
  const { data: files } = await bucket.list("order-sheets", { limit: 1000 });
  const sheets: SavedOrderSheet[] = [];
  for (const f of files ?? []) {
    const asof = f.name.replace(/\.json$/, "");
    if (asof < shiftDate(start, -7)) continue; // 기준일 직전 금요일 주문표부터
    const { data } = await bucket.download(`order-sheets/${f.name}`);
    if (!data) continue;
    try {
      sheets.push(JSON.parse(await data.text()) as SavedOrderSheet);
    } catch {
      console.warn(`주문표 파싱 실패: ${f.name}`);
    }
  }
  return sheets;
}

/** Storage 폴더의 날짜별 JSON 스냅샷을 모두 읽는다 */
async function loadDatedSnapshots<T>(dir: string, from: string): Promise<T[]> {
  const bucket = supabase.storage.from("market-snapshots");
  const { data: files } = await bucket.list(dir, { limit: 1000 });
  const out: T[] = [];
  for (const f of files ?? []) {
    if (f.name.replace(/\.json$/, "") < from) continue;
    const { data } = await bucket.download(`${dir}/${f.name}`);
    if (!data) continue;
    try {
      out.push(JSON.parse(await data.text()) as T);
    } catch {
      console.warn(`스냅샷 파싱 실패: ${dir}/${f.name}`);
    }
  }
  return out;
}

async function uploadJson(path: string, value: unknown): Promise<void> {
  const { error } = await supabase.storage
    .from("market-snapshots")
    .upload(path, JSON.stringify(value), { upsert: true, contentType: "application/json" });
  if (error) console.warn(`저장 실패 ${path}: ${error.message}`);
}

/** 관리자 봇 계좌 평가액 — 목표 트래커와 같은 계산(goalTracker.fetchAccountEquity) */
function adminChatId(): number | null {
  const id = Number(process.env.TELEGRAM_ADMIN_CHAT_ID);
  return Number.isFinite(id) && id !== 0 ? id : null;
}

async function readBotEquity(date: string): Promise<BotEquitySnapshot | null> {
  const chatId = adminChatId();
  if (!chatId) return null;
  const eq = await fetchAccountEquity(supabase, chatId, date);
  return eq ? { date, seed: eq.seed, total: eq.total, realized: eq.realized } : null;
}

async function main(): Promise<void> {
  const loadFrom = shiftDate(START, -220);
  const { data: stocks } = await supabase
    .from("stocks")
    .select("code, name")
    .in("universe_level", ["core", "extended"]);
  const universe = (stocks ?? [])
    .filter((s: any) => !isExchangeTradedProduct(s.code, s.name))
    .map((s: any) => String(s.code));
  const membershipRows = await fetchPaged<any>((a, b) =>
    supabase
      .from("universe_membership_daily")
      .select("trade_date, code, name, universe_level, is_active")
      .gte("trade_date", loadFrom)
      .order("trade_date")
      .order("code")
      .range(a, b)
  ).catch(() => []);
  const membershipByDate = new Map<string, string[]>();
  for (const row of membershipRows) {
    if (!row.is_active || !["core", "extended"].includes(String(row.universe_level))) continue;
    if (isExchangeTradedProduct(row.code, row.name)) continue;
    const date = String(row.trade_date).slice(0, 10);
    const codes = membershipByDate.get(date) ?? [];
    codes.push(String(row.code));
    membershipByDate.set(date, codes);
  }
  const membershipDates = [...membershipByDate.keys()].sort();
  const membershipSets = new Map<string, Set<string>>();
  const universeFallback = new Set(universe);
  const universeAtCache = new Map<string, Set<string>>();
  const universeSetAt = (asof: string): Set<string> => {
    const cached = universeAtCache.get(asof);
    if (cached) return cached;
    let snapshot: string | undefined;
    for (const date of membershipDates) {
      if (date > asof) break;
      snapshot = date;
    }
    let set = universeFallback;
    if (snapshot) {
      set = membershipSets.get(snapshot) ?? new Set(membershipByDate.get(snapshot)!);
      membershipSets.set(snapshot, set);
    }
    universeAtCache.set(asof, set);
    return set;
  };
  const universeAt = (asof: string): string[] => [...universeSetAt(asof)];

  const priceRows = await fetchPaged<any>((a, b) =>
    supabase
      .from("stock_daily")
      .select("ticker, date, open, high, low, close, volume")
      .gte("date", loadFrom)
      .order("ticker")
      .order("date")
      .range(a, b)
  );
  const barsByCode = new Map<string, Map<string, DailyBar>>();
  const seriesByCode = new Map<string, DailyBar[]>();
  for (const r of priceRows) {
    const bar = {
      date: String(r.date).slice(0, 10),
      open: +r.open,
      high: +r.high,
      low: +r.low,
      close: +r.close,
      volume: +r.volume,
    };
    const m = barsByCode.get(r.ticker) ?? new Map<string, DailyBar>();
    m.set(bar.date, bar);
    barsByCode.set(r.ticker, m);
    const s = seriesByCode.get(r.ticker) ?? [];
    s.push(bar);
    seriesByCode.set(r.ticker, s);
  }
  const index = seriesByCode.get("069500") ?? [];
  const cdSeries = seriesByCode.get("459580") ?? []; // KODEX CD금리액티브(합성) 실제 가격
  const kodex200Distributions = await fetchEtfDistributions("069500").catch(() => []);
  const distributionNetPerShareByDate = buildDistributionNetPerShareByDate(kodex200Distributions);
  const tradingDates = index.map((b) => b.date);
  const endDate = tradingDates[tradingDates.length - 1];
  const inRange = tradingDates.filter((d) => d >= START);
  if (inRange.length < 2) {
    console.log(`기준일 ${START} 이후 거래일이 부족합니다 (최신 ${endDate}). 며칠 뒤 다시 실행하세요.`);
    return;
  }
  const rebalanceDates = firstTradingDaysOfWeeks(inRange);
  if (rebalanceDates[rebalanceDates.length - 1] !== endDate) rebalanceDates.push(endDate);
  const prevTradingDate = (d: string) => tradingDates[tradingDates.indexOf(d) - 1];

  const flowRows = await fetchPaged<any>((a, b) =>
    supabase
      .from("investor_daily")
      .select("ticker, date, foreign_amount, institution_amount, collection_status")
      .gte("date", shiftDate(START, -40))
      .order("ticker")
      .order("date")
      .range(a, b)
  );
  const flowsByCode = new Map<string, Array<{ date: string; foreign: number; institution: number; collectionStatus: string | null }>>();
  for (const r of flowRows) {
    const list = flowsByCode.get(r.ticker) ?? [];
    const collectionStatus = r.collection_status == null ? null : String(r.collection_status);
    if (collectionStatus && collectionStatus !== "ok") continue;
    list.push({ date: String(r.date).slice(0, 10), foreign: +(r.foreign_amount ?? 0), institution: +(r.institution_amount ?? 0), collectionStatus });
    flowsByCode.set(r.ticker, list);
  }

  const scoreCache = new Map<string, string[]>();
  async function topScores(asof: string): Promise<string[]> {
    if (scoreCache.has(asof)) return scoreCache.get(asof)!;
    const { data } = await supabase
      .from("scores")
      .select("code, score")
      .eq("asof", asof)
      .order("score", { ascending: false })
      .limit(80);
    const codes = ((data ?? []) as any[]).map((r) => String(r.code)).filter((c) => universeSetAt(asof).has(c));
    scoreCache.set(asof, codes);
    return codes;
  }

  // 봇 신규 매수 기준과 같은 코스피 50일선 (당일 종가 vs 직전 50일 평균)
  const trendUp = (asof: string): boolean => {
    const i = tradingDates.indexOf(asof);
    if (i < INDEX_CORE_SMA_WINDOW) return false;
    const prev = index.slice(i - INDEX_CORE_SMA_WINDOW, i).map((b) => b.close);
    return index[i].close > prev.reduce((s, v) => s + v, 0) / prev.length;
  };

  const heavySellingAt = (asof: string): Set<string> => {
    const scores = new Map<string, number>();
    for (const code of universeAt(asof)) {
      const flows = (flowsByCode.get(code) ?? []).filter((f) => f.date <= asof);
      const bars = (seriesByCode.get(code) ?? []).filter((b) => b.date <= asof).slice(-20);
      if (bars.length < 10) continue;
      const tv = bars.reduce((s, b) => s + b.close * b.volume, 0) / bars.length;
      const score = computeFlowScore({ flows, avgTradedValue: tv });
      if (score != null) scores.set(code, score);
    }
    return new Set(pickHeavyNetSelling(scores).keys());
  };

  const momentumTop = (asof: string): string[] => {
    const ranked: Array<[string, number]> = [];
    for (const code of universeAt(asof)) {
      const bars = (seriesByCode.get(code) ?? []).filter((b) => b.date <= asof);
      // 단기 반짝 상승을 피하고, 최근 21일을 제외한 63·126일 중기 모멘텀을 결합한다.
      if (bars.length < 149) continue;
      const tv = bars.slice(-20).reduce((s, b) => s + b.close * b.volume, 0) / 20;
      if (tv < 3e9) continue; // 하루 평균 거래대금 30억 미만 제외
      const recentEnd = bars.length - 22;
      const return63 = bars[recentEnd].close / bars[recentEnd - 63].close - 1;
      const return126 = bars[recentEnd].close / bars[recentEnd - 126].close - 1;
      const ret = return63 * 0.6 + return126 * 0.4;
      ranked.push([code, ret]);
    }
    return ranked.sort((a, b) => b[1] - a[1]).map(([c]) => c);
  };

  const breakoutTop = (asof: string): string[] => {
    const ranked: Array<[string, number]> = [];
    for (const code of universeAt(asof)) {
      const bars = (seriesByCode.get(code) ?? []).filter((b) => b.date <= asof);
      if (bars.length < 56) continue;
      const recent = bars[bars.length - 1];
      const prior = bars.slice(-56, -1);
      const breakoutLevel = Math.max(...prior.map((b) => b.high ?? b.close));
      const avgVolume = bars.slice(-21, -1).reduce((s, b) => s + b.volume, 0) / 20;
      if (!(recent.close > breakoutLevel) || !(avgVolume > 0) || recent.volume < avgVolume * 1.5) continue;
      const trueRanges = bars.slice(-15).map((b, i, sample) => {
        const previousClose = sample[i - 1]?.close ?? b.close;
        return Math.max(b.high ?? b.close, previousClose) - Math.min(b.low ?? b.close, previousClose);
      });
      const atr = trueRanges.reduce((s, value) => s + value, 0) / trueRanges.length;
      const atrPct = recent.close > 0 ? atr / recent.close : 0;
      if (!(atrPct > 0) || atrPct > 0.12) continue;
      ranked.push([code, (recent.close / breakoutLevel - 1) + Math.min(recent.volume / avgVolume, 4) * 0.01]);
    }
    return ranked.sort((a, b) => b[1] - a[1]).map(([c]) => c);
  };

  // 주간 전략별 종목 선택 (결정은 전 거래일 데이터로)
  const picks = new Map<string, Record<string, string[]>>();
  for (const d0 of rebalanceDates) {
    const asof = prevTradingDate(d0);
    const scored = asof ? await topScores(asof) : [];
    const heavy = asof ? heavySellingAt(asof) : new Set<string>();
    picks.set(d0, {
      "score-top5": scored.slice(0, 5),
      "score-top5+trend": asof && trendUp(asof) ? scored.slice(0, 5) : [],
      "score-top5+flow": scored.filter((c) => !heavy.has(c)).slice(0, 5),
      "momentum-top5": asof ? momentumTop(asof).slice(0, 5) : [],
      "breakout-top5": asof ? breakoutTop(asof).slice(0, 5) : [],
    });
  }

  // 실적 관문 스냅샷: 운영 실행이면 오늘 판정을 먼저 저장한다
  const gateSnapshots = await loadDatedSnapshots<GateSnapshot>(FORWARD_TEST_GATE_DIR, shiftDate(START, -10));
  // 이미 저장된 날은 다시 쓰지 않는다: 휴장일 재실행·수동 재실행이 그 뒤에 적재된 실적·보유 상태로
  // 당시 기록을 바꾸면 전향 검증이 사후 값이 된다. 바로잡을 때만 --overwrite.
  if (RECORD && !OVERWRITE && gateSnapshots.some((g) => g.asof === endDate)) {
    console.log(`실적 관문 스냅샷 ${endDate}: 이미 기록됨 — 유지`);
  } else if (RECORD) {
    const gate = await fetchFundamentalGateResults(supabase, universe, `${endDate}T12:00:00+09:00`);
    const snap: GateSnapshot = {
      asof: endDate,
      pass: [...gate].filter(([, g]) => g.status === "pass").map(([c]) => c),
      fail: [...gate].filter(([, g]) => g.status === "fail").map(([c]) => c),
    };
    await uploadJson(`${FORWARD_TEST_GATE_DIR}/${endDate}.json`, snap);
    const i = gateSnapshots.findIndex((g) => g.asof === endDate);
    if (i >= 0) gateSnapshots[i] = snap;
    else gateSnapshots.push(snap);
    console.log(`실적 관문 스냅샷 ${endDate}: 통과 ${snap.pass.length} · 탈락 ${snap.fail.length}`);
  }
  const gatePassAt = (asof: string): string[] => pickSnapshotOnOrBefore(gateSnapshots, asof)?.pass ?? [];
  const monthlyDates = firstTradingDaysOfMonths(inRange);
  if (monthlyDates[monthlyDates.length - 1] !== endDate) monthlyDates.push(endDate);

  // 봇 실제 계좌
  const botPoints = await loadDatedSnapshots<BotEquitySnapshot>(FORWARD_TEST_BOT_EQUITY_DIR, START);
  const botEquityWarnings: string[] = [];
  if (RECORD && !OVERWRITE && botPoints.some((p) => p.date === endDate)) {
    console.log(`봇 평가액 ${endDate}: 이미 기록됨 — 유지`);
  } else if (RECORD) {
    const today = await readBotEquity(endDate);
    const jump = today ? detectBotEquityJump(botPoints, today) : null;
    if (jump) {
      // 오염된 값을 남기면 최대낙폭·포착률이 영구히 틀어진다. 기록하지 않고 알린 뒤 원인(원장·현금)을 먼저 확인한다
      botEquityWarnings.push(`⚠️ ${jump} — 기록하지 않음. 원장·현금을 확인하세요.`);
      console.warn(botEquityWarnings[botEquityWarnings.length - 1]);
    } else if (today) {
      await uploadJson(`${FORWARD_TEST_BOT_EQUITY_DIR}/${endDate}.json`, today);
      // 목표 트래커도 같은 평가액을 매일 쌓는다
      await recordGoalEquity(supabase, adminChatId()!, today).catch((e) => console.warn(`목표 기록 실패: ${e}`));
      const i = botPoints.findIndex((p) => p.date === endDate);
      if (i >= 0) botPoints[i] = today;
      else botPoints.push(today);
    }
  }
  const botResult = simulateBotAccount({ points: botPoints, startDate: START });
  const botCapture = botResult ? computeBotCapture({ points: botPoints, startDate: START, index }) : null;
  if (botResult && botCapture) botResult.capture = botCapture;

  // 실적 관문 코어(봇 구현과 같은 함수): 점수 순서 전체가 필요해 상위 400개를 읽는다
  const rankedCache = new Map<string, string[]>();
  async function rankedScores(asof: string): Promise<string[]> {
    if (rankedCache.has(asof)) return rankedCache.get(asof)!;
    const { data } = await supabase
      .from("scores")
      .select("code, score")
      .eq("asof", asof)
      .order("score", { ascending: false })
      .limit(400);
    const codes = ((data ?? []) as any[]).map((r) => String(r.code)).filter((c) => universeSetAt(asof).has(c));
    rankedCache.set(asof, codes);
    return codes;
  }
  // 한 칸 예산은 관리자 봇 계좌 평가액 기준 (없으면 2천만원) — 1주 가격이 예산을 넘는 종목은 봇도 못 산다
  const latestBot = [...botPoints].sort((a, b) => a.date.localeCompare(b.date)).pop();
  const slotBudget = resolveGateCoreSlotBudget(latestBot?.total ?? 20_000_000);
  const gateCoreTargets = new Map<string, string[]>();
  for (const d0 of monthlyDates) {
    const asof = prevTradingDate(d0);
    if (!asof) continue;
    const prices = new Map<string, number>();
    for (const code of universeAt(asof)) {
      const bar = barsByCode.get(code)?.get(asof);
      if (bar && bar.close > 0) prices.set(code, bar.close);
    }
    gateCoreTargets.set(
      d0,
      selectGateCoreTargets({ rankedCodes: await rankedScores(asof), gatePass: new Set(gatePassAt(asof)), prices, slotBudget })
    );
  }

  const results: StrategyResult[] = [
    ...simulateIndexStrategies({ index, startDate: START, distributionNetPerShareByDate, cd: cdSeries }),
    ...(botResult ? [botResult] : []),
    simulateGateCore({
      rebalanceDates: monthlyDates,
      targetsAt: (d) => gateCoreTargets.get(d) ?? [],
      trendUpAt: (d) => {
        const asof = prevTradingDate(d);
        return asof ? trendUp(asof) : false;
      },
      barsByCode,
      slots: GATE_CORE_SLOTS,
      plan: planGateCoreRebalance,
    }),
    simulateWeeklyStrategy({
      name: "gate-monthly",
      rebalanceDates: monthlyDates,
      pick: (d) => (prevTradingDate(d) ? gatePassAt(prevTradingDate(d)) : []),
      barsByCode,
      topN: 10_000,
      periodsPerYear: 12,
    }),
    simulateWeeklyStrategy({
      name: "gate-monthly+trend50",
      rebalanceDates,
      // 종목 목록은 달이 바뀔 때만 갱신, 50일선 판정은 매주
      pick: (d) => {
        const asof = prevTradingDate(d);
        if (!asof || !trendUp(asof)) return [];
        const monthStart = [...monthlyDates].reverse().find((m) => m <= d) ?? d;
        return gatePassAt(prevTradingDate(monthStart) ?? asof);
      },
      barsByCode,
      topN: 10_000,
    }),
    ...(["score-top5", "score-top5+trend", "score-top5+flow", "momentum-top5", "breakout-top5"] as const).map((name) =>
      simulateWeeklyStrategy({ name, rebalanceDates, pick: (d) => picks.get(d)?.[name] ?? [], barsByCode })
    ),
  ];
  // 금요일 주문표(send_weekend_order_sheet.ts가 저장) — 저장된 주문표가 있을 때만 측정
  const sheets = await loadOrderSheets(START);
  if (sheets.length) {
    results.push(simulateOrderSheetStrategy({ sheets, tradingDates, barsByCode }));
  }
  // 코어 프로필(자산배분 후보): 네이버 수정주가(총수익)로 기준일부터 측정. 실패해도 나머지 측정은 계속한다
  try {
    const closesByCode = new Map<string, CloseBar[]>();
    for (const code of PROFILE_CODES) closesByCode.set(code, await fetchNaverCloses(code, shiftDate(START, -10)));
    results.push(...simulateAllCoreProfiles(closesByCode, START));
  } catch (e) {
    console.log(`코어 프로필 측정 생략: ${e instanceof Error ? e.message : String(e)}`);
  }
  const review = reviewStrategies({ results, measuredDays: inRange.length - 1 });
  // 목표 트래커 요약 (관리자 계좌)
  let goalLine = "";
  const goalChat = adminChatId();
  if (goalChat) {
    const now = await fetchAccountEquity(supabase, goalChat, endDate);
    if (now) {
      // 기록 모드가 아니면(로컬 확인) 저장하지 않고 읽기만 한다
      // 봇 평가액이 비정상 변동으로 기록 보류됐으면 목표 트래커에도 쓰지 않는다
      const file = RECORD && botEquityWarnings.length === 0
        ? await recordGoalEquity(supabase, goalChat, { date: now.date, seed: now.seed, total: now.total, realized: now.realized }).catch(() => null)
        : await loadGoalFile(supabase, goalChat).catch(() => null);
      if (file) {
        const realized = await fetchMonthRealized(supabase, goalChat, endDate);
        goalLine = formatGoalLine(buildGoalTrackerView({ file, now, realized }));
      }
    }
  }
  const report = [
    ...(botEquityWarnings.length ? [...botEquityWarnings, ""] : []),
    ...(goalLine ? [goalLine, ""] : []),
    formatForwardTestReport({ startDate: START, endDate, results }),
    "",
    "[승격·퇴출 판정]",
    ...review.lines,
  ].join("\n");
  console.log(report);

  // 웹 전략 화면이 읽을 수 있게 최신 결과를 저장한다 (운영 실행)
  if (RECORD) {
    const snapshot: ForwardTestSnapshot = { startDate: START, endDate, generatedAt: new Date().toISOString(), results, review };
    await uploadJson(FORWARD_TEST_RESULT_PATH, snapshot);
  }

  // 기록 보류 경고는 금요일이 아니어도 바로 알린다
  if (RECORD && !SEND_TELEGRAM && botEquityWarnings.length) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
    if (token && chatId) {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: `[전향 검증]\n${botEquityWarnings.join("\n")}` }),
      }).catch((e) => console.warn(`경고 전송 실패: ${e}`));
    }
  }

  if (SEND_TELEGRAM) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
    if (token && chatId) {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: report,
          // 승격 후보가 있을 때만 [승인] [보류] 버튼 (strategyPromotion.ts)
          ...(review.status === "propose" && review.candidates.length
            ? { reply_markup: { inline_keyboard: buildPromotionKeyboard(review.candidates) } }
            : {}),
        }),
      });
    } else {
      console.log("TELEGRAM_BOT_TOKEN / TELEGRAM_ADMIN_CHAT_ID 없음 — 전송 생략");
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
