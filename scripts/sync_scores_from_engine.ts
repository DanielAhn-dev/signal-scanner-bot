import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { syncScoresFromEngine } from "../src/services/scoreSyncService";

function parseIntArg(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const args = process.argv.slice(2);
  const asof = args.find((arg) => arg.startsWith("--asof="))?.split("=")[1];
  const limit = parseIntArg(args.find((arg) => arg.startsWith("--limit="))?.split("=")[1]);
  const concurrency = parseIntArg(args.find((arg) => arg.startsWith("--concurrency="))?.split("=")[1]);

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  console.log("[score-sync] Started engine-based score sync...");
  const summary = await syncScoresFromEngine(supabase, {
    asof,
    limit,
    concurrency,
  });

  console.log(
    `[score-sync] Done asof=${summary.asof} target=${summary.targetCount} processed=${summary.processedCount} upserted=${summary.upsertCount} skipped=${summary.skippedInsufficientSeries} failed=${summary.failedCount}`
  );
}

main().catch((error) => {
  console.error("[score-sync] Failed:", error);
  process.exit(1);
});
