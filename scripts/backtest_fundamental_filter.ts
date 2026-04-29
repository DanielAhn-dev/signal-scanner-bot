import "dotenv/config";
import { supabase } from "../src/db/client";
import fundamentalStore from "../src/services/fundamentalStore";

type IndicatorRow = {
  code: string;
  trade_date: string;
  close: number;
  value_traded: number;
  rsi14: number;
  roc14: number;
  sma20: number;
  sma50: number;
  sma200: number;
};

function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function getTrendScore(row: IndicatorRow): number {
  const { close, sma20, sma50, sma200 } = row;
  let score = 0;
  if (close > sma20 && sma20 > 0) score += 20;
  if (close > sma50 && sma50 > 0) score += 20;
  if (close > sma200 && sma200 > 0) score += 18;
  if (sma20 > sma50 && sma50 > sma200 && sma200 > 0) score += 28;
  else if (sma50 > sma200 && sma200 > 0) score += 16;
  return clamp(score, 0, 100);
}

function getLiquidityScore(valueTraded: number): number {
  if (valueTraded >= 150_000_000_000) return 100;
  if (valueTraded >= 80_000_000_000) return 85;
  if (valueTraded >= 30_000_000_000) return 70;
  if (valueTraded >= 10_000_000_000) return 55;
  if (valueTraded >= 3_000_000_000) return 35;
  return 10;
}

function getSafetyScore(valueTraded: number, rsi14: number): number {
  let score = 40;
  if (valueTraded >= 300_000_000_000) score += 18;
  else if (valueTraded >= 100_000_000_000) score += 12;
  else if (valueTraded >= 30_000_000_000) score += 8;
  else score -= 6;
  if (rsi14 >= 43 && rsi14 <= 66) score += 6;
  else if (rsi14 >= 70 || rsi14 <= 30) score -= 8;
  return clamp(score, 0, 100);
}

function calcScore(row: IndicatorRow, valueTraded: number): number {
  const technical = clamp((row.roc14 + 10) * 5, 0, 100);
  const momentum = clamp((row.roc14 + 6) * 7, 0, 100);
  const trend = getTrendScore(row);
  const liquidity = getLiquidityScore(valueTraded);
  const safety = getSafetyScore(valueTraded, row.rsi14);

  // simplified weights
  const score = technical * 0.36 + momentum * 0.22 + safety * 0.2 + trend * 0.14 + liquidity * 0.08;
  return clamp(score, 0, 100);
}

async function fetchUniverse(limit: number) {
  const { data, error } = await supabase
    .from("stocks")
    .select("code, name, liquidity")
    .eq("is_active", true)
    .order("liquidity", { ascending: false })
    .limit(limit);
  if (error) {
    console.error("fetchUniverse error:", error.message ?? error);
    return [];
  }
  console.log(`fetchUniverse -> got ${((data ?? []) as any[]).length} rows`);
  return (data ?? []) as Array<any>;
}

async function fetchSeries(code: string, fromDate: string): Promise<IndicatorRow[]> {
  const { data, error } = await supabase
    .from("daily_indicators")
    .select("code, trade_date, close, value_traded, rsi14, roc14, sma20, sma50, sma200")
    .eq("code", code)
    .gte("trade_date", fromDate)
    .order("trade_date", { ascending: true })
    .limit(500);
  if (error) {
    console.error(`fetchSeries(${code}) error:`, error.message ?? error);
    return [];
  }
  const rows = ((data ?? []) as any[])
    .map((r) => ({
      code: r.code,
      trade_date: r.trade_date,
      close: Number(r.close ?? 0),
      value_traded: Number(r.value_traded ?? 0),
      rsi14: Number(r.rsi14 ?? 50),
      roc14: Number(r.roc14 ?? 0),
      sma20: Number(r.sma20 ?? 0),
      sma50: Number(r.sma50 ?? 0),
      sma200: Number(r.sma200 ?? 0),
    }))
    .filter((r) => r.close > 0);
  if (!rows.length) {
    // debug: small chance table/column mismatch
    // console.debug(`fetchSeries(${code}) -> 0 rows from ${fromDate}`);
  }
  return rows;
}

