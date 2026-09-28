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
import { computeFlowScore, pickHeavyNetSelling } from "../src/services/investorFlowFilter";
import { fetchFundamentalGateResults } from "../src/services/fundamentalQualityGate";
import {
  firstTradingDaysOfWeeks,
  firstTradingDaysOfMonths,
  pickSnapshotOnOrBefore,
  simulateBotAccount,
  reviewStrategies,
  FORWARD_TEST_GATE_DIR,
  FORWARD_TEST_BOT_EQUITY_DIR,
  INDEX_CORE_SMA_WINDOW,
  type GateSnapshot,
  type BotEquitySnapshot,
  formatForwardTestReport,
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

/** 관리자 봇 계좌 평가액 = 현금 + 보유 종목(스윕 포함) 종가 평가 */
async function readBotEquity(date: string): Promise<BotEquitySnapshot | null> {
  const chatId = Number(process.env.TELEGRAM_ADMIN_CHAT_ID);
  if (!Number.isFinite(chatId) || chatId === 0) return null;
  const { data: user } = await supabase.from("users").select("prefs").eq("tg_id", chatId).maybeSingle();
  const prefs = ((user as any)?.prefs ?? {}) as Record<string, unknown>;
  const seed = Number(prefs.virtual_seed_capital ?? prefs.capital_krw);
  const cash = Number(prefs.virtual_cash);
  if (!(seed > 0) || !Number.isFinite(cash)) return null;
  const { data: positions } = await supabase
    .from("virtual_positions")
    .select("code, quantity, buy_price, status, stock:stocks(close)")
    .eq("chat_id", chatId)
    .is("broker_name", null)
    .is("account_name", null);
  let holdings = 0;
  for (const row of (positions ?? []) as any[]) {
    if (String(row.status ?? "holding") === "closed") continue;
    const stock = Array.isArray(row.stock) ? row.stock[0] : row.stock;
    const price = Number(stock?.close) > 0 ? Number(stock.close) : Number(row.buy_price ?? 0);
    holdings += Math.max(0, Math.floor(Number(row.quantity ?? 0))) * Math.max(0, price);
  }
  return { date, seed, total: Math.round(cash + holdings) };
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
      .select("ticker, date, foreign_amount, institution_amount")
      .gte("date", shiftDate(START, -40))
      .order("ticker")
      .order("date")
      .range(a, b)
  );
  const flowsByCode = new Map<string, Array<{ date: string; foreign: number; institution: number }>>();
  for (const r of flowRows) {
    const list = flowsByCode.get(r.ticker) ?? [];
    list.push({ date: String(r.date).slice(0, 10), foreign: +(r.foreign_amount ?? 0), institution: +(r.institution_amount ?? 0) });
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
    const codes = ((data ?? []) as any[]).map((r) => String(r.code)).filter((c) => universe.includes(c));
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
    for (const code of universe) {
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
    for (const code of universe) {
      const bars = (seriesByCode.get(code) ?? []).filter((b) => b.date <= asof);
      if (bars.length < 66) continue;
      const tv = bars.slice(-20).reduce((s, b) => s + b.close * b.volume, 0) / 20;
      if (tv < 3e9) continue; // 하루 평균 거래대금 30억 미만 제외
      const ret = bars[bars.length - 6].close / bars[bars.length - 66].close - 1; // 60일 수익(최근 5일 제외)
      ranked.push([code, ret]);
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
    });
  }

  // 실적 관문 스냅샷: 운영 실행이면 오늘 판정을 먼저 저장한다
  const gateSnapshots = await loadDatedSnapshots<GateSnapshot>(FORWARD_TEST_GATE_DIR, shiftDate(START, -10));
  if (RECORD) {
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
  if (RECORD) {
    const today = await readBotEquity(endDate);
    if (today) {
      await uploadJson(`${FORWARD_TEST_BOT_EQUITY_DIR}/${endDate}.json`, today);
      const i = botPoints.findIndex((p) => p.date === endDate);
      if (i >= 0) botPoints[i] = today;
      else botPoints.push(today);
    }
  }
  const botResult = simulateBotAccount({ points: botPoints, startDate: START });

  const results: StrategyResult[] = [
    ...simulateIndexStrategies({ index, startDate: START }),
    ...(botResult ? [botResult] : []),
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
    ...(["score-top5", "score-top5+trend", "score-top5+flow", "momentum-top5"] as const).map((name) =>
      simulateWeeklyStrategy({ name, rebalanceDates, pick: (d) => picks.get(d)?.[name] ?? [], barsByCode })
    ),
  ];
  // 금요일 주문표(send_weekend_order_sheet.ts가 저장) — 저장된 주문표가 있을 때만 측정
  const sheets = await loadOrderSheets(START);
  if (sheets.length) {
    results.push(simulateOrderSheetStrategy({ sheets, tradingDates, barsByCode }));
  }
  const review = reviewStrategies({ results, measuredDays: inRange.length - 1 });
  const report = [formatForwardTestReport({ startDate: START, endDate, results }), "", "[승격·퇴출 판정]", ...review.lines].join("\n");
  console.log(report);

  // 웹 전략 화면이 읽을 수 있게 최신 결과를 저장한다 (운영 실행)
  if (RECORD) {
    const snapshot: ForwardTestSnapshot = { startDate: START, endDate, generatedAt: new Date().toISOString(), results, review };
    await uploadJson(FORWARD_TEST_RESULT_PATH, snapshot);
  }

  if (SEND_TELEGRAM) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
    if (token && chatId) {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: chatId, text: report }),
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
