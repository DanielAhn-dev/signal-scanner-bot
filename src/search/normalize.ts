// src/search/normalize.ts (교체)
import { supabase } from "../db/client";
import { getCache, setCache } from "../cache/memory";
import KRXClient from "../adapters/krx/client";

const krx = new KRXClient();

function normalize(s: string) {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()·\-_.]/g, "");
}

export async function getNamesForCodes(
  codes: string[]
): Promise<Record<string, string>> {
  const cached = await getCache<Record<string, string>>(
    `nameMap:${codes.join(",")}`
  );
  if (cached) return cached;
  const map: Record<string, string> = {};
  // 1) DB에서
  const { data } = await supabase
    .from("stocks")
    .select("code,name")
    .in("code", codes);
  (data || []).forEach((r: any) => {
    if (r?.code) map[r.code] = r.name;
  });
  // 2) KRX 폴백
  const list = await krx.getStockList("ALL");
  const byCode = new Map(list.map((x: any) => [x.code, x.name]));
  codes.forEach((c) => {
    if (!map[c] && byCode.get(c)) map[c] = byCode.get(c)!;
  });
  await setCache(`nameMap:${codes.join(",")}`, map, 10 * 60_000);
  return map;
}

export async function searchByNameOrCode(
  q: string,
  topN = 1
): Promise<{ code: string; name: string }[]> {
  const n = normalize(q);
  // 코드 직접 입력
  if (/^\d{6}$/.test(n)) {
    const m = await getNamesForCodes([n]);
    return [{ code: n, name: m[n] || n }];
  }
  // DB 이름 ILIKE 우선
  const { data } = await supabase
    .from("stocks")
    .select("code,name")
    .ilike("name", `%${q}%`)
    .limit(topN);
  if (data?.length)
    return data.map((r: any) => ({ code: r.code, name: r.name }));
  // KRX 폴백(간단 점수 매칭)
  const list = await krx.getStockList("ALL");
  const scored = list
    .map((x: any) => {
      const nn = normalize(x.name);
      let score = 0;
      if (nn === n) score = 100;
      else if (nn.startsWith(n)) score = 90;
      else if (nn.includes(n)) score = 70;
      return { code: x.code, name: x.name, score };
    })
    .filter((x: any) => x.score > 0)
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, topN);
  return scored;
}
