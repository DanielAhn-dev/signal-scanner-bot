// packages/data/sector.ts
import { KRXClient } from "./krx-client";

export type SectorRow = {
  id?: string;
  name: string;
  category?: string;
  metrics?: any;
  score?: number;
};
type TopSector = { sector: string; score: number; leaders: string[] };

function toArray<T>(x: any): T[] {
  return Array.isArray(x) ? x : [];
}
function supa() {
  return {
    url: process.env.SUPABASE_URL!,
    key: process.env.SUPABASE_ANON_KEY!,
  };
}

// ---- 핵심 변경 1: sector_id 기반 조회 ----
export async function loadSectorMap(): Promise<Record<string, SectorRow>> {
  const { url, key } = supa();
  const r = await fetch(
    `${url}/rest/v1/sectors?select=id,name,category,metrics,score&order=id`,
    {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    }
  ).catch(() => null);
  if (!r || !r.ok) return {};
  const rows = toArray<SectorRow>(await r.json().catch(() => null));
  const out: Record<string, SectorRow> = {};
  for (const row of rows) if (row?.name) out[row.name] = row;
  return out;
}

export async function getTopSectors(
  limit = 5
): Promise<{ sector: string; score: number }[]> {
  const map = await loadSectorMap();
  const items = Object.entries(map).map(([name, v]) => {
    const m = v?.metrics || {};
    const score = Number.isFinite(v?.score)
      ? Number(v?.score)
      : Number(m?.score ?? m?.roc21 ?? 0);
    return { sector: name, score: Number.isFinite(score) ? score : 0 };
  });
  const ranked = items.sort((a, b) => b.score - a.score).slice(0, limit);
  if (ranked.length) return ranked;
  return (await getTopSectorsRealtime(limit)).map((x) => ({
    sector: x.sector,
    score: x.score,
  }));
}

// ---- 실시간 섹터(거래대금 기반) ----
export async function getTopSectorsRealtime(limit = 5): Promise<TopSector[]> {
  const krx = new KRXClient();
  const [ks, kq] = await Promise.all([
    krx.getTopVolumeStocks("STK", 100),
    krx.getTopVolumeStocks("KSQ", 100),
  ]);
  const hot = [...ks, ...kq];
  const hotCodes = hot.map((x) => x.code);

  // 핵심 변경 2: stocks의 sector_id + sectors.name 조인으로 섹터명 매핑
  const { url, key } = supa();
  const inList = hotCodes.map((c) => `"${c}"`).join(",");
  const resp = await fetch(
    `${url}/rest/v1/stocks?select=code,sector_id,sectors(name)&code=in.(${inList})`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  ).catch(() => null);

  const codeToSector: Record<string, string> = {};
  if (resp?.ok) {
    const rows = toArray<{
      code: string;
      sector_id?: number;
      sectors?: { name: string };
    }>(await resp.json().catch(() => null));
    for (const r of rows) {
      if (r?.code && r?.sectors?.name) codeToSector[r.code] = r.sectors.name;
    }
  }

  // 거래대금 기준으로 섹터별 bucket 생성
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
    const s = codeToSector[it.code] || "미분류";
    const cell = bucket.get(s) || {
      amount: 0,
      sumChg: 0,
      count: 0,
      leaders: [],
    };
    cell.amount += it.amount || 0;
    cell.sumChg += it.change || 0;
    cell.count += 1;
    cell.leaders.push({ code: it.code, amount: it.amount || 0 });
    bucket.set(s, cell);
  }

  const totalAmt = [...bucket.values()].reduce((a, b) => a + b.amount, 0) || 1;
  const values = [...bucket.values()].map((b) => b.amount);
  const mean = values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1);
  const sd =
    Math.sqrt(
      values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) /
        Math.max(values.length, 1)
    ) || 1;

  const entries = [...bucket.entries()].map(([sector, b]) => {
    const z = (b.amount - mean) / sd;
    const avgChg = b.sumChg / Math.max(b.count, 1);
    const score = z * 70 + avgChg * 30;
    const leaders = b.leaders
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10)
      .map((x) => x.code);
    return { sector, score, leaders };
  });

  const hasNonMisc = entries.some((e) => e.sector !== "미분류");
  return entries
    .sort((a, b) => b.score - a.score)
    .filter((x) => (hasNonMisc ? x.sector !== "미분류" : true))
    .slice(0, limit);
}

// ---- 핵심 변경 3: sector_id 기반 종목 조회 ----
export async function getLeadersForSector(
  sector: string,
  limit = 10
): Promise<string[]> {
  const rt = await getTopSectorsRealtime(30);
  const found = rt.find((s) => s.sector === sector);
  if (found?.leaders?.length) return found.leaders.slice(0, limit);

  const { url, key } = supa();

  // 섹터명으로 sector id 조회
  const sr = await fetch(
    `${url}/rest/v1/sectors?select=id&name=eq.${encodeURIComponent(
      sector
    )}&limit=1`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  ).catch(() => null);

  if (!sr?.ok) return [];
  const sectorRows = toArray<{ id: string }>(await sr.json().catch(() => null));
  if (!sectorRows.length) return [];
  const sectorId = sectorRows[0].id;

  // sector_id로 stocks 조회
  const resp = await fetch(
    `${url}/rest/v1/stocks?select=code,liquidity&sector_id=eq.${sectorId}&order=liquidity.desc&limit=${limit}`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  ).catch(() => null);

  if (!resp?.ok) return [];
  const rows = toArray<{ code: string; liquidity?: number }>(
    await resp.json().catch(() => null)
  );
  return rows.map((r) => r.code);
}

export async function getNamesForCodes(
  codes: string[]
): Promise<Record<string, string>> {
  if (!codes.length) return {};
  const { url, key } = supa();
  const inList = codes.map((c) => `"${c}"`).join(",");
  const r = await fetch(
    `${url}/rest/v1/stocks?select=code,name&code=in.(${inList})`,
    {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    }
  ).catch(() => null);
  if (!r?.ok) return {};
  const rows = toArray<{ code: string; name: string }>(
    await r.json().catch(() => null)
  );
  return Object.fromEntries(rows.map((r) => [r.code, r.name]));
}
