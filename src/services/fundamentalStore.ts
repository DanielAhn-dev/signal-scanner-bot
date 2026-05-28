import { createClient } from "@supabase/supabase-js";
import { chunkValues } from "./supabasePaging";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const FUNDAMENTALS_TABLE = "fundamentals";

export type FundamentalSnapshot = {
  code: string; // 종목 코드
  as_of: string; // ISO date of the snapshot (period end or collection time)
  period_type?: "annual" | "quarter" | "ttm" | null;
  period_end?: string | null;
  sales?: number | null;
  operating_income?: number | null;
  net_income?: number | null;
  cashflow_oper?: number | null;
  cashflow_free?: number | null;
  per?: number | null;
  pbr?: number | null;
  eps?: number | null; // 주당순이익 (close ÷ PER 파생)
  bps?: number | null; // 주당순자산 (close ÷ PBR 파생)
  roe?: number | null;
  debt_ratio?: number | null;
  computed?: Record<string, unknown> | null; // margins, ttm values, derived ratios
  raw_rows?: unknown | null; // parser raw rows for audit
  source?: string | null; // e.g. "naver-scrape"
};

export async function upsertFundamentalSnapshot(
  snapshot: FundamentalSnapshot
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await supabase.from(FUNDAMENTALS_TABLE).upsert(snapshot, {
      onConflict: "code,as_of",
    });
    if (error) {
      console.error("upsertFundamentalSnapshot error:", error);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e) {
    console.error("upsertFundamentalSnapshot exception:", e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function bulkUpsertFundamentalSnapshots(
  snapshots: FundamentalSnapshot[]
): Promise<{ ok: boolean; error?: string }> {
  try {
    const chunkSize = 200;
    for (let i = 0; i < snapshots.length; i += chunkSize) {
      const chunk = snapshots.slice(i, i + chunkSize);
      const { error } = await supabase.from(FUNDAMENTALS_TABLE).upsert(chunk, {
        onConflict: "code,as_of",
      });
      if (error) {
        console.error("bulkUpsertFundamentalSnapshots chunk error:", error);
        return { ok: false, error: error.message };
      }
    }
    return { ok: true };
  } catch (e) {
    console.error("bulkUpsertFundamentalSnapshots exception:", e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function getLatestFundamentalSnapshot(
  code: string
): Promise<FundamentalSnapshot | null> {
  try {
    const { data, error } = await supabase
      .from(FUNDAMENTALS_TABLE)
      .select("*")
      .eq("code", code)
      .order("as_of", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("getLatestFundamentalSnapshot query error:", error);
      return null;
    }
    return (data as any) ?? null;
  } catch (e) {
    console.error("getLatestFundamentalSnapshot exception:", e);
    return null;
  }
}

export async function getFundamentalSnapshotsForCodes(
  codes: string[]
): Promise<Record<string, FundamentalSnapshot | null>> {
  const result: Record<string, FundamentalSnapshot | null> = {};
  if (!codes.length) return result;
  try {
    const grouped = new Map<string, FundamentalSnapshot>();
    for (const part of chunkValues(codes)) {
      const need = new Set(part);
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await supabase
          .from(FUNDAMENTALS_TABLE)
          .select("*")
          .in("code", part)
          .order("as_of", { ascending: false })
          .range(offset, offset + 999);

        if (error) {
          console.error("getFundamentalSnapshotsForCodes error:", error);
          return codes.reduce((acc, c) => ({ ...acc, [c]: null }), {} as Record<string, null>);
        }

        const rows = (data ?? []) as FundamentalSnapshot[];
        for (const r of rows) {
          if (!r?.code || grouped.has(r.code)) continue;
          grouped.set(r.code, r);
          need.delete(r.code);
        }

        if (rows.length < 1000 || need.size === 0) break;
      }
    }

    for (const code of codes) result[code] = grouped.get(code) ?? null;
    return result;
  } catch (e) {
    console.error("getFundamentalSnapshotsForCodes exception:", e);
    return codes.reduce((acc, c) => ({ ...acc, [c]: null }), {} as Record<string, null>);
  }
}

/** stocks 테이블에서 코드별 현재 종가를 일괄 조회 (EPS/BPS 파생 계산용) */
export async function getStockClosePrices(
  codes: string[]
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (!codes.length) return map;
  try {
    for (const part of chunkValues(codes)) {
      const { data, error } = await supabase
        .from("stocks")
        .select("code,close")
        .in("code", part);
      if (error) {
        console.error("getStockClosePrices error:", error);
        return map;
      }
      for (const row of data ?? []) {
        if ((row as any).close != null) map.set((row as any).code, Number((row as any).close));
      }
    }
  } catch (e) {
    console.error("getStockClosePrices exception:", e);
  }
  return map;
}

export default {
  upsertFundamentalSnapshot,
  bulkUpsertFundamentalSnapshots,
  getLatestFundamentalSnapshot,
  getFundamentalSnapshotsForCodes,
  getStockClosePrices,
};
