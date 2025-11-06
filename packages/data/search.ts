// packages/data/search.ts
import { KRXClient } from "./krx-client";
import { createClient } from "@supabase/supabase-js";
import { getCache } from "./cache";

export type StockLite = {
  code: string;
  name: string;
  market: "KOSPI" | "KOSDAQ" | "KONEX" | string; // string fallback 허용 (TS2322 해결)
  sector?: string; // optional (미분류 fallback)
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

// Supabase 로드 (JOIN: safe any 접근, market 타입 fallback)
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
      .eq("is_active", true) // 활성 종목 필터 (인덱스 가정, 없으면 제거)
      .order("name"); // 정렬 추가 (성능)

    if (error) {
      console.error("Supabase load error:", error);
      return [];
    }

    // safe sector access: 단일 객체/배열/undefined 처리 (TS2352/TS2588 해결)
    return (data || [])
      .map((r: any): StockLite => {
        // : StockLite 반환 타입 가드
        let sectorName: string = "미분류";
        if (r.sectors) {
          if (
            typeof r.sectors === "object" &&
            r.sectors !== null &&
            "name" in r.sectors
          ) {
            sectorName = (r.sectors as { name: string }).name || "미분류"; // 단일 객체
          } else if (Array.isArray(r.sectors) && r.sectors.length > 0) {
            console.warn(
              "Unexpected array for sectors in loadFromSupabase:",
              r.sectors
            );
            sectorName = (r.sectors[0] as { name: string })?.name || "미분류"; // 배열 fallback
          }
        }

        // market fallback: string | union 직접 할당 (186 라인 TS2322 해결)
        const market = (r.market as "KOSPI" | "KOSDAQ" | "KONEX") || "KOSPI"; // string OK

        const item: StockLite = {
          code: r.code || "",
          name: r.name || "",
          market,
          sector: sectorName, // string 보장 (optional but filled)
        };
        return item;
      })
      .filter((item): item is StockLite => !!(item.code && item.name)); // 전체 타입 가드 (TS2677 해결)
  } catch (e) {
    console.error("loadFromSupabase error:", e);
    return [];
  }
}

// Supabase upsert (sector_id null로 초기, 나중 매핑)
async function upsertToSupabase(list: StockLite[]): Promise<void> {
  if (!list.length) return;
  try {
    const { error } = await supabase.from("stocks").upsert(
      list.map((s: StockLite) => ({
        code: s.code,
        name: s.name,
        market: s.market, // string 허용
        sector_id: null, // 초기 null (ingest-data.ts에서 매핑 업데이트)
        is_active: true,
      })),
      { onConflict: "code" }
    );
    if (error) console.error("Supabase upsert error:", error);
    else console.log(`Upserted ${list.length} stocks to Supabase`);
  } catch (e) {
    console.error("upsertToSupabase error:", e);
  }
}

export async function ensureStockList(): Promise<StockLite[]> {
  const now = Date.now();
  if (cache.length && now - lastLoaded < 6 * 60 * 60 * 1000) return cache; // 6시간 TTL
  if (!loadingPromise) {
    loadingPromise = (async () => {
      let list = await loadFromSupabase();
      const MIN = 2000;
      const incomplete =
        !list.length || list.length < MIN || list.some((x) => !x?.name);
      if (incomplete) {
        console.log("Supabase incomplete, falling back to KRX...");
        const krx = new KRXClient();
        const raw = await krx.getStockList("ALL");
        list = raw
          .map(
            (x: any): StockLite => ({
              // : StockLite 타입
              code: x.code,
              name: x.name,
              market: x.market || "KOSPI", // string fallback
              sector: "미분류", // 기본
            })
          )
          .filter((item): item is StockLite => !!(item.code && item.name));
        if (list.length > MIN) await upsertToSupabase(list); // Supabase 채우기
      }
      cache = list;
      lastLoaded = now;
      loadingPromise = null;
      console.log(`Stock list loaded: ${list.length} items`);
      return cache;
    })();
  }
  return loadingPromise!;
}

export async function searchByNameOrCode(
  q: string,
  limit = 8
): Promise<StockLite[]> {
  if (!q || typeof q !== "string") return [];
  if (/^\d{6}$/.test(q)) {
    // 코드 검색: Supabase single() + safe access
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
      .eq("is_active", true)
      .single();

    if (error) {
      console.error("Code search Supabase error:", error);
    } else if (data) {
      // safe sector access (동일 로직)
      let sectorName: string = "미분류";
      if (data.sectors) {
        if (
          typeof data.sectors === "object" &&
          data.sectors !== null &&
          "name" in data.sectors
        ) {
          sectorName = (data.sectors as { name: string }).name || "미분류";
        } else if (Array.isArray(data.sectors) && data.sectors.length > 0) {
          console.warn("Unexpected array for sectors in search:", data.sectors);
          sectorName = (data.sectors[0] as { name: string })?.name || "미분류";
        }
      }

      // market fallback (TS2322 해결)
      const market = (data.market as "KOSPI" | "KOSDAQ" | "KONEX") || "KOSPI";

      return [
        {
          code: data.code || q,
          name: data.name || q,
          market,
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
          market: match.market || "KOSPI", // string OK
          sector: "미분류",
        },
      ];
    }
    return [{ code: q, name: q, market: "KOSPI" as const, sector: "미분류" }];
  }

  // 이름 검색
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
    results = results.filter((r: StockLite) => r.sector === sectorFilter);
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
      .in("code", codes)
      .eq("is_active", true);

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
    if (missing.length > 0) {
      const krx = new KRXClient();
      const rawList = await krx.getStockList("ALL");
      missing.forEach((c) => {
        const match = rawList.find((x: any) => x.code === c);
        map[c] = match ? match.name : c;
      });
    }
    return map;
  } catch (e) {
    console.error("getNamesForCodes error:", e);
    return Object.fromEntries(codes.map((c) => [c, c]));
  }
}
