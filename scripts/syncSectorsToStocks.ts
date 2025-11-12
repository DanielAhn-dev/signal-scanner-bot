// scripts/syncSectorsToStocks.ts
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs/promises";
import path from "node:path";

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
}
const supa = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  {
    auth: { persistSession: false },
  }
);

const SCRIPT_DIR = (() => {
  const byArg = process.argv?.[1];
  if (byArg && path.isAbsolute(byArg)) return path.dirname(byArg);
  // @ts-ignore
  const mainFile = typeof require !== "undefined" && require?.main?.filename;
  if (typeof mainFile === "string" && mainFile.length > 0)
    return path.dirname(mainFile);
  return process.cwd();
})();
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const SECTORS_PATH = path.join(DATA_DIR, "sectors.json");
const ALIASES_PATH = path.join(DATA_DIR, "sector_aliases.json");

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
const BATCH = 300;
const REQUEST_DELAY_MS = 200;

const STD_SECTOR_MAP: Record<string, string> = {
  정보기술: "KRX:IT",
  커뮤니케이션: "KRX:COMM",
  헬스케어: "KRX:HLTH",
  에너지: "KRX:ENRG",
  금융: "KRX:FIN",
  산업재: "KRX:IND",
  소재: "KRX:MATR",
  필수소비재: "KRX:CSTM",
  임의소비재: "KRX:DSCR",
  유틸리티: "KRX:UTIL",
};

type AliasRow = { alias: string; sector_id: string };

async function safeReadJson<T>(p: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(p, "utf8");
    const txt = typeof raw === "string" ? raw.trim() : "";
    if (!txt) return fallback;
    return JSON.parse(txt) as T;
  } catch {
    return fallback;
  }
}

function normalizeLabel(label: string | null | undefined): string {
  if (!label) return "";
  return label.trim().replace(/\s+/g, "").toLowerCase();
}

async function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

async function loadIndustryLabel(code: string): Promise<string | null> {
  try {
    const url = `https://finance.naver.com/item/main.nhn?code=${code}`;
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) return null;
    const html = await res.text();
    const m =
      html.match(/업종[^\n]*?<a[^>]*>([^<]+)<\/a>/) ||
      html.match(/업종(?:<\/span>|<\/th>)\s*<[^>]*>\s*([^<\n]+)/);
    const labelRaw = m?.[1]?.trim() ?? "";
    return labelRaw || null;
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    console.warn(`[loadIndustryLabel] ${code} fetch failed:`, errMsg);
    return null;
  }
}

