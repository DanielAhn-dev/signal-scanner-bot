// packages/data/sector.ts

// 테이블 스키마 가정:
// - sectors(id, name, metrics, score)
// - stocks(code, name, sector, liquidity)

export type SectorRow = {
  id?: string;
  name: string;
  metrics?: any;
  score?: number;
};

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

// ---------- utils ----------
function toArray<T>(x: any): T[] {
  if (Array.isArray(x)) return x;
  return []; // 비배열 응답 방어
}

function supa(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_ANON_KEY!;
  return { url, key };
}

// ---------- sectors ----------
/**
 * sectors 테이블에서 섹터 메타를 로드한다.
 * 비정상 응답/JSON 파싱 실패/배열 아님 → 빈 맵 반환.
 */
export async function loadSectorMap(): Promise<Record<string, SectorRow>> {
  const { url, key } = supa();
  const r = await fetch(`${url}/rest/v1/sectors?select=id,name,metrics,score`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  }).catch(() => null);

  if (!r || !r.ok) return {};
  const rows = toArray<SectorRow>(await r.json().catch(() => null));
  const out: Record<string, SectorRow> = {};
  for (const row of rows) {
    if (!row?.name) continue;
    out[row.name] = row;
  }
  return out;
}

/**
 * 상위 섹터 N개를 점수로 정렬해 반환한다.
 * score가 없으면 metrics.score → metrics.roc21 → 0 순으로 대체한다.
 */
export async function getTopSectors(
  limit = 6
): Promise<{ sector: string; score: number }[]> {
  const map = await loadSectorMap();
  const items = Object.entries(map).map(([name, v]) => {
    const m = v?.metrics || {};
    const s = Number.isFinite(v?.score)
      ? Number(v?.score)
      : Number(m?.score ?? m?.roc21 ?? 0);
    return { sector: name, score: Number.isFinite(s) ? s : 0 };
  });
  return items.sort((a, b) => b.score - a.score).slice(0, limit);
}

// ---------- leaders ----------
/**
 * 섹터 내 리더(유동성 상위) 코드를 반환한다.
 * liquidity 기준 내림차순 정렬, 결측은 0 처리, 최대 10개 반환.
 */
export async function getLeadersForSector(
  sector: string,
  limit = 10
): Promise<string[]> {
  const { url, key } = supa();
  const resp = await fetch(
    `${url}/rest/v1/stocks?select=code,sector,liquidity&sector=eq.${encodeURIComponent(
      sector
    )}`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  ).catch(() => null);

  if (!resp || !resp.ok) return [];
  const rows = toArray<{ code: string; sector?: string; liquidity?: number }>(
    await resp.json().catch(() => null)
  );

  return rows
    .filter((r) => r?.code)
    .sort((a, b) => Number(b?.liquidity ?? 0) - Number(a?.liquidity ?? 0))
    .slice(0, limit)
    .map((r) => r.code);
}

// ---------- names ----------
/**
 * 코드→이름 매핑을 반환한다.
 */
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

  if (!resp || !resp?.ok) return {};
  const rows = toArray<{ code: string; name: string }>(
    await resp.json().catch(() => null)
  );
  return Object.fromEntries(rows.filter(Boolean).map((r) => [r.code, r.name]));
}