function calcForwardStats(rows: IndicatorRow[], idx: number, holdDays: number) {
  const entry = rows[idx].close;
  const endIdx = Math.min(rows.length - 1, idx + holdDays);
  const future = rows.slice(idx + 1, endIdx + 1);
  if (!future.length) return null;
  const endClose = future[future.length - 1].close;
  const holdReturnPct = ((endClose - entry) / entry) * 100;
  return { holdReturnPct };
}

function passesBasicFundFilter(db: any | null | undefined) {
  if (!db) return true; // keep if missing
  const q = Number(db.computed?.qualityScore ?? 0);
  const roe = Number(db.roe ?? 0);
  const debt = Number(db.debt_ratio ?? 1e9);
  if (!Number.isFinite(q) || q <= 0) return false;
  if (q < 55) return false;
  if (Number.isFinite(roe) && roe >= 8) return true;
  if (Number.isFinite(debt) && debt <= 150) return true;
  return false;
}

function parseArg(name: string, fallback: string) {
  const hit = process.argv.find((x) => x.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : fallback;
}

async function main() {
  const lookbackDays = Number(parseArg("lookback", "220"));
  const holdDays = Number(parseArg("hold", "7"));
  const topN = Number(parseArg("top", "5"));
  const universeLimit = Number(parseArg("universe", "120"));

  const from = new Date();
  from.setDate(from.getDate() - lookbackDays);
  const fromDate = from.toISOString().slice(0, 10);

  const universe = await fetchUniverse(universeLimit);
  if (!universe.length) {
    console.log("No universe");
    return;
  }

  // debug: examine sample trade_date ranges for first few symbols
  for (const meta of universe.slice(0, 8)) {
    try {
      const { data: first } = await supabase
        .from("daily_indicators")
        .select("trade_date")
        .eq("code", meta.code)
        .order("trade_date", { ascending: true })
        .limit(1);
      const { data: last } = await supabase
        .from("daily_indicators")
        .select("trade_date")
        .eq("code", meta.code)
        .order("trade_date", { ascending: false })
        .limit(1);
      const firstD = first?.[0]?.trade_date ?? null;
      const lastD = last?.[0]?.trade_date ?? null;
      console.log(`sample ${meta.code} -> first:${firstD} last:${lastD}`);
    } catch (e) {
      // ignore
    }
  }

  // build date-indexed candidate maps
  const dateMap = new Map<string, Array<{ code: string; score: number }>>();

  for (const meta of universe) {
    try {
      const rows = await fetchSeries(meta.code, fromDate);
      const minHistory = Math.max(holdDays + 5, 12); // accept shorter history when DB limited
      if (rows.length < minHistory) {
        console.log(`skip ${meta.code} -> rows=${rows.length} (need ${minHistory})`);
        continue;
      }
      console.log(`use ${meta.code} -> rows=${rows.length}`);
      for (let i = 0; i < rows.length - holdDays; i++) {
        const r = rows[i];
        const s = calcScore(r, meta.liquidity ?? 0);
        const list = dateMap.get(r.trade_date) ?? [];
        list.push({ code: meta.code, score: s });
        dateMap.set(r.trade_date, list);
      }
    } catch (e) {
      // skip
    }
  }

  // For each date, pick topN and compute forward returns
  const dates = Array.from(dateMap.keys()).sort();
  let baselineReturns: number[] = [];
  let filteredReturns: number[] = [];

  for (const date of dates) {
    const candidates = (dateMap.get(date) ?? []).sort((a, b) => b.score - a.score).slice(0, topN);
    for (const c of candidates) {
      const rows = await fetchSeries(c.code, date);
      const idx = rows.findIndex((r) => r.trade_date === date);
      if (idx < 0) continue;
      const stats = calcForwardStats(rows, idx, holdDays);
      if (!stats) continue;
      baselineReturns.push(stats.holdReturnPct);
      // check fundamental filter using latest DB snapshot
      const dbRec = await fundamentalStore.getLatestFundamentalSnapshot(c.code);
      if (passesBasicFundFilter(dbRec)) filteredReturns.push(stats.holdReturnPct);
    }
  }

  const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  console.log(`Baseline picks: count=${baselineReturns.length} avg_hold_pct=${avg(baselineReturns).toFixed(2)}`);
  console.log(`Filtered picks: count=${filteredReturns.length} avg_hold_pct=${avg(filteredReturns).toFixed(2)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