(async function main() {
  // 1) 로컬 파일 로드
  const sectorsFromFile = await safeReadJson<any[]>(SECTORS_PATH, []);
  const aliases = await safeReadJson<AliasRow[]>(ALIASES_PATH, []);
  const aliasMap = new Map<string, string>(
    (aliases || []).map((a) => [normalizeLabel(a.alias), a.sector_id])
  );

  // 2) 파일 기반 섹터를 DB에 upsert (id 기준) — 꼭 먼저 수행해야 FK 통과
  if (sectorsFromFile.length > 0) {
    console.log(
      `[sync] Upserting ${sectorsFromFile.length} sectors into DB...`
    );
    for (let i = 0; i < sectorsFromFile.length; i += BATCH) {
      const chunk = sectorsFromFile.slice(i, i + BATCH);
      const { error } = await supa
        .from("sectors")
        .upsert(chunk, { onConflict: "id" });
      if (error) {
        console.error("[sync] sectors upsert error:", error);
        process.exit(1);
      }
    }
    console.log("[sync] sectors upsert done.");
  } else {
    console.log("[sync] sectors.json empty — skip upsert.");
  }

  // 3) DB에서 섹터를 읽어 name->id, id 집합을 구성 (DB가 진짜 소스)
  const { data: dbSectors, error: fetchSectorsErr } = await supa
    .from("sectors")
    .select("id,name");
  if (fetchSectorsErr) {
    console.error("[sync] failed to fetch sectors from DB:", fetchSectorsErr);
    process.exit(1);
  }
  const nameToId = new Map<string, string>();
  const existingIds = new Set<string>();
  for (const s of (dbSectors || []) as Array<{ id: string; name: string }>) {
    if (s && s.name && s.id) {
      nameToId.set(normalizeLabel(String(s.name)), String(s.id));
      existingIds.add(String(s.id));
    }
  }

  // 4) 매핑 함수: alias -> nameToId(DB) -> STD_MAP
  function mapToSectorId(label: string | null): string | null {
    if (!label) return null;
    const norm = normalizeLabel(label);
    const viaAlias = aliasMap.get(norm);
    if (viaAlias) return viaAlias;
    const viaName = nameToId.get(norm);
    if (viaName) return viaName;
    const fallback = STD_SECTOR_MAP[label] ?? null;
    return fallback;
  }

  // 5) stocks 조회 (여기서는 활성화된 종목 전체 불러온 뒤 JS에서 필터)
  const { data: rows } = await supa
    .from("stocks")
    .select("code,name,market,sector_id")
    .is("is_active", true)
    .limit(20000);
  if (!rows || (rows as any[]).length === 0) {
    console.log("[sync] no stocks rows found. exit.");
    process.exit(0);
  }

  const patches: Array<{ code: string; sector_id?: string | null }> = [];

  for (const r of rows as Array<any>) {
    const code = r.code as string;
    const curSector = r.sector_id as string | null;

    if (curSector && !curSector.startsWith("DUMMY:")) continue;

    const label = await loadIndustryLabel(code);
    await sleep(REQUEST_DELAY_MS);

    const mapped = mapToSectorId(label);

    if (mapped) {
      // DB에 실제 존재하는 id인지 체크 (외래키 보호)
      if (!existingIds.has(mapped)) {
        console.warn(
          `[sync] mapped id not present in sectors DB, skipping: ${mapped} (code ${code}, label "${label}")`
        );
        continue;
      }
      patches.push({ code, sector_id: mapped });
      console.log(`[sync] ${code} -> "${label}" => ${mapped}`);
    } else {
      console.log(`[sync] ${code} -> "${label}" => (no mapping)`);
    }

    if (patches.length >= BATCH) {
      console.log(`[sync] updating batch ${patches.length}`);
      // update only (avoid null name issue)
      for (const p of patches) {
        if (!p.sector_id) continue;
        const { error } = await supa
          .from("stocks")
          .update({ sector_id: p.sector_id })
          .eq("code", p.code);
        if (error) {
          console.error("[sync] stocks update error for", p.code, error);
        }
      }
      patches.length = 0;
    }
  }

  // 동시성 업데이트 헬퍼 (명시적 타입)
  async function updateConcurrently(
    items: Array<{ code: string; sector_id?: string | null }>,
    concurrency = 10
  ): Promise<Array<{ code: string; error: any }>> {
    const todo = items.filter((p) => p.sector_id) as Array<{
      code: string;
      sector_id: string;
    }>;
    let idx = 0;
    const results: Array<{ code: string; error: any }> = [];
    async function worker() {
      while (true) {
        const i = idx++;
        if (i >= todo.length) return;
        const p = todo[i];
        const { error } = await supa
          .from("stocks")
          .update({ sector_id: p.sector_id })
          .eq("code", p.code);
        results.push({ code: p.code, error });
        if (error) console.error("[sync] update error", p.code, error);
        else console.log(`[sync] updated ${p.code}`);
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(concurrency, todo.length) }, () => worker())
    );
    return results;
  }

  // 사용: 마지막 패치들 처리
  if (patches.length > 0) {
    console.log(`[sync] updating final ${patches.length} items (concurrent)`);
    await updateConcurrently(patches, 8);
  }

  console.log("[sync] done");
  process.exit(0);
})().catch((e) => {
  const errMsg = e instanceof Error ? e.message : String(e);
  console.error(errMsg);
  process.exit(1);
});
