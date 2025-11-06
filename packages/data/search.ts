// packages/data/search.ts
import { KRXClient } from "./krx-client";

export type StockLite = {
  code: string;
  name: string;
  market: "KOSPI" | "KOSDAQ" | "KONEX";
};

let cache: StockLite[] = [];
let lastLoaded = 0;
let loadingPromise: Promise<StockLite[]> | null = null;

function normalize(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()·\-_.]/g, "");
}

function scoreName(q: string, name: string): number {
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
  const r = await fetch(`${url}/rest/v1/stocks?select=code,name,market`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!r.ok) return [];
  const rows = (await r.json()) as any[];
  return (rows || []).map((r) => ({
    code: r.code,
    name: r.name,
    market: r.market,
  }));
}

async function upsertToSupabase(list: StockLite[]): Promise<void> {
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

  if (!loadingPromise) {
    loadingPromise = (async () => {
      let list = await loadFromSupabase();
      const MIN = 2000;
      const incomplete =
        !list.length || list.length < MIN || list.some((x) => !x?.name);

      if (incomplete) {
        const krx = new KRXClient();
        const raw = await krx.getStockList("ALL");
        list = raw.map((x: any) => ({
          code: x.code,
          name: x.name,
          market: x.market,
        }));
        if (list.length) await upsertToSupabase(list);
      }

      cache = list;
      lastLoaded = now;
      loadingPromise = null;
      return list;
    })();
  }
  return loadingPromise!;
}

export async function searchByNameOrCode(
  q: string,
  limit = 8
): Promise<StockLite[]> {
  if (/^\d{6}$/.test(q))
    return [{ code: q, name: q, market: "KOSPI" } as StockLite];
  const list = (await ensureStockList()).filter((x) => x?.name && x?.code);
  const nq = normalize(q);
  const exact = list.find((x) => normalize(x.name) === nq);
  if (exact) return [exact];
  return list
    .map((x) => ({ x, s: scoreName(nq, x.name) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((r) => r.x);
}

export async function getNamesForCodes(
  codes: string[]
): Promise<Record<string, string>> {
  if (!codes.length) return {};
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_ANON_KEY!;
  const inList = codes.map((c) => `"${c}"`).join(",");
  const r = await fetch(
    `${url}/rest/v1/stocks?select=code,name&code=in.(${inList})`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  if (!r.ok) return {};
  const rows = (await r.json()) as { code: string; name: string }[];
  return Object.fromEntries(rows.map((r) => [r.code, r.name]));
}
