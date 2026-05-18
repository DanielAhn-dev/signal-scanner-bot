import "dotenv/config";
import { supabase } from "../src/db/client";
import { scoreLeadAccumulationCandidate } from "../src/services/accumulationSignalService";

type SignalRow = {
  trade_date: string;
  code: string;
  entry_grade: string | null;
  entry_score: number | null;
  trend_grade: string | null;
  dist_grade: string | null;
  dist_pct: number | null;
  pivot_grade: string | null;
  warn_grade: string | null;
  warn_score: number | null;
};

type PriceRow = {
  code: string;
  trade_date: string;
  close: number;
};

type BucketStats = {
  count: number;
  count20: number;
  count60: number;
  count120: number;
  sum20: number;
  sum60: number;
  sum120: number;
  hit20_10: number;
  hit60_20: number;
  hit120_30: number;
};

function parseArg(name: string, fallback: string): string {
  const hit = process.argv.find((x) => x.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : fallback;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function percentChange(entry: number, future: number): number {
  if (!(entry > 0) || !(future > 0)) return 0;
  return ((future - entry) / entry) * 100;
}

function getForwardPrice(series: PriceRow[], tradeDate: string, horizon: number): number | null {
  const anchorIndex = series.findIndex((row) => row.trade_date >= tradeDate);
  if (anchorIndex < 0) return null;
  const futureIndex = anchorIndex + horizon;
  if (futureIndex >= series.length) return null;
  return series[futureIndex]?.close ?? null;
}

async function fetchRecentSignals(lookbackDays: number): Promise<SignalRow[]> {
  const from = new Date();
  from.setDate(from.getDate() - lookbackDays);
  const fromDate = from.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("pullback_signals")
    .select("trade_date,code,entry_grade,entry_score,trend_grade,dist_grade,dist_pct,pivot_grade,warn_grade,warn_score")
    .gte("trade_date", fromDate)
    .neq("warn_grade", "SELL")
    .in("entry_grade", ["A", "B"])
    .order("trade_date", { ascending: true });

  if (error) throw new Error(`pullback_signals 조회 실패: ${error.message}`);
  return (data ?? []) as SignalRow[];
}

async function fetchPrices(codes: string[], fromDate: string): Promise<PriceRow[]> {
  if (codes.length === 0) return [];

  const { data, error } = await supabase
    .from("daily_indicators")
    .select("code,trade_date,close")
    .in("code", codes)
    .gte("trade_date", fromDate)
    .order("trade_date", { ascending: true });

  if (error) throw new Error(`daily_indicators 조회 실패: ${error.message}`);
  return ((data ?? []) as Array<any>)
    .map((row) => ({
      code: String(row.code || ""),
      trade_date: String(row.trade_date || ""),
      close: Number(row.close || 0),
    }))
    .filter((row) => row.code && row.trade_date && Number.isFinite(row.close) && row.close > 0);
}

function bucketForScore(score: number): string {
  if (score >= 80) return '80-100';
  if (score >= 65) return '65-79';
  if (score >= 55) return '55-64';
  return '<55';
}

async function main() {
  const lookbackDays = Number(parseArg('lookback', '260'));
  const maxSignalsPerDay = Number(parseArg('maxSignalsPerDay', '30'));
  const maxHorizon = 120;

  const signals = await fetchRecentSignals(lookbackDays);
  if (signals.length === 0) {
    console.log('No pullback signals found.');
    return;
  }

  const codes = Array.from(new Set(signals.map((row) => row.code).filter(Boolean)));
  const earliestDate = signals[0]?.trade_date ?? new Date().toISOString().slice(0, 10);
  const prices = await fetchPrices(codes, earliestDate);

  const priceMap = new Map<string, PriceRow[]>();
  for (const row of prices) {
    if (!priceMap.has(row.code)) priceMap.set(row.code, []);
    priceMap.get(row.code)!.push(row);
  }

  const horizons = [20, 60, 120];
  const thresholds = [10, 20, 30];
  const buckets = new Map<string, BucketStats>();
  const stageCounts = new Map<string, { count: number; count20: number; count60: number; count120: number; sum20: number; sum60: number; sum120: number }>();

  const byDate = new Map<string, SignalRow[]>();
  for (const row of signals) {
    const list = byDate.get(row.trade_date) ?? [];
    list.push(row);
    byDate.set(row.trade_date, list);
  }

  let evaluated = 0;
  let skippedTooRecent = 0;

  for (const [tradeDate, rows] of byDate.entries()) {
    const scored = rows
      .map((row) => ({ row, lead: scoreLeadAccumulationCandidate(row) }))
      .filter(({ lead }) => lead.score > 0)
      .sort((a, b) => b.lead.score - a.lead.score)
      .slice(0, maxSignalsPerDay);

    for (const { row, lead } of scored) {
      const series = priceMap.get(row.code);
      if (!series || series.length === 0) continue;

      const seriesLatest = series[series.length - 1]?.trade_date;
      if (!seriesLatest || seriesLatest < tradeDate) continue;

      if (seriesLatest <= tradeDate) {
        skippedTooRecent += 1;
        continue;
      }

      const entryIndex = series.findIndex((item) => item.trade_date >= tradeDate);
      if (entryIndex < 0) continue;

      const entryPrice = series[entryIndex]?.close ?? null;
      if (!(entryPrice && entryPrice > 0)) continue;

      const forwardPrices = horizons.map((h) => getForwardPrice(series, tradeDate, h));
      const hasAnyHorizon = forwardPrices.some((price) => price != null);
      if (!hasAnyHorizon) {
        skippedTooRecent += 1;
        continue;
      }

      const ret20 = forwardPrices[0] != null ? percentChange(entryPrice, forwardPrices[0]!) : null;
      const ret60 = forwardPrices[1] != null ? percentChange(entryPrice, forwardPrices[1]!) : null;
      const ret120 = forwardPrices[2] != null ? percentChange(entryPrice, forwardPrices[2]!) : null;

      evaluated += 1;

      const bucketKey = bucketForScore(lead.score);
      const bucket = buckets.get(bucketKey) ?? { count: 0, count20: 0, count60: 0, count120: 0, sum20: 0, sum60: 0, sum120: 0, hit20_10: 0, hit60_20: 0, hit120_30: 0 };
      bucket.count += 1;
      if (ret20 != null) {
        bucket.count20 += 1;
        bucket.sum20 += ret20;
        if (ret20 >= thresholds[0]) bucket.hit20_10 += 1;
      }
      if (ret60 != null) {
        bucket.count60 += 1;
        bucket.sum60 += ret60;
        if (ret60 >= thresholds[1]) bucket.hit60_20 += 1;
      }
      if (ret120 != null) {
        bucket.count120 += 1;
        bucket.sum120 += ret120;
        if (ret120 >= thresholds[2]) bucket.hit120_30 += 1;
      }
      buckets.set(bucketKey, bucket);

      const stageKey = lead.stage;
      const stage = stageCounts.get(stageKey) ?? { count: 0, count20: 0, count60: 0, count120: 0, sum20: 0, sum60: 0, sum120: 0 };
      stage.count += 1;
      if (ret20 != null) { stage.count20 += 1; stage.sum20 += ret20; }
      if (ret60 != null) { stage.count60 += 1; stage.sum60 += ret60; }
      if (ret120 != null) { stage.count120 += 1; stage.sum120 += ret120; }
      stageCounts.set(stageKey, stage);
    }
  }

  console.log(`[accumulation-backtest] signals=${signals.length} evaluated=${evaluated} skippedTooRecent=${skippedTooRecent} lookback=${lookbackDays}d topPerDay=${maxSignalsPerDay} maxHorizon=${maxHorizon}`);
  console.log('--- By score bucket ---');
  for (const bucketKey of ['80-100', '65-79', '55-64', '<55']) {
    const b = buckets.get(bucketKey);
    if (!b || b.count === 0) {
      console.log(`${bucketKey}: no samples`);
      continue;
    }
    console.log(
      `${bucketKey}: count=${b.count} avg20=${b.count20 ? round1(b.sum20 / b.count20) : 0}% avg60=${b.count60 ? round1(b.sum60 / b.count60) : 0}% avg120=${b.count120 ? round1(b.sum120 / b.count120) : 0}% hit20>=10%=${b.count20 ? round1((b.hit20_10 / b.count20) * 100) : 0}% hit60>=20%=${b.count60 ? round1((b.hit60_20 / b.count60) * 100) : 0}% hit120>=30%=${b.count120 ? round1((b.hit120_30 / b.count120) * 100) : 0}%`,
    );
  }

  console.log('--- By stage ---');
  for (const stageKey of ['breakout', 'lead', 'none']) {
    const s = stageCounts.get(stageKey);
    if (!s || s.count === 0) {
      console.log(`${stageKey}: no samples`);
      continue;
    }
    console.log(`${stageKey}: count=${s.count} avg20=${s.count20 ? round1(s.sum20 / s.count20) : 0}% avg60=${s.count60 ? round1(s.sum60 / s.count60) : 0}% avg120=${s.count120 ? round1(s.sum120 / s.count120) : 0}%`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});