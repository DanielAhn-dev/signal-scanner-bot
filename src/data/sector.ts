// packages/data/sector.ts
import { createClient } from "@supabase/supabase-js";
import { getCache, setCache } from "../cache/memory";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

export async function getLeadersForSector(
  sector: string,
  limit = 12
): Promise<string[]> {
  try {
    // 섹터 이름 → ID 매핑 (이름 ILIKE로 fuzzy)
    const { data: sectorRow, error: sectorError } = await supabase
      .from("sectors")
      .select("id")
      .ilike("name", `%${sector}%`) // "반도체" → 정확/부분 매칭
      .limit(1);
    if (sectorError || !sectorRow?.[0]?.id) {
      console.error("Sector ID not found for:", sector, sectorError);
      return []; // 매칭 실패
    }
    const sectorId = sectorRow[0].id;

    // liquidity DESC 상위 code만 (문제 1 해결: order 명시)
    const { data, error } = await supabase
      .from("stocks")
      .select("code")
      .eq("sector_id", sectorId)
      .eq("is_active", true) // 활성만
      .order("liquidity", { ascending: false }) // 유동성 상위 순 (DESC)
      .limit(limit);
    if (error) {
      console.error("getLeadersForSector error for " + sector + ":", error);
      return [];
    }
    const codes = (data || []).map((r: { code: string }) => r.code);
    console.log(
      `Found ${codes.length} leaders for ${sector}:`,
      codes.slice(0, 3)
    ); // 디버그 로그
    return codes;
  } catch (e) {
    console.error("getLeadersForSector exception:", e);
    return [];
  }
}

export async function getTopSectors(
  topN = 8
): Promise<{ sector: string; score: number }[]> {
  const cached = await getCache("top_sectors");
  if (cached) return cached;

  const { data } = await supabase
    .from("sectors")
    .select("name, score")
    .order("score", { ascending: false })
    .limit(topN);

  const tops = (data || []).map((r: any) => ({
    sector: r.name,
    score: r.score || 0,
  }));

  await setCache("top_sectors", tops); // 65 라인: import로 해결
  return tops;
}

export async function getTopSectorsRealtime(
  topN = 8
): Promise<{ sector: string; score: number }[]> {
  // 실시간: 최신 score 사용 (ingest-data 업데이트 후)
  try {
    const { data } = await supabase
      .from("sectors")
      .select("name, score")
      .order("updated_at", { ascending: false })
      .limit(topN);
    return (data || []).map((r: any) => ({
      sector: r.name,
      score: r.score || 0,
    }));
  } catch (e) {
    console.error("getTopSectorsRealtime error:", e);
    return [];
  }
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
