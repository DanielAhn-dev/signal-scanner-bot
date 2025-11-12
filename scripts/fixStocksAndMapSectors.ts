// scripts/fixStocksAndMapSectors.ts
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs/promises";
import path from "node:path";
import KRXClient from "../src/adapters/krx/client";

const BATCH = 300;

function getScriptDir(): string {
  const byArg = process.argv?.[1];
  if (byArg && path.isAbsolute(byArg)) return path.dirname(byArg);
  // @ts-ignore
  const mainFile = typeof require !== "undefined" && require?.main?.filename;
  if (typeof mainFile === "string" && mainFile.length > 0)
    return path.dirname(mainFile);
  return process.cwd();
}
const ROOT = path.resolve(getScriptDir(), "..");
const DATA_DIR = path.join(ROOT, "data");

type SectorRow = {
  id: string;
  name: string;
  metrics?: Record<string, unknown>;
  score?: number;
};
type StockMeta = { name: string | null; market: string | null };

async function safeReadJson<T>(p: string, fb: T): Promise<T> {
  try {
    const raw = await fs.readFile(p, "utf8");
    const t = raw.trim();
    if (!t) return fb;
    return JSON.parse(t) as T;
  } catch {
    return fb;
  }
}

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

async function fetchIndustryLabelFromNaver(
  code: string
): Promise<string | null> {
  try {
    const url = `https://finance.naver.com/item/main.nhn?code=${code}`;
    const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return null;
    const html = await res.text();
    const m = html.match(/업종(?:<\/span>|<\/th>)\s*<[^>]*>\s*([^<\n]+)/);
    const labelRaw = m?.[1]?.trim() ?? "";
    return labelRaw || null;
  } catch {
    return null;
  }
}

async function upsertSectors(supa: any) {
  const sectorsPath = path.join(DATA_DIR, "sectors.json");
  const sectors = await safeReadJson<SectorRow[]>(sectorsPath, []);
  if (!Array.isArray(sectors) || sectors.length === 0) {
    console.error("[fix] data/sectors.json is empty.");
    process.exit(1);
  }
  const rows = sectors
    .map((s) => ({
      id: String(s.id).trim(),
      name: String(s.name).trim(),
      metrics: s.metrics ?? {},
      score: typeof s.score === "number" ? s.score : 0,
    }))
    .filter((s) => s.id && s.name);
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error } = await supa
      .from("sectors")
      .upsert(chunk, { onConflict: "id" });
    if (error) {
      console.error("[fix] sectors upsert error:", error);
      process.exit(1);
    }
  }
}

async function fixStocksAndMap(supa: any, krx: KRXClient) {
  const { data: rows, error } = await supa
    .from("stocks")
    .select("code,name,market,sector_id")
    .limit(10000);
  if (error) throw error;

  const patches: Array<{
    code: string;
    name?: string | null;
    market?: string | null;
    sector_id?: string | null;
  }> = [];

  for (const r of rows || []) {
    let name: string | null = r.name;
    let market: string | null = r.market;
    let sector_id: string | null = r.sector_id;

    // 1) 이름/마켓 보정
    if (!name || name === r.code || !market) {
      try {
        const [k1, k2] = await Promise.allSettled([
          krx.getStockList("KOSPI"),
          krx.getStockList("KOSDAQ"),
        ]);
        const arr1 = k1.status === "fulfilled" ? k1.value : [];
        const arr2 = k2.status === "fulfilled" ? k2.value : [];
        const hit = [...arr1, ...arr2].find((x: any) => x.code === r.code);
        if ((!name || name === r.code) && hit?.name) name = hit.name;
        if (!market && hit?.market) market = hit.market;
      } catch {}
    }

    // 2) 섹터 매핑(별칭 없이 표준명 직접 매칭)
    if (!sector_id) {
      const label = await fetchIndustryLabelFromNaver(r.code);
      if (label && STD_SECTOR_MAP[label]) {
        sector_id = STD_SECTOR_MAP[label];
      }
    }

    const hasFix =
      (!!name && name !== r.name) ||
      (!!market && market !== r.market) ||
      (!!sector_id && sector_id !== r.sector_id);

    if (hasFix) {
      patches.push({ code: r.code, name, market, sector_id });
      if (patches.length >= BATCH) {
        const { error: uerr } = await supa
          .from("stocks")
          .upsert(patches, { onConflict: "code" });
        if (uerr) throw uerr;
        patches.length = 0;
      }
    }
  }

  if (patches.length) {
    const { error: uerr } = await supa
      .from("stocks")
      .upsert(patches, { onConflict: "code" });
    if (uerr) throw uerr;
  }
}

async function main() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_ANON_KEY!;
  if (!url || !key)
    throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");

  const supa = createClient(url, key, { auth: { persistSession: false } });
  const krx = new KRXClient();

  await upsertSectors(supa);
  await fixStocksAndMap(supa, krx);

  console.log("[fix] done");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
