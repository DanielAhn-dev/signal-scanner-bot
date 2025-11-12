import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs/promises";
import path from "node:path";
import * as iconv from "iconv-lite";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const BATCH = 500;

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
const OUT_FILE = path.join(DATA_DIR, "sectors.json");

type SectorRow = {
  id: string;
  name: string;
  metrics?: Record<string, unknown>;
  score?: number;
};

async function writeJson(p: string, v: unknown) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(v, null, 2), "utf8");
}

// 유니코드 문자(letters/numbers)를 보존하는 슬러그 생성기
function baseSlug(name: string) {
  // \p{L} = any kind of letter in any language, \p{N} = number
  // 'u' 플래그로 유니코드 프로퍼티 사용
  return name
    .normalize("NFKD")
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{N}_]+/gu, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

// 중복 방지를 포함한 슬러그 생성기 (usedSet으로 기존/지금까지 생성한 slug 체크)
function generateUniqueSlug(name: string, usedSet: Set<string>) {
  let slug = baseSlug(name) || "UNNAMED";
  let candidate = slug;
  let i = 1;
  while (usedSet.has(candidate)) {
    candidate = `${slug}_${i++}`;
  }
  usedSet.add(candidate);
  return candidate;
}

async function fetchSectorsFromNaverUpjongPage(): Promise<string[]> {
  const url = "https://finance.naver.com/sise/sise_group.naver?type=upjong";
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA } });
    if (!res.ok) {
      console.error(`[fetchSectors] Naver status error: ${res.status}`);
      return [];
    }

    const arrayBuffer = await res.arrayBuffer();
    const buf = Buffer.from(arrayBuffer);
    const html = iconv.decode(buf, "euc-kr");

    const sectorRegex =
      /<a href="\/sise\/sise_group_detail\.naver\?type=upjong&no=\d+">([^<]+)<\/a>/g;

    const names: string[] = [];
    let match;
    while ((match = sectorRegex.exec(html)) !== null) {
      const name = match[1].trim();
      if (name.length > 0) names.push(name);
    }
    return Array.from(new Set(names));
  } catch (error) {
    console.error(
      "[fetchSectors] Failed to fetch or parse Naver upjong page:",
      error
    );
    return [];
  }
}

async function main() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_ANON_KEY!;
  const supa = createClient(url, key, { auth: { persistSession: false } });

  console.log("[seedSectors] Fetching sectors from Naver (Upjong page)...");
  const names = await fetchSectorsFromNaverUpjongPage();
  if (names.length === 0) {
    console.error("[seedSectors] failed to collect sectors from Naver.");
    process.exit(1);
  }
  console.log(`[seedSectors] Found ${names.length} sectors from Naver.`);

  // 1) DB에 있는 기존 섹터를 불러와 맵으로 보관 (삭제 방지 + 병합)
  const { data: existingData, error: fetchErr } = await supa
    .from("sectors")
    .select("*");
  if (fetchErr) {
    console.error("[seedSectors] failed to fetch existing sectors:", fetchErr);
    process.exit(1);
  }
  const existingMap = new Map<string, SectorRow>();
  (existingData ?? []).forEach((r: any) => {
    existingMap.set(r.id, {
      id: r.id,
      name: r.name,
      metrics: r.metrics,
      score: r.score ?? 0,
    });
  });

  // 2) 새로 생성할 rows (슬러그 고유화 적용)
  const usedSlugs = new Set<string>();
  // 이미 DB에 존재하는 id들(슬러그 부분)을 used에 추가하면 같은 id 재생성 방지 가능
  for (const id of existingMap.keys()) {
    // 만약 기존 id 형식이 "SECTOR:KRX:..."라면 슬러그 부분을 usedSlugs에 넣어 중복생성 방지
    const parts = id.split(":");
    const possibleSlug = parts.slice(2).join(":"); // works whether id has prefix or not
    if (possibleSlug) usedSlugs.add(possibleSlug.toUpperCase());
  }

  const rows: SectorRow[] = names
    .sort((a, b) => a.localeCompare(b, "ko"))
    .map((name) => {
      const slug = generateUniqueSlug(name, usedSlugs); // 예: "화학" -> "화학" 또는 "화학_1"
      const id = `KRX:${slug}`; // 기존 코드와 호환되는 prefix 사용(원하면 수정 가능)
      return {
        id,
        name,
        metrics: {
          sources: ["NAVER_UPJONG"],
          fetched_at: new Date().toISOString(),
        },
        score: 0,
      };
    });

  // 3) 기존 DB와 병합: existingMap을 기반으로, 새 항목은 추가/갱신(메트릭 병합)
  for (const r of rows) {
    if (existingMap.has(r.id)) {
      const prev = existingMap.get(r.id)!;
      existingMap.set(r.id, {
        ...prev,
        name: r.name || prev.name,
        score: r.score ?? prev.score,
        metrics: {
          ...(prev.metrics ?? {}),
          ...(r.metrics ?? {}),
        },
      });
    } else {
      existingMap.set(r.id, r);
    }
  }

  const mergedRows = Array.from(existingMap.values());
  await writeJson(OUT_FILE, mergedRows);
  console.log(
    `[seedSectors] wrote ${mergedRows.length} merged sectors to ${OUT_FILE}`
  );

  // 4) 업서트는 mergedRows로 수행 (기존 레코드 유지 + 갱신)
  for (let i = 0; i < mergedRows.length; i += BATCH) {
    const chunk = mergedRows.slice(i, i + BATCH);
    console.log(
      `[seedSectors] Upserting batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(
        mergedRows.length / BATCH
      )} (${chunk.length} items)`
    );
    const { error } = await supa
      .from("sectors")
      .upsert(chunk, { onConflict: "id" });
    if (error) {
      console.error("[seedSectors] Supabase upsert error:", error);
      throw error;
    }
  }

  console.log(`[seedSectors] upserted total ${mergedRows.length} sectors`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
