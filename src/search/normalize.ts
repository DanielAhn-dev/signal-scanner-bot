// src/search/normalize.ts
import { supabase } from "../db/client";
import { getCache, setCache } from "../cache/memory";
import { getUniverse } from "../adapters";

export type Hit = { code: string; name: string };

const TTL_24H = 24 * 60 * 60 * 1000;
const USE_DB_ONLY = (process.env.USE_DB_ONLY || "").toLowerCase() === "true";

const NORM = (s: string) =>
  s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()\u00B7\-\_\.]/g, "")
    .replace(/보통주|우선주|우B|우C|우D/g, "");

function chosung(t: string) {
  const n = t.normalize("NFC").replace(/[^가-힣]/g, "");
  return n
    .split("")
    .map((ch) => {
      const code = ch.charCodeAt(0) - 0xac00;
      if (code < 0 || code > 11171) return "";
      return String.fromCharCode(Math.floor(code / 588) + 0x1100);
    })
    .join("");
}

function scoreName(q: string, name: string) {
  const nq = NORM(q),
    nn = NORM(name);
  if (!nq || !nn) return 0;
  if (nn === nq) return 100;
  if (nn.startsWith(nq)) return 90;
  if (nn.includes(nq)) return 75;
  // 초성 보조 매칭 (예: ㅅㅅㅈ → 삼성전자)
  const cq = chosung(q),
    cn = chosung(name);
  if (cq && cn.includes(cq)) return 65;
  return 0;
}

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
    const list = await getUniverse("ALL");
    items = (list || []).map((x: any) => ({ code: x.code, name: x.name }));
  }

  if (items.length) await setCache("universe:all", items, TTL_24H);
  return items;
}

// 코드→이름 매핑은 우선적으로 DB에서 직접 조회
export async function getNamesForCodes(
  codes: string[]
): Promise<Record<string, string>> {
  const key = `nameMap:${codes.join(",")}`;
  const cached = await getCache<Record<string, string>>(key);
  if (cached) return cached;

  const out: Record<string, string> = {};

  if (codes.length) {
    const { data } = await supabase
      .from("stocks")
      .select("code,name")
      .in("code", codes);
    (data || []).forEach((r: any) => {
      out[r.code] = r.name;
    });
  }

  // 부족분은 유니버스에서 보강
  const missing = codes.filter((c) => !out[c]);
  if (missing.length) {
    const uni = await loadUniverse();
    const mp = new Map(uni.map((x) => [x.code, x.name]));
    missing.forEach((c) => {
      const n = mp.get(c);
      if (n) out[c] = n;
    });
  }

  await setCache(key, out, 10 * 60 * 1000);
  return out;
}

export async function searchByNameOrCode(q: string, topN = 1): Promise<Hit[]> {
  const n = NORM(q);

  // 6자리 숫자 코드 즉시 반환
  if (/^\d{6}$/.test(n)) {
    const names = await getNamesForCodes([n]);
    return [{ code: n, name: names[n] || n }];
  }

  // 1) DB ILIKE 우선
  const { data } = await supabase
    .from("stocks")
    .select("code,name")
    .ilike("name", `%${q}%`)
    .limit(200);

  const dbHits: Hit[] = (data || []).map((r: any) => ({
    code: r.code,
    name: r.name,
  }));

  // 2) 점수화 정렬 (정규화/초성 반영)
  const ranked = dbHits
    .map((h) => ({ ...h, _s: scoreName(q, h.name) }))
    .filter((h) => h._s >= 60)
    .sort((a, b) => b._s - a._s);

  if (ranked.length) return ranked.slice(0, topN).map(({ _s, ...h }) => h);

  // 3) 유니버스 폴백 (DB 미스 또는 시드 부족)
  const uni = await loadUniverse();
  const scored = uni
    .map((x) => ({ code: x.code, name: x.name, _s: scoreName(q, x.name) }))
    .filter((x) => x._s >= 60)
    .sort((a, b) => b._s - a._s)
    .slice(0, topN)
    .map(({ _s, ...h }) => h);

  return scored;
}
