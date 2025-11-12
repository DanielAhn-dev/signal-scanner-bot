// src/data/sector.ts
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { getCache, setCache } from "../cache/memory";
import { getDailySeries } from "../adapters";

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

// 간단한 동시성 제한 유틸
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (x: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = [];
  let idx = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (idx < items.length) {
        const i = idx++;
        out[i] = await fn(items[i]);
      }
    }
  );
  await Promise.all(workers);
  return out;
}

export async function getLeadersForSector(
  sector: string,
  limit = 12
): Promise<string[]> {
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
    const sectorId = sectorRow[0].id;

    const { data, error } = await supabase
      .from("stocks")
      .select("code")
      .eq("sector_id", sectorId)
      .eq("is_active", true)
      .order("liquidity", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("getLeadersForSector error for " + sector + ":", error);
      return [];
    }
    return (data || []).map((r: { code: string }) => r.code);
  } catch (e) {
    console.error("getLeadersForSector exception:", e);
    return [];
  }
}

export async function getTopSectors(
  topN = 8
): Promise<{ sector: string; score: number }[]> {
  const { data, error } = await supabase
    .from("sectors")
    .select("name, score, metrics")
    .order("updated_at", { ascending: false })
    .limit(topN);
  if (error) return [];
  return (data || [])
    .map((r: any) => ({
      sector: r.name,
      score: Number.isFinite(r?.score)
        ? r.score
        : Number(r?.metrics?.score ?? 0),
    }))
    .filter((x) => x.sector);
}

export async function getTopSectorsRealtime(
  topN = 8
): Promise<{ sector: string; score: number }[]> {
  try {
    const { data, error } = await supabase
      .from("sectors")
      .select("name, score")
      .order("updated_at", { ascending: false })
      .limit(topN);
    if (error) return [];
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

/**
 * 섹터 트렌드 온디맨드 계산(폴백용)
 * - 각 섹터 유동성 상위 N종목 기준 수익률·20SMA 상회비중·Quiet Spike 비중을 가중합
 * - 10분 캐시 권장
 */
export async function computeSectorTrends(
  limitPerSector = 10
): Promise<{ sector: string; score: number }[]> {
  const cacheKey = `sector:trends:${limitPerSector}`;
  const cached = await getCache<{ sector: string; score: number }[]>(cacheKey);
  if (cached?.length) return cached;

  // 섹터/종목 메타 로드
  const { data: sectors } = await supabase.from("sectors").select("id,name");
  const { data: stocks } = await supabase
    .from("stocks")
    .select("code,sector_id,liquidity,is_active")
    .eq("is_active", true);

  const id2name = new Map((sectors || []).map((s: any) => [s.id, s.name]));
  const bySector = new Map<string, any[]>();

  if (!sectors?.length || !stocks?.length) {
    return [
      { sector: "정보기술", score: 50 },
      { sector: "헬스케어", score: 48 },
    ];
  }

  (stocks || [])
    .sort((a: any, b: any) => (b.liquidity || 0) - (a.liquidity || 0))
    .forEach((s: any) => {
      const sec = id2name.get(s.sector_id) || "기타";
      if (!bySector.has(sec)) bySector.set(sec, []);
      const arr = bySector.get(sec)!;
      if (arr.length < limitPerSector) arr.push(s);
    });

  const results: { sector: string; score: number }[] = [];
  for (const [sec, arr] of bySector.entries()) {
    let pts = 0,
      cnt = 0,
      above20 = 0,
      spikes = 0;

    // 병렬 처리(동시 6개)
    const seriesList = await mapWithConcurrency(arr, 6, async (s) => {
      try {
        return await getDailySeries(s.code, 260);
      } catch {
        return [];
      }
    });

    for (const series of seriesList) {
      if (!series?.length) continue;
      cnt++;

      const closes = series.map((x: any) => x.close);
      const last = closes[closes.length - 1];
      const m1 = closes[closes.length - 21];
      const m3 = closes[closes.length - 63];
      const m6 = closes[closes.length - 126];
      const m12 = closes[0];

      const ret1 = (last - m1) / m1;
      const ret3 = (last - m3) / m3;
      const ret6 = (last - m6) / m6;
      const ret12 = (last - m12) / m12;

      const s20 =
        closes.slice(-20).reduce((a: number, b: number) => a + b, 0) / 20;
      if (last > s20) above20++;

      const vols = series.map((x: any) => x.volume);
      const v20 =
        vols.slice(-21, -1).reduce((a: number, b: number) => a + b, 0) / 20;
      const today = series[series.length - 1];
      const range = (today.high - today.low) / today.close;
      if (today.volume >= v20 * 2 && range <= 0.02) spikes++;

      // 가중치: 1/3/6/12M = 0.4/0.3/0.2/0.1
      pts += 0.4 * ret1 + 0.3 * ret3 + 0.2 * ret6 + 0.1 * ret12;
    }

    if (cnt === 0) continue;
    const pctAbove20 = above20 / cnt;
    const spikeShare = spikes / cnt;

    const score = Math.max(
      0,
      Math.min(100, pts * 100 + pctAbove20 * 20 + spikeShare * 30)
    );
    results.push({ sector: sec, score: Math.round(score) });
  }

  results.sort((a, b) => b.score - a.score);
  await setCache(cacheKey, results, 600_000); // 10분 TTL
  return results.slice(0, 12);
}

// id 매칭 방식으로 확정 업데이트
export async function syncSectorScoresToDB() {
  console.log("[sync] 시작: computeSectorTrends() 결과를 DB에 반영 중...");

  const trends = await computeSectorTrends();
  if (!trends?.length) {
    console.warn("[sync] 섹터 트렌드 데이터가 비어있습니다.");
    return;
  }

  // 선조회: name -> id 매핑
  const { data: sectorRows, error: qerr } = await supabase
    .from("sectors")
    .select("id,name");
  if (qerr) {
    console.error("[sync] sector list query error:", qerr.message);
    return;
  }
  const nameToId = new Map((sectorRows || []).map((r: any) => [r.name, r.id]));

  let updated = 0;
  for (const { sector, score } of trends) {
    let sectorId = nameToId.get(sector);
    if (!sectorId) {
      for (const [nm, id] of nameToId.entries()) {
        if (nm.includes(sector)) {
          sectorId = id;
          break;
        }
      }
    }
    if (!sectorId) {
      console.warn(`[sync] 매칭 실패: '${sector}'`);
      continue;
    }

    const { error } = await supabase
      .from("sectors")
      .update({ score })
      .eq("id", sectorId);
    if (error)
      console.error(`[sync] '${sector}' 업데이트 실패:`, error.message);
    else {
      updated++;
      console.log(`[sync] '${sector}' → 점수 ${score} 업데이트 완료`);
    }
  }

  console.log(`[sync] 모든 섹터 점수 동기화 완료 ✅ (updated=${updated})`);
}
