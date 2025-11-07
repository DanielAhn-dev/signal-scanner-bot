// src/search/normalize.ts
import { supabase } from "../db/client";
import { getCache, setCache } from "../cache/memory";
import { getUniverse } from "../adapters";

type Hit = { code: string; name: string };
const TTL_24H = 24 * 60 * 60 * 1000;
const USE_DB_ONLY = (process.env.USE_DB_ONLY || "").toLowerCase() === "true";

const NORM = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()\u00B7\-\_\.]/g, "")
    .replace(/보통주|우선주/g, "");

async function loadUniverse(): Promise<Hit[]> {
  const cached = await getCache<Hit[]>("universe:all");
  if (cached?.length) return cached;

  // 1) DB 우선
  const { data: dbRows } = await supabase
    .from("stocks")
    .select("code,name")
    .limit(50000);
  let items: Hit[] = (dbRows || []).map((r: any) => ({
    code: r.code,
    name: r.name,
  }));

  if (USE_DB_ONLY) {
    if (items.length) await setCache("universe:all", items, TTL_24H);
    return items; // 비어있으면 캐시하지 않음
  }

  // 2) 외부 어댑터 폴백
  if (!items.length) {
    const list = await getUniverse("ALL"); // [{code,name,market}]
    items = (list || []).map((x: any) => ({ code: x.code, name: x.name }));
  }

  // 3) 캐시 저장 (빈 배열은 저장 금지)
  if (items.length) await setCache("universe:all", items, TTL_24H);
  return items;
}

export async function getNamesForCodes(
  codes: string[]
): Promise<Record<string, string>> {
  const key = `nameMap:${codes.join(",")}`;
  const cached = await getCache<Record<string, string>>(key);
  if (cached) return cached;

  const uni = await loadUniverse();
  const byCode = new Map(uni.map((x) => [x.code, x.name]));
  const map: Record<string, string> = {};
  codes.forEach((c) => {
    const name = byCode.get(c);
    if (name) map[c] = name;
  });

  await setCache(key, map, 10 * 60 * 1000);
  return map;
}

export async function searchByNameOrCode(q: string, topN = 1): Promise<Hit[]> {
  const n = NORM(q);

  // 6자리 코드는 즉시 통과
  if (/^\d{6}$/.test(n)) {
    const names = await getNamesForCodes([n]);
    return [{ code: n, name: names[n] || n }];
  }

  // 1) DB ILIKE
  const { data } = await supabase
    .from("stocks")
    .select("code,name")
    .ilike("name", `%${q}%`)
    .limit(topN);
  if (data?.length)
    return data.map((r: any) => ({ code: r.code, name: r.name }));

  // 2) 유니버스 폴백 + 점수화
  const uni = await loadUniverse();
  const scored = uni
    .map((x) => {
      const nx = NORM(x.name);
      let s = 0;
      if (nx === n) s = 100;
      else if (nx.startsWith(n)) s = 90;
      else if (nx.includes(n)) s = 70;
      return { code: x.code, name: x.name, s };
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, topN);

  return scored;
}
