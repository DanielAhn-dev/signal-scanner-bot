// packages/data/sector.ts
import { KRXClient } from "./krx-client";

export type SectorRow = {
  id?: string;
  name: string;
  metrics?: any;
  score?: number;
};

type TopSector = { sector: string; score: number; leaders: string[] };

function toArray<T>(x: any): T[] {
  if (Array.isArray(x)) return x;
  return [];
}

function supa() {
  return {
    url: process.env.SUPABASE_URL!,
    key: process.env.SUPABASE_ANON_KEY!,
  };
}

// 코드→섹터 매핑 로드(없으면 빈 맵)
export async function loadCodeToSector(): Promise<Record<string, string>> {
  const { url, key } = supa();
  const r = await fetch(`${url}/rest/v1/stocks?select=code,sector`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  }).catch(() => null);
  if (!r || !r.ok) return {};
  const rows = toArray<{ code: string; sector?: string }>(
    await r.json().catch(() => null)
  );
  const map: Record<string, string> = {};
  for (const it of rows) if (it?.code && it?.sector) map[it.code] = it.sector;
  return map;
}

// sectors 테이블(정적 점수)이 있으면 사용
export async function loadSectorMap(): Promise<Record<string, SectorRow>> {
  const { url, key } = supa();
  const r = await fetch(`${url}/rest/v1/sectors?select=id,name,metrics,score`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  }).catch(() => null);
  if (!r || !r.ok) return {};
  const rows = toArray<SectorRow>(await r.json().catch(() => null));
  const out: Record<string, SectorRow> = {};
  for (const row of rows) if (row?.name) out[row.name] = row;
  return out;
}

// 정적 점수 기반 상위 섹터(있으면 우선)
export async function getTopSectors(
  limit = 5
): Promise<{ sector: string; score: number }[]> {
  const map = await loadSectorMap();
  const items = Object.entries(map).map(([name, v]) => {
    const m = v?.metrics || {};
    const s = Number.isFinite(v?.score)
      ? Number(v?.score)
      : Number(m?.score ?? m?.roc21 ?? 0);
    return { sector: name, score: Number.isFinite(s) ? s : 0 };
  });
  const ranked = items.sort((a, b) => b.score - a.score).slice(0, limit);
  // 비어 있으면 실시간 폴백
  if (!ranked.length) {
    const rt = await getTopSectorsRealtime(limit);
    return rt.map((x) => ({ sector: x.sector, score: x.score }));
  }
  return ranked;
}

// 실시간 폴백: 거래대금 상위 종목을 업종/섹터로 집계
export async function getTopSectorsRealtime(limit = 5): Promise<TopSector[]> {
  const krx = new KRXClient();
  const [ks, kq] = await Promise.all([
    krx.getTopVolumeStocks("STK", 120),
    krx.getTopVolumeStocks("KSQ", 120),
  ]);
  const hot = [...ks, ...kq]; // 당일 거래대금 상위 합산(스냅샷)

  const codeToSector = await loadCodeToSector();
  // 섹터별 누적
  const bucket = new Map<
    string,
    {
      amount: number;
      sumChg: number;
      count: number;
      leaders: { code: string; amount: number }[];
    }
  >();

  for (const it of hot) {
    const sector = codeToSector[it.code] || "기타";
    const cell = bucket.get(sector) || {
      amount: 0,
      sumChg: 0,
      count: 0,
      leaders: [],
    };
    cell.amount += it.amount || 0;
    cell.sumChg += it.change || 0;
    cell.count += 1;
    cell.leaders.push({ code: it.code, amount: it.amount || 0 });
    bucket.set(sector, cell);
  }

  // 점수: 거래대금 z 유사 정규화 + 평균 등락률 가중(0.7/0.3)
  const values = [...bucket.values()].map((b) => b.amount);
  const mean = values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1);
  const sd =
    Math.sqrt(
      values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) /
        Math.max(values.length, 1)
    ) || 1;

  const ranked: TopSector[] = [...bucket.entries()]
    .map(([sector, b]) => {
      const z = (b.amount - mean) / sd;
      const avgChg = b.sumChg / Math.max(b.count, 1);
      const score = z * 70 + avgChg * 30; // 가중합
      const leaders = b.leaders
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 10)
        .map((x) => x.code);
      return { sector, score, leaders };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return ranked;
}

// 섹터 리더(정적/실시간 모두 대응)
export async function getLeadersForSector(
  sector: string,
  limit = 10
): Promise<string[]> {
  // 실시간 집계에 섹터가 있으면 그 결과 사용
  const rt = await getTopSectorsRealtime(20);
  const found = rt.find((s) => s.sector === sector);
  if (found && found.leaders.length) return found.leaders.slice(0, limit);

  // DB 기반 폴백
  const { url, key } = supa();
  const resp = await fetch(
    `${url}/rest/v1/stocks?select=code,sector,liquidity&sector=eq.${encodeURIComponent(
      sector
    )}`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  ).catch(() => null);
  if (!resp || !resp.ok) return [];
  const rows = toArray<{ code: string; liquidity?: number }>(
    await resp.json().catch(() => null)
  );
  return rows
    .filter((r) => r?.code)
    .sort((a, b) => Number(b?.liquidity ?? 0) - Number(a?.liquidity ?? 0))
    .slice(0, limit)
    .map((r) => r.code);
}

// 코드→이름 매핑
export async function getNamesForCodes(
  codes: string[]
): Promise<Record<string, string>> {
  if (!codes.length) return {};
  const { url, key } = supa();
  const inList = codes.map((c) => `"${c}"`).join(",");
  const resp = await fetch(
    `${url}/rest/v1/stocks?select=code,name&code=in.(${inList})`,
    {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    }
  ).catch(() => null);
  if (!resp || !resp?.ok) return {};
  const rows = toArray<{ code: string; name: string }>(
    await resp.json().catch(() => null)
  );
  return Object.fromEntries(rows.map((r) => [r.code, r.name]));
}
