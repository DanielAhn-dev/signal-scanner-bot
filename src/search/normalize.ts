// src/search/normalize.ts (교체)
import { supabase } from "../db/client";
import { getCache, setCache } from "../cache/memory";
import { getUniverse } from "../adapters";

type Hit = { code: string; name: string };

const NORM = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()·\-_.]/g, "")
    .replace(/보통주|우선주/g, "");

async function loadUniverse(): Promise<Hit[]> {
  const cached = await getCache<Hit[]>("universe:all");
  if (cached?.length) return cached;
  // 1) DB
  const { data } = await supabase
    .from("stocks")
    .select("code,name")
    .limit(50000);
  let items: Hit[] = (data || []).map((r: any) => ({
    code: r.code,
    name: r.name,
  }));
  // 2) 어댑터 폴백
  if (!items.length) {
    const list = await getUniverse("ALL"); // [{code,name,market}]
    items = (list || []).map((x: any) => ({ code: x.code, name: x.name }));
  }
  // 메모리 TTL 24h
  await setCache("universe:all", items, 24 * 60 * 60 * 1000);
  return items;
}

export async function getNamesForCodes(
  codes: string[]
): Promise<Record<string, string>> {
  const key = `nameMap:${codes.join(",")}`;
  const cached = await getCache<Record<string, string>>(key);
  if (cached) return cached;
  const map: Record<string, string> = {};
  const uni = await loadUniverse();
  const byCode = new Map(uni.map((x) => [x.code, x.name]));
  codes.forEach((c) => {
    if (byCode.get(c)) map[c] = byCode.get(c)!;
  });
  await setCache(key, map, 10 * 60 * 1000);
  return map;
}

export async function searchByNameOrCode(q: string, topN = 1): Promise<Hit[]> {
  const n = NORM(q);
  if (/^\d{6}$/.test(n)) {
    const names = await getNamesForCodes([n]);
    return [{ code: n, name: names[n] || n }];
  }
  // DB ILIKE 우선
  const { data } = await supabase
    .from("stocks")
    .select("code,name")
    .ilike("name", `%${q}%`)
    .limit(topN);
  if (data?.length)
    return data.map((r: any) => ({ code: r.code, name: r.name }));

  // 유니버스 폴백 + 점수화
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
