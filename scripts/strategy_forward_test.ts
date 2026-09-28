/**
 * 전략 경쟁 측정 실행 (src/services/strategyForwardTest.ts).
 *
 *   pnpm ops:forward-test                          # 운영 시작일(2026-09-28) 이후 전향 검증
 *   pnpm ops:forward-test -- --start=2025-11-03    # 과거 기준일(백테스트)
 *   pnpm ops:forward-test -- --telegram            # 결과를 TELEGRAM_ADMIN_CHAT_ID로 전송
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { isExchangeTradedProduct } from "../src/lib/securitiesTax";
import { computeFlowScore, pickHeavyNetSelling } from "../src/services/investorFlowFilter";
import {
  firstTradingDaysOfWeeks,
  formatForwardTestReport,
  simulateIndexStrategies,
  simulateWeeklyStrategy,
  type DailyBar,
  type StrategyResult,
} from "../src/services/strategyForwardTest";

const arg = (name: string, fallback: string) =>
  process.argv.find((x) => x.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
const START = arg("start", "2026-09-28");
const SEND_TELEGRAM = process.argv.includes("--telegram");

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
      .select("ticker, date, open, close, volume")
      .gte("date", loadFrom)
      .order("ticker")
      .order("date")
      .range(a, b)
  );
  const barsByCode = new Map<string, Map<string, DailyBar>>();
  const seriesByCode = new Map<string, DailyBar[]>();
  for (const r of priceRows) {
    const bar = { date: String(r.date).slice(0, 10), open: +r.open, close: +r.close, volume: +r.volume };
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

  const trendUp = (asof: string): boolean => {
    const i = tradingDates.indexOf(asof);
    if (i < 100) return false;
    const closes = index.slice(i - 99, i + 1).map((b) => b.close);
    return index[i].close > closes.reduce((s, v) => s + v, 0) / closes.length;
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

  const results: StrategyResult[] = [
    ...simulateIndexStrategies({ index, startDate: START }),
    ...(["score-top5", "score-top5+trend", "score-top5+flow", "momentum-top5"] as const).map((name) =>
      simulateWeeklyStrategy({ name, rebalanceDates, pick: (d) => picks.get(d)?.[name] ?? [], barsByCode })
    ),
  ];
  const report = formatForwardTestReport({ startDate: START, endDate, results });
  console.log(report);

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
