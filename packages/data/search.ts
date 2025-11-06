// packages/data/search.ts
import { KRXClient } from "./krx-client";
import { createClient } from "@supabase/supabase-js";

export type StockLite = {
  code: string;
  name: string;
  market: "KOSPI" | "KOSDAQ" | "KONEX";
  sector?: string; // optional 유지
};

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

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

// Supabase 로드 (JOIN: safe any 접근으로 TS2352/TS2588 해결)
async function loadFromSupabase(): Promise<StockLite[]> {
  try {
    const { data, error } = await supabase
      .from("stocks")
      .select(
        `
        code,
        name,
        market,
        sector_id,
        sectors!inner(name)
      `
      )
      .eq("is_active", true); // is_active 없으면 제거
    if (error) {
      console.error("Supabase load error:", error);
      return [];
    }
    // safe access: r.sectors?.name 직접 (as 캐스트 제거, 배열 fallback let 변수로)
    return (data || [])
      .map((r: any) => {
        let sectorName = "미분류";
        if (r.sectors) {
          if (typeof r.sectors === "object" && "name" in r.sectors) {
            sectorName = (r.sectors as any).name || "미분류"; // 단일 객체
          } else if (Array.isArray(r.sectors) && r.sectors.length > 0) {
            console.warn(
              "Unexpected array for sectors in loadFromSupabase:",
              r.sectors
            );
            sectorName = (r.sectors[0] as any)?.name || "미분류"; // 배열 fallback (let 필요 없음, 직접 할당)
          }
        }
        const item = {
          code: r.code || "",
          name: r.name || "",
          market: (r.market as "KOSPI" | "KOSDAQ" | "KONEX") || "KOSPI",
          sector: sectorName, // string 보장
        };
        return item;
      })
      .filter((item) => !!(item.code && item.name)); // TS2677 해결: sector optional이므로 전체 StockLite 가드 (sector undefined 허용 안 함, but constructed에서 string)
  } catch (e) {
    console.error("loadFromSupabase error:", e);
    return [];
  }
}

// Supabase upsert
async function upsertToSupabase(list: StockLite[]): Promise<void> {
  if (!list.length) return;
  try {
    const { error } = await supabase.from("stocks").upsert(
      list.map((s) => ({
        code: s.code,
        name: s.name,
        market: s.market,
        sector_id: null,
        is_active: true,
      })),
      { onConflict: "code" }
    );
    if (error) console.error("Supabase upsert error:", error);
  } catch (e) {
    console.error("upsertToSupabase error:", e);
  }
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
          sector: "미분류",
        }));
        if (list.length > MIN) await upsertToSupabase(list);
      }
      cache = list;
      lastLoaded = now;
      loadingPromise = null;
      return cache;
    })();
  }
  return loadingPromise!;
}

export async function searchByNameOrCode(
  q: string,
  limit = 8
): Promise<StockLite[]> {
  if (!q) return [];
  if (/^\d{6}$/.test(q)) {
    // 코드 검색: Supabase single() + safe access (TS2352/TS2588 해결)
    const { data, error } = await supabase
      .from("stocks")
      .select(
        `
        code,
        name,
        market,
        sector_id,
        sectors!inner(name)
      `
      )
      .eq("code", q)
      .single();
    if (error) {
      console.error("Code search Supabase error:", error);
    } else if (data) {
      let sectorName = "미분류";
      if (data.sectors) {
        if (typeof data.sectors === "object" && "name" in data.sectors) {
          sectorName = (data.sectors as any).name || "미분류";
        } else if (Array.isArray(data.sectors) && data.sectors.length > 0) {
          console.warn("Unexpected array for sectors in search:", data.sectors);
          sectorName = (data.sectors[0] as any)?.name || "미분류";
        }
      }
      return [
        {
          code: data.code || q,
          name: data.name || q,
          market: (data.market as "KOSPI" | "KOSDAQ" | "KONEX") || "KOSPI",
          sector: sectorName,
        },
      ];
    }
    // KRX 폴백
    const krx = new KRXClient();
    const rawList = await krx.getStockList("ALL");
    const match = rawList.find((x: any) => x.code === q);
    if (match) {
      return [
        {
          code: q,
          name: match.name,
          market: match.market || "KOSPI",
          sector: "미분류",
        },
      ];
    }
    return [{ code: q, name: q, market: "KOSPI" as const, sector: "미분류" }];
  }

  const list = await ensureStockList();
  const filteredList = list.filter(
    (x): x is StockLite => !!(x?.name && x?.code)
  );
  const nq = normalize(q);
  const exact = filteredList.find((x) => normalize(x.name) === nq);
  if (exact) return [exact];
  return filteredList
    .map((x) => ({ x, s: scoreName(q, x.name) }))
    .filter((r): r is { x: StockLite; s: number } => r.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((r) => r.x);
}

export async function searchByNameOrCodeAndSector(
  q: string,
  sectorFilter?: string,
  limit = 8
): Promise<StockLite[]> {
  let results = await searchByNameOrCode(q, limit * 2);
  if (sectorFilter && sectorFilter !== "미분류") {
    results = results.filter((r) => r.sector === sectorFilter);
  }
  return results.slice(0, limit);
}

export async function getNamesForCodes(
  codes: string[]
): Promise<Record<string, string>> {
  if (!codes.length) return {};
  try {
    const { data, error } = await supabase
      .from("stocks")
      .select("code, name")
      .in("code", codes);
    if (error) {
      console.error("getNamesForCodes Supabase error:", error);
      return {};
    }
    const map: Record<string, string> = {};
    (data || []).forEach((r: { code: string; name: string }) => {
      map[r.code] = r.name;
    });

    // 누락된 코드 KRX로 채우기
    const missing = codes.filter((c) => !map[c]);
    if (missing.length) {
      const krx = new KRXClient();
      const rawList = await krx.getStockList("ALL");
      missing.forEach((c) => {
        const match = rawList.find((x: any) => x.code === c);
        if (match) {
          map[c] = match.name;
        } else {
          map[c] = c;
        }
      });
    }
    return map;
  } catch (e) {
    console.error("getNamesForCodes error:", e);
    return Object.fromEntries(codes.map((c) => [c, c]));
  }
}
