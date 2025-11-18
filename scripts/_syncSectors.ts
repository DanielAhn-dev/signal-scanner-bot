import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs/promises";
import path from "node:path";
import KRXClient from "../src/adapters/krx/client";

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

// 안전한 JSON 로더: 파일 없거나 비어있거나, JSON이 깨졌을 때 기본값 반환
async function safeReadJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const txt = typeof raw === "string" ? raw.trim() : "";
    if (!txt) return fallback; // 빈 파일이면 기본값
    return JSON.parse(txt) as T;
  } catch {
    return fallback; // ENOENT, EISDIR, JSON.parse 에러 등 모두 기본값
  }
}

// import.meta.url 없이 스크립트 파일 경로 계산 (CJS/tsx 모두 호환)
function getScriptDir(): string {
  // tsx, node 모두 첫 번째 인자에 실행 스크립트 경로가 들어옴
  const byArg = process.argv?.[1];
  if (byArg && path.isAbsolute(byArg)) {
    return path.dirname(byArg);
  }
  // fallback: require.main.filename (CJS 런타임에서 보통 설정됨)
  // @ts-ignore
  const mainFile = typeof require !== "undefined" && require?.main?.filename;
  if (typeof mainFile === "string" && mainFile.length > 0) {
    return path.dirname(mainFile);
  }
  // 최후: 현재 작업 디렉토리
  return process.cwd();
}

const SCRIPT_DIR = getScriptDir();
// scripts/ 기준으로 상위 루트
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");

type AliasRow = { alias: string; sector_id: string };
type StockMeta = { name: string | null; market: string | null };

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
  throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
}

const supa = createClient(
  process.env.SUPABASE_URL as string,
  process.env.SUPABASE_ANON_KEY as string,
  { auth: { persistSession: false } }
);

const krx = new KRXClient();
const BATCH = 300;

let sectors: any[] = [];
let aliases: AliasRow[] = [];
let aliasMap = new Map<string, string>();

if (!Array.isArray(sectors)) {
  console.warn("sectors.json is not an array. Skip.");
  sectors = [];
}
if (!Array.isArray(aliases)) {
  console.warn("sector_aliases.json is not an array. Skip.");
  aliases = [];
}

function normalizeLabel(label: string): string {
  return (label || "").trim().replace(/\s+/g, "").toLowerCase();
}

function mapToSectorId(label: string | null) {
  if (!label) return null;
  const norm = normalizeLabel(label);
  // 1) alias 우선
  const viaAlias = aliasMap.get(norm);
  if (viaAlias) return viaAlias;
  // 2) 표준명 직매핑
  return STD_SECTOR_MAP[label] ?? null;
}
async function loadMetaFromAdapters(code: string): Promise<StockMeta> {
  try {
    const [k1, k2] = await Promise.allSettled([
      krx.getStockList("KOSPI"),
      krx.getStockList("KOSDAQ"),
    ]);
    const arr1 = k1.status === "fulfilled" ? k1.value : [];
    const arr2 = k2.status === "fulfilled" ? k2.value : [];
    const hit = [...arr1, ...arr2].find((x: any) => x.code === code);
    return { name: hit?.name ?? null, market: hit?.market ?? null };
  } catch {
    return { name: null, market: null };
  }
}
async function loadIndustryLabel(code: string): Promise<string | null> {
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

async function upsertStandardSectors() {
  for (let i = 0; i < sectors.length; i += BATCH) {
    const chunk = sectors.slice(i, i + BATCH);
    const { error: sErr } = await supa
      .from("sectors")
      .upsert(chunk, { onConflict: "id" });
    if (sErr) {
      console.error("sectors upsert error", sErr);
      process.exit(1);
    }
  }
}

async function backfillStocks() {
  const { data: rows } = await supa
    .from("stocks")
    .select("code,name,market,sector_id")
    .limit(5000);

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

    if (!name || name === r.code || !market) {
      const meta = await loadMetaFromAdapters(r.code);
      if ((!name || name === r.code) && meta.name) name = meta.name;
      if (!market && meta.market) market = meta.market;
    }

    if (!sector_id || sector_id.startsWith("DUMMY:")) {
      const label = await loadIndustryLabel(r.code);
      const mapped = mapToSectorId(label);
      if (mapped) sector_id = mapped;
    }

    const hasFix =
      (!!name && name !== r.name) ||
      (!!market && market !== r.market) ||
      (!!sector_id && sector_id !== r.sector_id);

    if (hasFix) {
      patches.push({ code: r.code, name, market, sector_id });
      if (patches.length >= BATCH) {
        await supa.from("stocks").upsert(patches, { onConflict: "code" });
        patches.length = 0;
      }
    }
  }

  if (patches.length) {
    await supa.from("stocks").upsert(patches, { onConflict: "code" });
  }
}

(async () => {
  const sectorsPath = path.join(DATA_DIR, "sectors.json");
  const aliasesPath = path.join(DATA_DIR, "sector_aliases.json");

  // 비어 있거나 존재하지 않으면 []로 처리
  sectors = await safeReadJson<any[]>(sectorsPath, []);
  aliases = await safeReadJson<AliasRow[]>(aliasesPath, []);
  aliasMap = new Map<string, string>(
    (aliases || []).map((a: AliasRow) => [normalizeLabel(a.alias), a.sector_id])
  );

  await upsertStandardSectors();
  await backfillStocks();

  if (sectors.length === 0) {
    console.warn("[syncSectors] sectors.kr.json empty. Abort.");
    process.exit(0);
  }

  console.log("sync done");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
