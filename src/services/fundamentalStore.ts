import { createClient } from "@supabase/supabase-js";
import { chunkValues, selectPaged } from "./supabasePaging";
import { hasFundamentalValues } from "../lib/fundamentalsPick";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const FUNDAMENTALS_TABLE = "fundamentals";

export type FundamentalSnapshot = {
  code: string; // 종목 코드
  as_of: string; // ISO date of the snapshot (period end or collection time)
  available_at?: string | null; // 시스템에서 사용 가능해진 시각
  availability_basis?: "filing_date" | "collection_time" | string | null;
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

/** 기준 시각에 이미 수집돼 있던 재무 스냅샷만 조회한다. */
export async function getLatestFundamentalSnapshotAsOf(
  code: string,
  availableAt: string
): Promise<FundamentalSnapshot | null> {
  try {
    const { data, error } = await supabase
      .from(FUNDAMENTALS_TABLE)
      .select("*")
      .eq("code", code)
      .not("available_at", "is", null)
      .lte("available_at", availableAt)
      .order("available_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error("getLatestFundamentalSnapshotAsOf query error:", error);
      return null;
    }
    return (data as FundamentalSnapshot | null) ?? null;
  } catch (e) {
    console.error("getLatestFundamentalSnapshotAsOf exception:", e);
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
      await selectPaged<FundamentalSnapshot>(
        async (from, to) =>
          await supabase
            .from(FUNDAMENTALS_TABLE)
            .select("*")
            .in("code", part)
            .order("as_of", { ascending: false })
            .range(from, to),
        {
          pageSize: 1000,
          maxRows: 100000,
          logLabel: "fundamentalStore.latest_snapshots",
          collectRows: false,
          onPage: (rows) => {
            for (const r of rows) {
              if (!r?.code || grouped.has(r.code)) continue;
              grouped.set(r.code, r);
              need.delete(r.code);
            }
          },
          shouldStop: () => need.size === 0,
        }
      ).catch((error) => {
        console.error("getFundamentalSnapshotsForCodes error:", error);
        throw error;
      });
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

/**
 * 재무 수집 우선순위: 시가총액 큰 순 종목(ETF·ETN 제외)과, 최근 freshDays일 안에 값이 채워진 종목 집합.
 * 순위 조회가 실패하면(컬럼 없음 등) ranked는 비고 호출 쪽이 전체 목록 순서로 대신한다.
 */
export async function getFundamentalCollectionPlan(
  freshDays: number
): Promise<{ ranked: string[]; fresh: Set<string> }> {
  const ranked: string[] = [];
  const fresh = new Set<string>();

  for (const columns of ["code,market_cap,product_type", "code,market_cap"]) {
    try {
      const rows = await selectPaged<any>(
        (from, to) =>
          supabase
            .from("stocks")
            .select(columns)
            .order("market_cap", { ascending: false, nullsFirst: false })
            .order("code", { ascending: true })
            .range(from, to) as any,
        { logLabel: "fundamental_plan_stocks" }
      );
      ranked.length = 0;
      for (const r of rows) {
        const pt = String(r?.product_type ?? "");
        if (pt === "etf" || pt === "etn" || pt === "other") continue;
        if (r?.code) ranked.push(String(r.code));
      }
      if (!columns.includes("product_type")) {
        console.warn("stocks.product_type 없음 — ETF가 대상에 섞일 수 있음(마이그레이션 036 확인)");
      }
      break;
    } catch (e) {
      console.warn(`fundamental plan: stocks 순위 조회 실패(${columns}):`, e instanceof Error ? e.message : e);
    }
  }

  try {
    const cutoff = new Date(Date.now() - freshDays * 86400000).toISOString();
    const rows = await selectPaged<any>(
      (from, to) =>
        supabase
          .from(FUNDAMENTALS_TABLE)
          .select("code,per,pbr,roe,debt_ratio")
          .gte("as_of", cutoff)
          .order("as_of", { ascending: false })
          .range(from, to) as any,
      { logLabel: "fundamental_plan_fresh" }
    );
    for (const r of rows) {
      if (r?.code && hasFundamentalValues(r)) fresh.add(String(r.code));
    }
  } catch (e) {
    console.warn("fundamental plan: 최근 수집 조회 실패:", e instanceof Error ? e.message : e);
  }

  return { ranked, fresh };
}

export default {
  getFundamentalCollectionPlan,
  upsertFundamentalSnapshot,
  bulkUpsertFundamentalSnapshots,
  getLatestFundamentalSnapshot,
  getLatestFundamentalSnapshotAsOf,
  getFundamentalSnapshotsForCodes,
  getStockClosePrices,
};
