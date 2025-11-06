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
  return Array.isArray(x) ? x : [];
} // [attached_file:4]
function supa() {
  return {
    url: process.env.SUPABASE_URL!,
    key: process.env.SUPABASE_ANON_KEY!,
  };
} // [attached_file:4]

// 간단한 동시성 제한
async function mapLimit<T, R>(
  arr: T[],
  n: number,
  fn: (x: T) => Promise<R>
): Promise<R[]> {
  const ret: R[] = [];
  let i = 0;
  const workers = Array(Math.min(n, arr.length))
    .fill(0)
    .map(async () => {
      while (i < arr.length) {
        const idx = i++;
        ret[idx] = await fn(arr[idx]);
      }
    });
  await Promise.all(workers);
  return ret;
} // [attached_file:4]

// 코드→섹터 매핑(주 DB)
export async function loadCodeToSector(): Promise<Record<string, string>> {
  const { url, key } = supa();
  const r = await fetch(`${url}/rest/v1/stocks?select=code,sector`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  }).catch(() => null);
  if (!r || !r.ok) return {}; // [attached_file:4]
  const rows = toArray<{ code: string; sector?: string }>(
    await r.json().catch(() => null)
  );
  const map: Record<string, string> = {};
  for (const it of rows) if (it?.code && it?.sector) map[it.code] = it.sector;
  return map; // [attached_file:4]
}

// 네이버에서 업종명 폴백 추출
async function fetchSectorFromNaver(code: string): Promise<string> {
  try {
    const resp = await fetch(
      `https://finance.naver.com/item/main.nhn?code=${code}`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    if (!resp.ok) return ""; // [web:10]
    const html = await resp.text();
    // '업종' 셀의 앵커 텍스트 추출 (classic PC 페이지 패턴)
    const m = html.match(/업종<\/th>\s*<td[^>]*>\s*<a[^>]*>([^<]+)<\/a>/i);
    return m ? m[1].trim() : ""; // [web:10]
  } catch {
    return "";
  }
} // [web:10]

// 부족 매핑 보강: 상위 코드 집합에 대해 네이버 폴백 후 DB 업서트
async function enrichSectorsIfNeeded(
  codes: string[]
): Promise<Record<string, string>> {
  const base = await loadCodeToSector(); // [attached_file:4]
  const missing = codes.filter((c) => !base[c]); // [attached_file:4]
  if (!missing.length) return base; // [attached_file:4]

  const pairs = await mapLimit(missing, 6, async (c) => {
    const s = await fetchSectorFromNaver(c);
    return { code: c, sector: s || "기타" };
  }); // [web:10]

  const valid = pairs.filter((p) => p.sector && p.sector !== ""); // [attached_file:4]
  if (valid.length) {
    const { url, key } = supa();
    await fetch(`${url}/rest/v1/stocks`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates",
      },
      body: JSON.stringify(
        valid.map((v) => ({ code: v.code, sector: v.sector }))
      ),
    }).catch(() => {});
  } // [attached_file:4]
  const out = { ...base };
  for (const v of valid) out[v.code] = v.sector;
  return out; // [attached_file:4]
}

// 정적 섹터 맵
export async function loadSectorMap(): Promise<Record<string, SectorRow>> {
  const { url, key } = supa();
  const r = await fetch(`${url}/rest/v1/sectors?select=id,name,metrics,score`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  }).catch(() => null);
  if (!r || !r.ok) return {}; // [attached_file:4]
  const rows = toArray<SectorRow>(await r.json().catch(() => null));
  const out: Record<string, SectorRow> = {};
  for (const row of rows) if (row?.name) out[row.name] = row;
  return out; // [attached_file:4]
}

// 정적 우선→없으면 실시간
export async function getTopSectors(
  limit = 5
): Promise<{ sector: string; score: number }[]> {
  const map = await loadSectorMap(); // [attached_file:4]
  const items = Object.entries(map).map(([name, v]) => {
    const m = v?.metrics || {};
    const s = Number.isFinite(v?.score)
      ? Number(v?.score)
      : Number(m?.score ?? m?.roc21 ?? 0);
    return { sector: name, score: Number.isFinite(s) ? s : 0 };
  }); // [attached_file:4]
  const ranked = items.sort((a, b) => b.score - a.score).slice(0, limit); // [attached_file:4]
  if (ranked.length) return ranked; // [attached_file:4]
  const rt = await getTopSectorsRealtime(limit);
  return rt.map((x) => ({ sector: x.sector, score: x.score })); // [attached_file:4]
}

