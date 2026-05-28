import type { SupabaseClient } from "@supabase/supabase-js";
import { chunkValues } from "./supabasePaging";

type Json = Record<string, any>;

export interface ScoreSnapshotRow {
  code: string;
  total_score: number | null;
  momentum_score: number | null;
  liquidity_score: number | null;
  value_score: number | null;
  factors: Json | null;
  asof: string | null;
  signal?: string | null;
}

export interface ScoreSnapshotResult {
  latestAsof: string | null;
  byCode: Map<string, ScoreSnapshotRow>;
  fallbackCodes: string[];
}

export interface RecentScoreHistoryPoint {
  asof: string | null;
  signal?: string | null;
  total_score: number | null;
  factors: Json | null;
}

function uniqCodes(codes: string[]): string[] {
  return [...new Set(codes.map((code) => code.trim()).filter(Boolean))];
}

function pickLatestRows(rows: ScoreSnapshotRow[]): Map<string, ScoreSnapshotRow> {
  const byCode = new Map<string, ScoreSnapshotRow>();
  for (const row of rows) {
    if (!row?.code) continue;
    if (!byCode.has(row.code)) {
      byCode.set(row.code, row);
    }
  }
  return byCode;
}

export async function fetchLatestScoresByCodes(
  supabase: SupabaseClient,
  codes: string[]
): Promise<ScoreSnapshotResult> {
  const targets = uniqCodes(codes);
  const empty: ScoreSnapshotResult = {
    latestAsof: null,
    byCode: new Map<string, ScoreSnapshotRow>(),
    fallbackCodes: [],
  };

  if (!targets.length) return empty;

  const { data: latestRows, error: latestError } = await supabase
    .from("scores")
    .select("asof")
    .order("asof", { ascending: false })
    .limit(1);

  if (latestError) {
    throw new Error(`Latest score date fetch failed: ${latestError.message}`);
  }

  const latestAsof = (latestRows?.[0]?.asof as string | undefined) ?? null;
  const byCode = new Map<string, ScoreSnapshotRow>();

  if (latestAsof) {
    for (const part of chunkValues(targets, 200)) {
      const { data: currentRows, error: currentError } = await supabase
        .from("scores")
        .select(
          [
            "code",
            "total_score",
            "momentum_score",
            "liquidity_score",
            "value_score",
            "factors",
            "asof",
            "signal",
          ].join(", ")
        )
        .eq("asof", latestAsof)
        .in("code", part)
        .returns<ScoreSnapshotRow[]>();

      if (currentError) {
        throw new Error(`Current score fetch failed: ${currentError.message}`);
      }

      for (const row of currentRows ?? []) {
        byCode.set(row.code, row);
      }
    }
  }

  const missingCodes = targets.filter((code) => !byCode.has(code));

  if (missingCodes.length) {
    for (const part of chunkValues(missingCodes, 200)) {
      const need = new Set(part);
      for (let offset = 0; ; offset += 1000) {
        const { data: fallbackRows, error: fallbackError } = await supabase
          .from("scores")
          .select(
            [
              "code",
              "total_score",
              "momentum_score",
              "liquidity_score",
              "value_score",
              "factors",
              "asof",
              "signal",
            ].join(", ")
          )
          .in("code", part)
          .order("asof", { ascending: false })
          .range(offset, offset + 999)
          .returns<ScoreSnapshotRow[]>();

        if (fallbackError) {
          throw new Error(`Fallback score fetch failed: ${fallbackError.message}`);
        }

        const rows = fallbackRows ?? [];
        for (const row of rows) {
          if (!row?.code || byCode.has(row.code)) continue;
          byCode.set(row.code, row);
          need.delete(row.code);
        }

        if (rows.length < 1000 || need.size === 0) break;
      }
    }
  }

  const fallbackCodes = targets.filter((code) => {
    const row = byCode.get(code);
    return Boolean(row && latestAsof && row.asof !== latestAsof);
  });

  return {
    latestAsof,
    byCode,
    fallbackCodes,
  };
}

export async function fetchRecentScoreHistoryByCodes(
  supabase: SupabaseClient,
  codes: string[],
  lookbackPerCode = 5
): Promise<Map<string, RecentScoreHistoryPoint[]>> {
  const targets = uniqCodes(codes);
  const historyMap = new Map<string, RecentScoreHistoryPoint[]>();

  if (!targets.length) return historyMap;

  for (const part of chunkValues(targets, 200)) {
    const need = new Set(part);
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase
        .from("scores")
        .select("code, asof, signal, total_score, factors")
        .in("code", part)
        .order("asof", { ascending: false })
        .range(offset, offset + 999)
        .returns<Array<RecentScoreHistoryPoint & { code: string }>>();

      if (error) {
        throw new Error(`Recent score history fetch failed: ${error.message}`);
      }

      const rows = data ?? [];
      for (const row of rows) {
        const code = String(row.code ?? "").trim();
        if (!code) continue;
        const current = historyMap.get(code) ?? [];
        if (current.length >= lookbackPerCode) continue;
        current.push({
          asof: row.asof,
          signal: row.signal,
          total_score: row.total_score,
          factors: row.factors,
        });
        historyMap.set(code, current);
        if (current.length >= lookbackPerCode) {
          need.delete(code);
        }
      }

      if (rows.length < 1000 || need.size === 0) break;
    }
  }

  return historyMap;
}