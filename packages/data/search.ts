// packages/data/search.ts
import { KRXClient } from "./krx-client";

export type StockLite = {
  code: string;
  name: string;
  market: "KOSPI" | "KOSDAQ" | "KONEX";
};

let cache: StockLite[] = [];
let lastLoaded = 0;

function normalize(s: string) {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()·\-_.]/g, "");
}

function scoreName(q: string, name: string) {
  const nq = normalize(q);
  const nn = normalize(name);
  if (nn === nq) return 100;
  if (nn.startsWith(nq)) return 90;
  if (nn.includes(nq)) return 70;
  return 0;
}

async function loadFromSupabase(): Promise<StockLite[]> {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_ANON_KEY!;
  // fetch 대신 간단 REST 호출로 최소 의존
  const resp = await fetch(`${url}/rest/v1/stocks?select=code,name,market`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  if (!resp.ok) return [];
  const rows = (await resp.json()) as any[];
  return (rows || []).map((r) => ({
    code: r.code,
    name: r.name,
    market: r.market,
  }));
}

async function upsertToSupabase(list: StockLite[]) {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_ANON_KEY!;
  await fetch(`${url}/rest/v1/stocks`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(list),
  }).catch(() => {});
}

export async function ensureStockList(): Promise<StockLite[]> {
  const now = Date.now();
  if (cache.length && now - lastLoaded < 6 * 60 * 60 * 1000) return cache;
  // 1) Supabase 캐시 시도
  let list = await loadFromSupabase();
  if (!list.length) {
    // 2) KRX 실데이터 조회
    const krx = new KRXClient();
    const raw = await krx.getStockList("ALL");
    list = raw.map((x) => ({ code: x.code, name: x.name, market: x.market }));
    if (list.length) upsertToSupabase(list).catch(() => {});
  }
  cache = list;
  lastLoaded = now;
  return list;
}

export async function searchByNameOrCode(
  q: string,
  limit = 8
): Promise<StockLite[]> {
  // 6자리 숫자는 코드 직행 지원
  if (/^\d{6}$/.test(q))
    return [{ code: q, name: q, market: "KOSPI" } as StockLite];
  const list = await ensureStockList();
  const nq = normalize(q);
  const exact = list.find((x) => normalize(x.name) === nq);
  if (exact) return [exact];
  const scored = list
    .map((x) => ({ x, s: scoreName(nq, x.name) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((r) => r.x);
  return scored;
}
