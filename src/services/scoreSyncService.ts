import type { SupabaseClient } from "@supabase/supabase-js";
import { getDailySeries } from "../adapters";
import { calculateScore, type MarketEnv } from "../score/engine";
import { fetchAllMarketData } from "../utils/fetchMarketData";
import { fetchLatestScoresByCodes } from "./scoreSourceService";

type ScoreUpsertRow = {
  code: string;
  asof: string;
  score: number;
  signal: "BUY" | "STRONG_BUY" | "WATCH" | "HOLD" | "SELL" | "NONE";
  total_score: number;
  momentum_score: number;
  liquidity_score: number;
  value_score: number;
  factors: Record<string, any>;
};

export type ScoreSyncSummary = {
  asof: string;
  targetCount: number;
  processedCount: number;
  upsertCount: number;
  skippedInsufficientSeries: number;
  failedCount: number;
};

export type ScoreSyncOptions = {
  asof?: string;
  limit?: number;
  concurrency?: number;
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function deriveMomentumScore(rsi14: number, roc21: number): number {
  const raw = 50 + (rsi14 - 50) * 0.6 + roc21 * 6;
  return Math.round(clamp(raw, 0, 100));
}

function deriveLiquidityScore(volRatio?: number): number {
  const ratio = Number.isFinite(Number(volRatio)) ? Number(volRatio) : 1;
  const raw = 40 + ratio * 30;
  return Math.round(clamp(raw, 0, 100));
}

function deriveSignalFromTotalScore(totalScore: number): ScoreUpsertRow["signal"] {
  if (totalScore >= 85) return "STRONG_BUY";
  if (totalScore >= 70) return "BUY";
  if (totalScore >= 55) return "WATCH";
  if (totalScore <= 20) return "SELL";
  return "HOLD";
}

function resolveMarketEnv(raw: Awaited<ReturnType<typeof fetchAllMarketData>>): MarketEnv {
  return {
    vix: raw.vix?.price,
    fearGreed: raw.fearGreed?.score,
    usdkrw: raw.usdkrw?.price,
  };
}

async function upsertRowsByBatch(supabase: SupabaseClient, rows: ScoreUpsertRow[]) {
  const batchSize = 120;
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const { error } = await supabase
      .from("scores")
      .upsert(batch, { onConflict: "code,asof" });
    if (error) {
      throw new Error(`Scores upsert failed: ${error.message}`);
    }
  }
}

export async function syncScoresFromEngine(
  supabase: SupabaseClient,
  options: ScoreSyncOptions = {}
): Promise<ScoreSyncSummary> {
  const asof = options.asof ?? new Date().toISOString().slice(0, 10);
  const concurrency = Math.max(1, Math.min(12, options.concurrency ?? 5));

  const { data: stockRows, error: stockError } = await supabase
    .from("stocks")
    .select("code")
    .eq("is_active", true)
    .in("universe_level", ["core", "extended"])
    .order("code", { ascending: true })
    .limit(options.limit && options.limit > 0 ? options.limit : 1500);

  if (stockError) {
    throw new Error(`Target stocks fetch failed: ${stockError.message}`);
  }

  const codes = (stockRows ?? [])
    .map((row: { code?: string | null }) => String(row.code ?? "").trim())
    .filter(Boolean);

  if (!codes.length) {
    return {
      asof,
      targetCount: 0,
      processedCount: 0,
      upsertCount: 0,
      skippedInsufficientSeries: 0,
      failedCount: 0,
    };
  }

  const marketOverview = await fetchAllMarketData().catch(() => ({} as Awaited<ReturnType<typeof fetchAllMarketData>>));
  const marketEnv = resolveMarketEnv(marketOverview);

  const existingScoreResult = await fetchLatestScoresByCodes(supabase, codes);
  const existingValueScoreByCode = new Map<string, number>();
  existingScoreResult.byCode.forEach((row, code) => {
    if (row.value_score == null) return;
    const value = Number(row.value_score);
    if (Number.isFinite(value)) {
      existingValueScoreByCode.set(code, Math.round(clamp(value, 0, 100)));
    }
  });

  const upsertRows: ScoreUpsertRow[] = [];
  let cursor = 0;
  let processedCount = 0;
  let skippedInsufficientSeries = 0;
  let failedCount = 0;

  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= codes.length) return;

      const code = codes[index];

      try {
        const series = await getDailySeries(code, 420);
        if (!series || series.length < 200) {
          skippedInsufficientSeries += 1;
          continue;
        }

        const scored = calculateScore(series, marketEnv);
        if (!scored) {
          skippedInsufficientSeries += 1;
          continue;
        }

        const totalScore = Math.round(clamp(scored.score, 0, 100));
        const momentumScore = deriveMomentumScore(scored.factors.rsi14, scored.factors.roc21);
        const liquidityScore = deriveLiquidityScore(scored.factors.vol_ratio);
        const valueScore = existingValueScoreByCode.get(code) ?? 50;
        const signal = deriveSignalFromTotalScore(totalScore);

        upsertRows.push({
          code,
          asof,
          score: Number(scored.score.toFixed(2)),
          signal,
          total_score: totalScore,
          momentum_score: momentumScore,
          liquidity_score: liquidityScore,
          value_score: valueScore,
          factors: scored.factors,
        });
        processedCount += 1;
      } catch {
        failedCount += 1;
      }
    }
  });

  await Promise.all(workers);
  if (upsertRows.length) {
    await upsertRowsByBatch(supabase, upsertRows);
  }

  return {
    asof,
    targetCount: codes.length,
    processedCount,
    upsertCount: upsertRows.length,
    skippedInsufficientSeries,
    failedCount,
  };
}