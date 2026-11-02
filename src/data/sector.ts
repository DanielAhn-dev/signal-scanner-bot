// src/data/sector.ts
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_ANON_KEY;
if (!url || !key) {
  throw new Error(
    `Missing Supabase env. Got SUPABASE_URL=${
      url ? "set" : "missing"
    }, SUPABASE_ANON_KEY=${key ? "set" : "missing"}`
  );
}
const supabase = createClient(url, key);

export async function getLeadersForSectorById(
  sectorId: string,
  limit = 12
): Promise<{
  code: string;
  name: string;
  market?: string | null;
  market_cap?: number | null;
  liquidity?: number | null;
  universe_level?: string | null;
  is_sector_leader?: boolean | null;
}[]> {
  try {
    const { data, error } = await supabase
      .from("stocks")
      .select("code, name, market, market_cap, liquidity, universe_level, is_sector_leader")
      .eq("sector_id", sectorId)
      .eq("is_active", true)
      .in("market", ["KOSPI", "KOSDAQ"])
      .in("universe_level", ["core", "extended"])
      .order("is_sector_leader", { ascending: false })
      .order("market_cap", { ascending: false, nullsFirst: false })
      .order("liquidity", { ascending: false, nullsFirst: false }) // nullsLast
      .limit(limit);

    if (error) {
      console.error("getLeadersForSectorById error:", error);
      return [];
    }
    return data || [];
  } catch (e) {
    console.error("getLeadersForSectorById exception:", e);
    return [];
  }
}

export async function getLeadersForSector(
  sector: string,
  limit = 12
): Promise<{
  code: string;
  name: string;
  market?: string | null;
  market_cap?: number | null;
  liquidity?: number | null;
  universe_level?: string | null;
  is_sector_leader?: boolean | null;
}[]> {
  try {
    const { data: sectorRow, error: sectorError } = await supabase
      .from("sectors")
      .select("id")
      .ilike("name", `%${sector}%`)
      .limit(1);

    if (sectorError || !sectorRow?.[0]?.id) {
      console.error("Sector ID not found for:", sector, sectorError);
      return [];
    }
    return getLeadersForSectorById(sectorRow[0].id, limit);
  } catch (e) {
    console.error("getLeadersForSector exception:", e);
    return [];
  }
}

export async function getTopSectors(topN = 8) {
  const { data, error } = await supabase
    .from("sectors")
    .select("id, name, score, metrics")
    .order("score", { ascending: false }) // 변경: score 기준
    .order("updated_at", { ascending: false })
    .limit(topN);
  if (error) return [];
  return (data || []).map((r: any) => ({
    id: r.id,
    sector: r.name,
    score: Number.isFinite(r?.score) ? r.score : Number(r?.metrics?.score ?? 0),
  }));
}

export async function getTopSectorsRealtime(topN = 8) {
  const { data, error } = await supabase
    .from("sectors")
    .select("id, name, score")
    .order("score", { ascending: false }) // 변경
    .order("updated_at", { ascending: false })
    .limit(topN);
  if (error) return [];
  return (data || []).map((r: any) => ({
    id: r.id,
    sector: r.name,
    score: r.score || 0,
  }));
}

export async function loadSectorMap(): Promise<
  Record<string, { category: string }>
> {
  try {
    const { data } = await supabase.from("sectors").select("name, category");
    return Object.fromEntries(
      (data || []).map((r: any) => [
        r.name,
        { category: r.category || "Other" },
      ])
    );
  } catch {
    return {};
  }
}
