// packages/data/sector.ts
import { KRXClient } from "./krx-client";

export type SectorMetric = {
  sector: string;
  codes: string[];
  score: number;
  stats: {
    r1m: number;
    r3m: number;
    r6m: number;
    r12m: number;
    sma20Above: number;
    roc21: number;
  };
};

// Supabase에서 sector가 채워진 종목군 로드
async function loadSectorMap(
  limitPerSector = 12
): Promise<Record<string, string[]>> {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_ANON_KEY!;
  const resp = await fetch(
    `${url}/rest/v1/stocks?select=code,sector&not.is.null=sector`,
    {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    }
  );
  const rows = (await resp.json()) as { code: string; sector?: string }[];
  const map: Record<string, string[]> = {};
  for (const r of rows) {
    const s = (r.sector || "").trim();
    if (!s) continue;
    if (!map[s]) map[s] = [];
    if (map[s].length < limitPerSector) map[s].push(r.code);
  }
  return map;
}

function sma(values: number[], n: number) {
  const out: number[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    out.push(i >= n - 1 ? sum / n : NaN);
  }
  return out;
}
const pct = (a: number, b: number) => (b === 0 ? 0 : ((a - b) / b) * 100);

export async function getTopSectors(maxSectors = 6): Promise<SectorMetric[]> {
  const sectorMap = await loadSectorMap(12);
  const krx = new KRXClient();
  const end = new Date();
  const start = new Date(end.getTime() - 270 * 24 * 60 * 60 * 1000);
  const endDate = end.toISOString().slice(0, 10);
  const startDate = start.toISOString().slice(0, 10);

  const results: SectorMetric[] = [];
  for (const [sector, codes] of Object.entries(sectorMap)) {
    // 대표 5종만 사용
    const pick = codes.slice(0, 5);
    const metrics: {
      r1m: number;
      r3m: number;
      r6m: number;
      r12m: number;
      sma20Above: number;
      roc21: number;
    }[] = [];
    for (const code of pick) {
      const o = await krx.getMarketOHLCV(code, startDate, endDate);
      if (o.length < 200) continue;
      const c = o.map((d) => d.close);
      const s20 = sma(c, 20);
      const last = c.length - 1,
        d21 = last - 21,
        d63 = last - 63,
        d126 = last - 126,
        d252 = last - 252;
      const r1m = d21 > 0 ? pct(c[last], c[d21]) : 0;
      const r3m = d63 > 0 ? pct(c[last], c[d63]) : 0;
      const r6m = d126 > 0 ? pct(c[last], c[d126]) : 0;
      const r12m = d252 > 0 ? pct(c[last], c[d252]) : 0;
      const sma20Above = !isNaN(s20[last]) && c[last] > s20[last] ? 1 : 0;
      const roc21 = d21 > 0 ? pct(c[last], c[d21]) : 0;
      metrics.push({ r1m, r3m, r6m, r12m, sma20Above, roc21 });
      if (metrics.length >= 5) break;
    }
    if (!metrics.length) continue;
    const avg = (k: keyof (typeof metrics)[number]) =>
      metrics.reduce((a, b) => a + (b[k] as number), 0) / metrics.length;
    // 간단 점수: 모멘텀(1/3/6/12M) + 20SMA 상회비중 + ROC(21) 근접
    const score =
      avg("r1m") * 0.25 +
      avg("r3m") * 0.25 +
      avg("r6m") * 0.2 +
      avg("r12m") * 0.1 +
      avg("sma20Above") * 20 +
      (10 - Math.abs(avg("roc21"))) * 1.2;
    results.push({
      sector,
      codes: codes.slice(0, 10),
      score,
      stats: {
        r1m: avg("r1m"),
        r3m: avg("r3m"),
        r6m: avg("r6m"),
        r12m: avg("r12m"),
        sma20Above: avg("sma20Above"),
        roc21: avg("roc21"),
      },
    });
  }
  return results.sort((a, b) => b.score - a.score).slice(0, maxSectors);
}

export async function getLeadersForSector(sector: string): Promise<string[]> {
  const map = await loadSectorMap(50);
  const list = map[sector] || [];
  return list.slice(0, 10);
}

export async function getNamesForCodes(
  codes: string[]
): Promise<Record<string, string>> {
  if (!codes.length) return {};
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_ANON_KEY!;
  const inList = codes.map((c) => `"${c}"`).join(",");
  const resp = await fetch(
    `${url}/rest/v1/stocks?select=code,name&code=in.(${inList})`,
    {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    }
  );
  if (!resp.ok) return {};
  const rows = (await resp.json()) as { code: string; name: string }[];
  return Object.fromEntries(rows.map((r) => [r.code, r.name]));
}
