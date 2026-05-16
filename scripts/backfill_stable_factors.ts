import "dotenv/config";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { syncScoresFromEngine } from "../src/services/scoreSyncService";

type Args = {
  from?: string;
  to?: string;
  maxDates: number;
  limit?: number;
  concurrency?: number;
  onlyMissing: boolean;
  dryRun: boolean;
};

function parseArg(name: string): string | undefined {
  const hit = process.argv.find((x) => x.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

function parseIntArg(name: string, fallback: number): number {
  const raw = parseArg(name);
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function parseBoolArg(name: string, fallback: boolean): boolean {
  const raw = parseArg(name);
  if (!raw) return fallback;
  const s = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return fallback;
}

function parseArgs(): Args {
  return {
    from: parseArg("from"),
    to: parseArg("to"),
    maxDates: parseIntArg("maxDates", 20),
    limit: parseArg("limit") ? parseIntArg("limit", 0) : undefined,
    concurrency: parseArg("concurrency") ? parseIntArg("concurrency", 0) : undefined,
    onlyMissing: parseBoolArg("onlyMissing", true),
    dryRun: parseBoolArg("dryRun", false),
  };
}

function requireSupabaseClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

function hasStableFactors(factors: Record<string, unknown> | null | undefined): boolean {
  const f = factors ?? {};
  return (
    f.stable_accumulation !== undefined ||
    f.stable_accumulation_days !== undefined ||
    f.stable_turn !== undefined ||
    f.stable_turn_trust !== undefined ||
    f.stable_above_avg !== undefined ||
    f.stable_above_avg_days_5 !== undefined ||
    f.stable_above_avg_days_10 !== undefined ||
    f.avwap_support !== undefined ||
    f.avwap_support_days !== undefined
  );
}

async function collectDistinctAsofDates(
  supabase: SupabaseClient,
  from?: string,
  to?: string,
  maxRows = 50000,
): Promise<string[]> {
  const out = new Set<string>();
  const pageSize = 1000;

  for (let offset = 0; offset < maxRows; offset += pageSize) {
    let query = supabase
      .from("scores")
      .select("asof")
      .order("asof", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (from) query = query.gte("asof", from);
    if (to) query = query.lte("asof", to);

    const { data, error } = await query;
    if (error) throw new Error(`scores asof 조회 실패: ${error.message}`);

    const rows = (data ?? []) as Array<{ asof?: string | null }>;
    if (rows.length === 0) break;

    for (const row of rows) {
      const asof = String(row.asof ?? "").slice(0, 10);
      if (asof) out.add(asof);
    }

    if (rows.length < pageSize) break;
  }

  return [...out].sort();
}

async function inspectDateStableCoverage(
  supabase: SupabaseClient,
  asof: string,
): Promise<{ total: number; stablePresent: number }> {
  const pageSize = 1000;
  let total = 0;
  let stablePresent = 0;

  for (let offset = 0; offset < 50000; offset += pageSize) {
    const { data, error } = await supabase
      .from("scores")
      .select("factors")
      .eq("asof", asof)
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error(`stable 커버리지 조회 실패(${asof}): ${error.message}`);
    const rows = (data ?? []) as Array<{ factors?: Record<string, unknown> | null }>;
    if (rows.length === 0) break;

    for (const row of rows) {
      total += 1;
      if (hasStableFactors(row.factors ?? undefined)) stablePresent += 1;
    }

    if (rows.length < pageSize) break;
  }

  return { total, stablePresent };
}

async function main() {
  const args = parseArgs();
  const supabase = requireSupabaseClient();

  const dates = await collectDistinctAsofDates(supabase, args.from, args.to);
  if (!dates.length) {
    console.log("[backfill-stable] 대상 asof 날짜가 없습니다.");
    return;
  }

  console.log(
    `[backfill-stable] foundDates=${dates.length} range=${dates[0]}..${dates[dates.length - 1]} onlyMissing=${args.onlyMissing} dryRun=${args.dryRun}`,
  );

  const selectedDates: string[] = [];
  for (const asof of dates) {
    const coverage = await inspectDateStableCoverage(supabase, asof);
    const missing = Math.max(coverage.total - coverage.stablePresent, 0);
    const needsBackfill = !args.onlyMissing || (coverage.total > 0 && missing > 0);

    console.log(
      `[backfill-stable] asof=${asof} total=${coverage.total} stablePresent=${coverage.stablePresent} missing=${missing} selected=${needsBackfill}`,
    );

    if (needsBackfill) selectedDates.push(asof);
    if (selectedDates.length >= args.maxDates) break;
  }

  if (!selectedDates.length) {
    console.log("[backfill-stable] 백필할 날짜가 없습니다.");
    return;
  }

  console.log(`[backfill-stable] targetDates=${selectedDates.join(",")}`);

  if (args.dryRun) {
    console.log("[backfill-stable] dry-run enabled, no sync executed.");
    return;
  }

  for (const asof of selectedDates) {
    const summary = await syncScoresFromEngine(supabase, {
      asof,
      limit: args.limit,
      concurrency: args.concurrency,
    });
    console.log(
      `[backfill-stable] synced asof=${asof} target=${summary.targetCount} processed=${summary.processedCount} upserted=${summary.upsertCount} skipped=${summary.skippedInsufficientSeries} failed=${summary.failedCount}`,
    );
  }
}

main().catch((error) => {
  console.error("[backfill-stable] failed:", error);
  process.exit(1);
});
