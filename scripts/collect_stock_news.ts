import "../src/lib/installTruncationGuard";
/**
 * 유니버스 종목 뉴스 헤드라인 일일 보관 (src/services/newsArchive.ts).
 *   pnpm exec tsx scripts/collect_stock_news.ts           # 수집 + Storage 저장
 *   pnpm exec tsx scripts/collect_stock_news.ts --dry     # 저장 없이 건수만
 */
import "dotenv/config";
import { gzipSync } from "node:zlib";
import { createClient } from "@supabase/supabase-js";
import { isKrxTradingDate, previousKrxTradingDate, toKstDateKey } from "../src/lib/krxCalendar";
import { parseStockNewsForArchive, type ArchivedNews } from "../src/services/newsArchive";

const DRY = process.argv.includes("--dry");
const BUCKET = "market-snapshots";
const CONCURRENCY = 6;

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
    signal: AbortSignal.timeout(5000),
  });
  return res.ok ? res.json() : null;
}

async function main() {
  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const today = toKstDateKey();
  const asof = isKrxTradingDate(today) ? today : previousKrxTradingDate(today);
  // 직전 거래일 이후 기사 (휴장 연휴에 난 기사도 다음 거래일 파일에 포함)
  const sinceKey = `${previousKrxTradingDate(asof).replace(/-/g, "")}0000`;

  const { data: stocks, error } = await supabase
    .from("stocks")
    .select("code")
    .in("universe_level", ["core", "extended"])
    .eq("is_active", true);
  if (error) throw new Error(`stocks 조회 실패: ${error.message}`);
  const codes = (stocks ?? []).map((s: { code: string }) => String(s.code));

  const rows: ArchivedNews[] = [];
  let failed = 0;
  for (let i = 0; i < codes.length; i += CONCURRENCY) {
    const batch = codes.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((code) =>
        fetchJson(`https://m.stock.naver.com/api/news/stock/${code}?pageSize=20&page=1`)
          .then((body) => parseStockNewsForArchive(code, body, sinceKey))
          .catch(() => {
            failed += 1;
            return [] as ArchivedNews[];
          })
      )
    );
    for (const r of results) rows.push(...r);
  }

  console.log(`뉴스 보관 ${asof}: ${codes.length}종목 · ${rows.length}건 · 실패 ${failed}`);
  if (DRY) return;
  if (failed > codes.length * 0.5) throw new Error(`수집 실패 과다 (${failed}/${codes.length}) — 저장 생략`);
  const path = `news/${asof.slice(0, 4)}/${asof}.json.gz`;
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, gzipSync(JSON.stringify(rows)), { upsert: true, contentType: "application/gzip" });
  if (upErr) throw new Error(`저장 실패: ${upErr.message}`);
  console.log(`저장 완료: ${BUCKET}/${path}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
