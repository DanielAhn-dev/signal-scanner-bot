/**
 * 연구 캐시(.research-cache/div_<코드>.json)의 분배금 이력을 etf_distributions 테이블에 한 번 옮긴다.
 * 이후에는 웹 관리자 화면의 분배금 엑셀 업로드가 같은 테이블을 갱신한다.
 *
 * 기본은 읽기만 하는 드라이런이다 (캐시 파일 수·행 수만 출력). 실제로 쓰려면 --dryRun=false.
 * 같은 (코드, 기준일)은 최신 값으로 갱신되므로 여러 번 돌려도 중복되지 않는다.
 * 먼저 db/migrations/039_etf_distributions.sql을 Supabase에서 실행해야 한다.
 *
 * 사용: pnpm exec tsx scripts/ops/seed_etf_distributions.ts [--dryRun=false]
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const dryRun = !process.argv.includes("--dryRun=false");
const CACHE = path.join(process.cwd(), ".research-cache");
const CHUNK = 500;

type CacheRow = { recordDate: string; amount: number; rate: number | null };

async function main() {
  const files = fs.readdirSync(CACHE).filter((f) => /^div_[0-9A-Za-z]+\.json$/.test(f)).sort();
  const rows: Array<Record<string, unknown>> = [];
  for (const f of files) {
    const code = f.slice(4, -5);
    const list = JSON.parse(fs.readFileSync(path.join(CACHE, f), "utf-8")) as CacheRow[];
    const seen = new Set<string>();
    for (const r of list) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.recordDate) || !(r.amount > 0) || seen.has(r.recordDate)) continue;
      seen.add(r.recordDate);
      rows.push({
        code,
        record_date: r.recordDate,
        per_share: r.amount,
        rate_pct: r.rate ?? null,
        source_file: `research-cache/${f}`,
        updated_at: new Date().toISOString(),
      });
    }
    console.log(`${code}: ${seen.size}건`);
  }
  console.log(`총 ${files.length}개 상품, ${rows.length}행 ${dryRun ? "(드라이런 — 쓰지 않음)" : ""}`);
  if (dryRun) return;

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from("etf_distributions").upsert(part, { onConflict: "code,record_date" });
    if (error) {
      console.error(`실패(${written}행까지 저장됨):`, error.message);
      process.exitCode = 1;
      return;
    }
    written += part.length;
  }
  console.log(`저장 ${written}행`);
}

main();
