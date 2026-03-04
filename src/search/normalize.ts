// src/search/normalize.ts
import { supabase } from "../db/client";
import { getCache, setCache } from "../cache/memory";
import { getUniverse } from "../adapters";

export type Hit = { code: string; name: string };

const TTL_24H = 24 * 60 * 60 * 1000;
const USE_DB_ONLY = (process.env.USE_DB_ONLY || "").toLowerCase() === "true";

// ── 영문 종목의 한글 별칭 맵 ──
// 사용자가 한글로 검색할 때 영문 이름 종목도 찾을 수 있도록
const KO_ALIASES: Record<string, string[]> = {
  "035420": ["네이버", "NAVER"],
  "003550": ["엘지", "LG"],
  "034730": ["에스케이", "SK"],
  "030200": ["케이티", "KT"],
  "033780": ["케이티앤지", "KT&G"],
  "000210": ["디엘", "DL"],
  "001040": ["씨제이", "CJ"],
  "002380": ["케이씨씨", "KCC"],
  "006260": ["엘에스", "LS"],
  "010120": ["엘에스일렉트릭", "LS일렉트릭", "LS ELECTRIC"],
  "010950": ["에스오일", "S-Oil", "에쓰오일"],
  "011200": ["에이치엠엠", "HMM", "현대상선"],
  "011790": ["에스케이씨", "SKC"],
  "012630": ["에이치디씨", "HDC"],
  "017940": ["이원", "E1"],
  "028300": ["에이치엘비", "HLB"],
  "035760": ["씨제이이엔엠", "CJ이엔엠", "CJENM"],
  "035900": ["제이와이피", "JYP"],
  "060250": ["엔에이치엔케이씨피", "NHN KCP"],
  "067160": ["숲", "SOOP", "아프리카TV"],
  "078930": ["지에스", "GS"],
  "079160": ["씨제이씨지브이", "CJ CGV", "CGV"],
  "093050": ["엘에프", "LF"],
  "095340": ["아이에스씨", "ISC"],
  "114090": ["지케이엘", "GKL", "그랜드코리아레저"],
  "181710": ["엔에이치엔", "NHN"],
  "218410": ["알에프에이치아이씨", "RFHIC"],
  "383220": ["에프앤에프", "F&F"],
  "403870": ["에이치피에스피", "HPSP"],
  "456040": ["오씨아이", "OCI"],
};

// 역방향: 별칭 → 코드 맵 (초기화 시 빌드)
const ALIAS_TO_CODE = new Map<string, string>();
for (const [code, aliases] of Object.entries(KO_ALIASES)) {
  for (const alias of aliases) {
    ALIAS_TO_CODE.set(alias.toLowerCase().replace(/\s+/g, ""), code);
  }
}

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

function scoreName(q: string, name: string, code?: string) {
  const nq = NORM(q),
    nn = NORM(name);
  if (!nq || !nn) return 0;

  // 정확 일치 (정규화 후)
  if (nn === nq) return 100;

  // 별칭 정확 일치
  if (code && KO_ALIASES[code]) {
    for (const alias of KO_ALIASES[code]) {
      if (NORM(alias) === nq) return 100;
    }
  }

  if (nn.startsWith(nq)) return 90;
  if (nn.includes(nq)) return 75;

  // 별칭 부분 매칭
  if (code && KO_ALIASES[code]) {
    for (const alias of KO_ALIASES[code]) {
      const na = NORM(alias);
      if (na.startsWith(nq)) return 85;
      if (na.includes(nq)) return 70;
    }
  }

  // 초성 보조 매칭 (예: ㅅㅅㅈ → 삼성전자)
  const cq = chosung(q),
    cn = chosung(name);
  if (cq && cn.includes(cq)) return 65;
  return 0;
}

async function loadUniverse(): Promise<Hit[]> {
  const cached = await getCache<Hit[]>("universe:all");
  if (cached?.length) return cached;

  const { data: dbRows } = await supabase
    .from("stocks")
    .select("code,name")
    .limit(50000);
  let items: Hit[] = (dbRows || []).map((r: any) => ({
    code: r.code,
    name: r.name,
  }));

  // DB가 비어 있지 않으면 DB만 사용, 비어 있으면 예외적으로 외부 폴백
  if (USE_DB_ONLY && items.length) {
    await setCache("universe:all", items, TTL_24H);
    return items;
  }
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
  const missing = codes.filter((c) => !out[c]);
  if (missing.length) {
    const uni = await loadUniverse();
    const mp = new Map(uni.map((x) => [x.code, x.name]));
    missing.forEach((c) => {
      const n = mp.get(c);
      if (n) out[c] = n;
    });
  }
  return out;
}

export async function searchByNameOrCode(q: string, topN = 1): Promise<Hit[]> {
  const n = NORM(q);

  // 1) 6자리 숫자 코드 즉시 반환
  if (/^\d{6}$/.test(n)) {
    const names = await getNamesForCodes([n]);
    if (names[n]) {
      return [{ code: n, name: names[n] }];
    }
    // DB에 없는 코드: 유니버스에서도 찾아봄
    const uni = await loadUniverse();
    const found = uni.find((x) => x.code === n);
    return found ? [found] : [];
  }

  // 2) 별칭 맵에서 정확 매칭 확인
  const aliasCode = ALIAS_TO_CODE.get(n);
  if (aliasCode) {
    const names = await getNamesForCodes([aliasCode]);
    const name = names[aliasCode] || aliasCode;
    // 만약 topN=1이면 바로 반환, 아니면 계속 검색
    if (topN <= 1) return [{ code: aliasCode, name }];
  }

  // 3) DB ILIKE 검색
  const { data } = await supabase
    .from("stocks")
    .select("code,name")
    .ilike("name", `%${q}%`)
    .limit(200);

  let dbHits: Hit[] = (data || []).map((r: any) => ({
    code: r.code,
    name: r.name,
  }));

  // 별칭 매칭도 포함: 한글 별칭이 쿼리와 매칭되는 종목 추가
  if (dbHits.length === 0 || topN > 1) {
    const aliasMatches: string[] = [];
    for (const [code, aliases] of Object.entries(KO_ALIASES)) {
      for (const alias of aliases) {
        if (NORM(alias).includes(n) || n.includes(NORM(alias))) {
          aliasMatches.push(code);
          break;
        }
      }
    }
    if (aliasMatches.length) {
      const { data: aliasData } = await supabase
        .from("stocks")
        .select("code,name")
        .in("code", aliasMatches);
      const existing = new Set(dbHits.map((h) => h.code));
      for (const r of aliasData || []) {
        if (!existing.has(r.code)) {
          dbHits.push({ code: r.code, name: r.name });
        }
      }
    }
  }

  // 4) 점수화 정렬 (정규화/초성/별칭 반영)
  const ranked = dbHits
    .map((h) => ({ ...h, _s: scoreName(q, h.name, h.code) }))
    .filter((h) => h._s >= 60)
    .sort((a, b) => b._s - a._s);

  if (ranked.length) return ranked.slice(0, topN).map(({ _s, ...h }) => h);

  // 5) 유니버스 폴백 (DB 미스 또는 시드 부족)
  const uni = await loadUniverse();
  const scored = uni
    .map((x) => ({
      code: x.code,
      name: x.name,
      _s: scoreName(q, x.name, x.code),
    }))
    .filter((x) => x._s >= 60)
    .sort((a, b) => b._s - a._s)
    .slice(0, topN)
    .map(({ _s, ...h }) => h);

  return scored;
}
