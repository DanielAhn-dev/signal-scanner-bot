/**
 * 수급(외국인·기관 순매수) 팩터 백테스트.
 *
 * 매일 종목별 최근 N일 외국인·기관 순매수 금액 / 20일 평균 거래대금으로 점수를 매기고 5분위로 나눈 뒤,
 * 다음 날 시가 진입 → h세션 뒤 종가 청산 수익(왕복비용 차감)을 같은 날 전체 평균 대비 초과수익으로 비교한다.
 * 기간을 전반(IS)·후반(OOS)으로 나눠 두 구간 모두에서 단조로운지 본다.
 *
 *   pnpm dlx tsx scripts/backtest_investor_flow.ts
 *   pnpm dlx tsx scripts/backtest_investor_flow.ts --window=10 --who=foreign
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

type Bar = { date: string; open: number; close: number; volume: number };
type Flow = { date: string; foreign: number; institution: number };

const arg = (name: string, fallback: string) =>
  process.argv.find((x) => x.startsWith(`--${name}=`))?.split("=")[1] ?? fallback;
const WINDOW = Number(arg("window", "5"));
const WHO = arg("who", "both"); // both | foreign | institution
const HORIZONS = [5, 10, 20];
const COST_PCT = 0.45;

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function fetchAll<T>(table: string, select: string, order: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(select).order(order).order("date").range(from, from + 999);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return out;
  }
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN;
}

async function main(): Promise<void> {
  const { data: stocks } = await supabase.from("stocks").select("code").in("universe_level", ["core", "extended"]);
  const universe = new Set((stocks ?? []).map((s: any) => String(s.code)));
  const prices = (await fetchAll<any>("stock_daily", "ticker,date,open,close,volume", "ticker")).filter((r) =>
    universe.has(r.ticker)
  );
  const flows = (await fetchAll<any>("investor_daily", "ticker,date,foreign_amount,institution_amount", "ticker")).filter(
    (r) => universe.has(r.ticker)
  );

  const barsBy = new Map<string, Bar[]>();
  for (const r of prices) {
    const list = barsBy.get(r.ticker) ?? [];
    list.push({ date: String(r.date).slice(0, 10), open: +r.open, close: +r.close, volume: +r.volume });
    barsBy.set(r.ticker, list);
  }
  const flowBy = new Map<string, Map<string, Flow>>();
  for (const r of flows) {
    const m = flowBy.get(r.ticker) ?? new Map<string, Flow>();
    m.set(String(r.date).slice(0, 10), {
      date: String(r.date).slice(0, 10),
      foreign: Number(r.foreign_amount ?? 0),
      institution: Number(r.institution_amount ?? 0),
    });
    flowBy.set(r.ticker, m);
  }

  // 날짜별 (종목, 점수, h별 수익)
  const byDate = new Map<string, Array<{ score: number; rets: (number | null)[] }>>();
  for (const [ticker, bars] of barsBy) {
    bars.sort((a, b) => a.date.localeCompare(b.date));
    const fmap = flowBy.get(ticker);
    if (!fmap) continue;
    for (let i = 20; i < bars.length - 1; i += 1) {
      let flowSum = 0;
      let have = 0;
      for (let k = i - WINDOW + 1; k <= i; k += 1) {
        const f = fmap.get(bars[k].date);
        if (!f) continue;
        have += 1;
        flowSum += WHO === "foreign" ? f.foreign : WHO === "institution" ? f.institution : f.foreign + f.institution;
      }
      if (have < WINDOW) continue;
      let tv = 0;
      for (let k = i - 19; k <= i; k += 1) tv += bars[k].close * bars[k].volume;
      tv /= 20;
      if (!(tv > 0)) continue;
      const entry = bars[i + 1].open > 0 ? bars[i + 1].open : bars[i + 1].close;
      const rets = HORIZONS.map((h) => {
        const exitBar = bars[i + h];
        if (!exitBar || !(entry > 0) || !(exitBar.close > 0)) return null;
        return ((exitBar.close - entry) / entry) * 100 - COST_PCT;
      });
      const list = byDate.get(bars[i].date) ?? [];
      list.push({ score: flowSum / tv, rets });
      byDate.set(bars[i].date, list);
    }
  }

  const dates = [...byDate.keys()].sort();
  const allScores = [...byDate.values()].flat().map((r) => r.score).sort((x, y) => x - y);
  const pct = (p: number) => allScores[Math.floor((allScores.length - 1) * p)];
  console.log(`점수 분위 경계(순매수/20일 평균 거래대금): p10 ${pct(0.1).toFixed(3)} · p20 ${pct(0.2).toFixed(3)} · p50 ${pct(0.5).toFixed(3)} · p80 ${pct(0.8).toFixed(3)}`);
  const mid = dates[Math.floor(dates.length / 2)];
  console.log(`수급 팩터(${WHO}, ${WINDOW}일) · 종목 ${barsBy.size} · 날짜 ${dates[0]}~${dates[dates.length - 1]} · 분할 ${mid} · 비용 ${COST_PCT}%`);

  for (const [label, filter] of [
    ["전체", (_d: string) => true],
    ["전반(IS)", (d: string) => d < mid],
    ["후반(OOS)", (d: string) => d >= mid],
  ] as const) {
    // 분위별 초과수익 합계 (h별)
    const buckets = HORIZONS.map(() => Array.from({ length: 5 }, () => [] as number[]));
    const raw = HORIZONS.map(() => Array.from({ length: 5 }, () => [] as number[]));
    for (const d of dates) {
      if (!filter(d)) continue;
      const rows = byDate.get(d)!;
      if (rows.length < 50) continue;
      const sorted = [...rows].sort((a, b) => a.score - b.score);
      HORIZONS.forEach((_, hi) => {
        const valid = sorted.filter((r) => r.rets[hi] != null);
        if (valid.length < 50) return;
        const avg = mean(valid.map((r) => r.rets[hi]!));
        valid.forEach((r, idx) => {
          const q = Math.min(4, Math.floor((idx / valid.length) * 5));
          buckets[hi][q].push(r.rets[hi]! - avg);
          raw[hi][q].push(r.rets[hi]!);
        });
      });
    }
    console.log(`\n[${label}] 분위(Q1=순매도 최다 … Q5=순매수 최다) 평균 초과수익%  (괄호: 절대수익%)`);
    HORIZONS.forEach((h, hi) => {
      const cells = buckets[hi].map((b, q) => `${mean(b).toFixed(2).padStart(6)}(${mean(raw[hi][q]).toFixed(2)})`);
      console.log(`  ${String(h).padStart(2)}일  ${cells.join("  ")}  n/분위≈${buckets[hi][0].length}`);
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
