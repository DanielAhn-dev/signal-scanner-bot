// scripts/seedSectors.ts
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs/promises";
import path from "node:path";
import * as iconv from "iconv-lite";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const BATCH = 500;

// ✅ KRX 업종 지수 코드 매핑 (fetch_sectors.py 와 동일한 룰 유지)
const NAME_TO_INDEX_RULES: Array<[string, string]> = [
  ["반도체", "1014"],
  ["전자장비", "1013"],
  ["전기전자", "1013"],
  ["화학", "1010"],
  ["철강", "1011"],
  ["철강및금속", "1011"],
  ["기계", "1012"],
  ["조선", "1017"],
  ["운수장비", "1017"],
  ["은행", "1027"],
  ["보험", "1027"],
  ["금융", "1027"],
];

function inferIndexCodeFromName(name: string): string | null {
  for (const [kw, code] of NAME_TO_INDEX_RULES) {
    if (name.includes(kw)) return code;
  }
  return null;
}

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
  for (const id of existingMap.keys()) {
    const parts = id.split(":");
    const possibleSlug = parts.slice(2).join(":");
    if (possibleSlug) usedSlugs.add(possibleSlug.toUpperCase());
  }

  const rows: SectorRow[] = names
    .sort((a, b) => a.localeCompare(b, "ko"))
    .map((name) => {
      const slug = generateUniqueSlug(name, usedSlugs);
      const id = `KRX:${slug}`;
      const krxIndex = inferIndexCodeFromName(name); // ✅ 이름 기반 지수 코드 추론

      return {
        id,
        name,
        metrics: {
          sources: ["NAVER_UPJONG"],
          fetched_at: new Date().toISOString(),
          ...(krxIndex ? { krx_index: krxIndex } : {}),
        },
        score: 0,
      };
    });

  // 3) 기존 DB와 병합: 기존 metrics.krx_index는 보존하고, 없으면 새 값 채움
  for (const r of rows) {
    if (existingMap.has(r.id)) {
      const prev = existingMap.get(r.id)!;
      const prevMetrics = (prev.metrics ?? {}) as Record<string, unknown>;
      const nextMetrics = {
        ...prevMetrics,
        ...(r.metrics ?? {}),
        // 기존에 krx_index가 있었다면 그대로 유지
        ...(prevMetrics.krx_index ? { krx_index: prevMetrics.krx_index } : {}),
      };

      existingMap.set(r.id, {
        ...prev,
        name: r.name || prev.name,
        score: r.score ?? prev.score,
        metrics: nextMetrics,
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
