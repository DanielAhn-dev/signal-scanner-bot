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

function clamp(x: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, x));
}
function squash(x: number) {
  return Math.tanh(x * 2);
} // ±50% ≈ ±0.76

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

export async function getLeadersForSectorById(
  sectorId: string,
  limit = 12
): Promise<{ code: string; name: string }[]> {
  // 반환 타입 변경
  try {
    const { data, error } = await supabase
      .from("stocks")
      .select("code, name, liquidity")
      .eq("sector_id", sectorId)
      .eq("is_active", true)
      .order("liquidity", { ascending: false, nullsFirst: false }) // nullsLast
      .limit(limit);

    if (error) {
      console.error("getLeadersForSectorById error:", error);
      return [];
    }
    return data || []; // { code, name } 객체 배열을 그대로 반환
  } catch (e) {
    console.error("getLeadersForSectorById exception:", e);
    return [];
  }
}

export async function getLeadersForSector(
  sector: string,
  limit = 12
): Promise<{ code: string; name: string }[]> {
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

/**
 * 섹터 트렌드 온디맨드 계산(폴백용)
 * - 각 섹터 유동성 상위 N종목 기준 수익률·20SMA 상회비중·Quiet Spike 비중을 가중합
 * - 10분 캐시 권장
 */
export async function computeSectorTrends(
  limitPerSector = 10
): Promise<{ id: string; sector: string; score: number }[]> {
  type TrendRow = { id: string; sector: string; score: number };
  const cacheKey = `sector:trends:${limitPerSector}`;
  const cached = await getCache<TrendRow[]>(cacheKey);
  if (cached?.length) return cached;

  const { data: sectors } = await supabase.from("sectors").select("id,name");
  const nameToId = new Map((sectors || []).map((r: any) => [r.name, r.id]));

  const { data: stocks } = await supabase
    .from("stocks")
    .select("code,sector_id,liquidity,is_active")
    .eq("is_active", true);

  const id2name = new Map((sectors || []).map((s: any) => [s.id, s.name]));
  const bySector = new Map<string, any[]>();

  if (!sectors?.length || !stocks?.length) {
    return [
      { id: "1", sector: "정보기술", score: 50 },
      { id: "2", sector: "헬스케어", score: 48 },
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

  const results: Array<{
    id: string;
    sector: string;
    score: number;
    score_raw?: number;
  }> = [];

  const spikeWeight = 12;
  const above20Weight = 15;

  for (const [sec, arr] of bySector.entries()) {
    let pts = 0,
      cnt = 0,
      above20 = 0,
      spikes = 0;

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

      const ret1s = squash((last - m1) / m1);
      const ret3s = squash((last - m3) / m3);
      const ret6s = squash((last - m6) / m6);
      const ret12s = squash((last - m12) / m12);

      pts += 0.35 * ret1s + 0.3 * ret3s + 0.2 * ret6s + 0.15 * ret12s;

      const s20 =
        closes.slice(-20).reduce((a: number, b: number) => a + b, 0) / 20;
      if (last > s20) above20++;

      const vols = series.map((x: any) => x.volume);
      const v20 =
        vols.slice(-21, -1).reduce((a: number, b: number) => a + b, 0) / 20;
      const today = series[series.length - 1];
      const range = (today.high - today.low) / Math.max(1, today.close);
      if (today.volume >= v20 * 2 && range <= 0.02) spikes++;
    }

    if (cnt === 0) continue;

    // 섹터별 원시 점수
    const score_raw =
      pts * 100 +
      (above20 / cnt) * above20Weight +
      (spikes / cnt) * spikeWeight;

    const secId = nameToId.get(sec) || "";
    results.push({ id: secId, sector: sec, score: 0, score_raw });
  }

  // 섹터 간 min–max 정규화
  const rawScores = results.map((r) => r.score_raw ?? 0);
  const min = Math.min(...rawScores);
  const max = Math.max(...rawScores);
  const span = Math.max(1e-6, max - min);

  for (const r of results) {
    const base = r.score_raw ?? 0;
    r.score = Math.round(clamp(((base - min) / span) * 100, 0, 100));
    delete r.score_raw;
  }

  await setCache(cacheKey, results, 600_000);
  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, 12)
    .map(({ id, sector, score }) => ({ id, sector, score }));
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
