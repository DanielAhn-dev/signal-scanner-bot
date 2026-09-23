/**
 * 과거 거래일의 scores를 TS 엔진(point-in-time)으로 다시 계산한다.
 *
 * 2026-09까지 GitHub Actions 일일 배치에 Node/pnpm이 없어 TS 엔진이 매일 실패했고, scores 이력은
 * 거의 전부 Python 폴백(legacy_fallback: rsi/roc/수급 위주, 매집·AVWAP·거래량비율 등 대부분 누락)이다.
 * 학습·백테스트가 일관된 팩터를 쓰도록 엔진 점수로 덮어쓴다(factors.score_source = "engine_pit").
 * 봇이 당시 실제로 본 값은 decision_logs에 남아 있다.
 *
 * 주의: 대상 종목은 "현재" core/extended 유니버스라 생존편향이 있다. value_score는 최신값을 쓴다.
 *
 * 사용 예
 *   pnpm dlx tsx scripts/backfill_engine_scores.ts --from=2026-03-01 --to=2026-09-22
 *   pnpm dlx tsx scripts/backfill_engine_scores.ts --from=2026-08-01 --to=2026-08-31 --dryRun=true
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { syncScoresFromEngine } from "../src/services/scoreSyncService";

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((x) => x.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY required");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const from = arg("from", "2026-03-01");
  const to = arg("to", new Date(Date.now() - 86_400_000).toISOString().slice(0, 10));
  const dryRun = arg("dryRun", "false") === "true";
  const concurrency = Number(arg("concurrency", "6")) || 6;

  // 거래일 달력: 유동성 최상위 종목의 일봉 날짜
  const { data: calRows, error } = await supabase
    .from("stock_daily")
    .select("date")
    .eq("ticker", "005930")
    .gte("date", from)
    .lte("date", to)
    .order("date", { ascending: true })
    .limit(1000);
  if (error) throw error;
  const dates = (calRows ?? []).map((r) => String(r.date).slice(0, 10));
  console.log(`[engine-backfill] ${dates.length} trading days ${from}~${to}${dryRun ? " (dry-run)" : ""}`);
  if (dryRun) {
    console.log(dates.join(" "));
    return;
  }

  let totalUpserted = 0;
  for (const [i, asof] of dates.entries()) {
    const summary = await syncScoresFromEngine(supabase, { asof, limit: 1500, concurrency });
    totalUpserted += summary.upsertCount;
    console.log(
      `[engine-backfill] ${i + 1}/${dates.length} ${asof} target=${summary.targetCount} upserted=${summary.upsertCount} skipped=${summary.skippedInsufficientSeries} failed=${summary.failedCount}`
    );
  }
  console.log(`[engine-backfill] done upserted=${totalUpserted}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