// 실시간 섹터 산출(거래대금 상위 기반)
export async function getTopSectorsRealtime(limit = 5): Promise<TopSector[]> {
  const krx = new KRXClient();
  const [ks, kq] = await Promise.all([
    krx.getTopVolumeStocks("STK", 120),
    krx.getTopVolumeStocks("KSQ", 120),
  ]); // [web:21]
  const hot = [...ks, ...kq];
  const hotCodes = hot.map((x) => x.code); // [web:21]
  // 코드→섹터 보강
  const codeToSector = await enrichSectorsIfNeeded(hotCodes); // [attached_file:4]

  const bucket = new Map<
    string,
    {
      amount: number;
      sumChg: number;
      count: number;
      leaders: { code: string; amount: number }[];
    }
  >(); // [attached_file:4]
  for (const it of hot) {
    const s = codeToSector[it.code] || "기타"; // [attached_file:4]
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
  } // [attached_file:4]

  // 커버리지 체크: '기타' 비중이 60% 넘으면 상위 섹터 노출 억제
  const totalAmt = [...bucket.values()].reduce((a, b) => a + b.amount, 0) || 1; // [attached_file:4]
  const etcAmt = bucket.get("기타")?.amount || 0;
  const etcShare = etcAmt / totalAmt; // [attached_file:4]

  const values = [...bucket.values()].map((b) => b.amount);
  const mean = values.reduce((a, b) => a + b, 0) / Math.max(values.length, 1);
  const sd =
    Math.sqrt(
      values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) /
        Math.max(values.length, 1)
    ) || 1; // [attached_file:4]

  const ranked: TopSector[] = [...bucket.entries()]
    .map(([sector, b]) => {
      const z = (b.amount - mean) / sd;
      const avgChg = b.sumChg / Math.max(b.count, 1);
      const score = z * 70 + avgChg * 30;
      const leaders = b.leaders
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 10)
        .map((x) => x.code);
      return { sector, score, leaders };
    })
    .sort((a, b) => b.score - a.score)
    .filter((x) => x.sector !== "기타" || etcShare < 0.6) // 기타 과대 시 숨김
    .slice(0, limit); // [attached_file:4]

  return ranked; // [attached_file:4]
}

// 리더
export async function getLeadersForSector(
  sector: string,
  limit = 10
): Promise<string[]> {
  const rt = await getTopSectorsRealtime(20);
  const found = rt.find((s) => s.sector === sector);
  if (found?.leaders?.length) return found.leaders.slice(0, limit); // [attached_file:4][web:21]
  const { url, key } = supa();
  const resp = await fetch(
    `${url}/rest/v1/stocks?select=code,sector,liquidity&sector=eq.${encodeURIComponent(
      sector
    )}`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  ).catch(() => null);
  if (!resp || !resp.ok) return []; // [attached_file:4]
  const rows = toArray<{ code: string; liquidity?: number }>(
    await resp.json().catch(() => null)
  );
  return rows
    .filter((r) => r?.code)
    .sort((a, b) => Number(b?.liquidity ?? 0) - Number(a?.liquidity ?? 0))
    .slice(0, limit)
    .map((r) => r.code); // [attached_file:4]
}

// 코드→이름
export async function getNamesForCodes(
  codes: string[]
): Promise<Record<string, string>> {
  if (!codes.length) return {};
  const { url, key } = supa();
  const inList = codes.map((c) => `"${c}"`).join(",");
  const resp = await fetch(
    `${url}/rest/v1/stocks?select=code,name&code=in.(${inList})`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  ).catch(() => null);
  if (!resp || !resp?.ok) return {}; // [attached_file:4]
  const rows = toArray<{ code: string; name: string }>(
    await resp.json().catch(() => null)
  );
  return Object.fromEntries(rows.map((r) => [r.code, r.name])); // [attached_file:4]
}
