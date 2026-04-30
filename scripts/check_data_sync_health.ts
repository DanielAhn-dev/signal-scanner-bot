import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function kstNow(): Date {
  const now = new Date();
  return new Date(now.getTime() + 9 * 60 * 60 * 1000);
}

function kstYmdNow(): string {
  return ymd(kstNow());
}

function businessDaysDiff(fromYmd: string, toYmd: string): number {
  const from = new Date(`${fromYmd}T00:00:00.000Z`);
  const to = new Date(`${toYmd}T00:00:00.000Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 999;
  if (from > to) return 0;
  let diff = 0;
  for (let d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) diff += 1;
  }
  return Math.max(0, diff - 1);
}

async function maxDate(supabase: any, table: string, column: string): Promise<string | null> {
  const { data, error } = await supabase
    .from(table)
    .select(column)
    .order(column, { ascending: false })
    .limit(1);
  if (error) throw new Error(`${table} max date 조회 실패: ${error.message}`);
  const row = data?.[0] as Record<string, unknown> | undefined;
  const value = String(row?.[column] ?? "").slice(0, 10);
  return value || null;
}

async function countByDate(
  supabase: any,
  table: string,
  dateColumn: string,
  dateValue: string
): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select(dateColumn, { head: true, count: "exact" })
    .eq(dateColumn, dateValue);
  if (error) throw new Error(`${table} count 조회 실패: ${error.message}`);
  return Number(count ?? 0);
}

async function main() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 필요합니다.");
  }
  const supabase = createClient(url, key);

  const todayKst = kstYmdNow();
  const [scoresDate, indicatorsDate, stockDailyDate, sectorDailyDate, pullbackDate] = await Promise.all([
    maxDate(supabase, "scores", "asof"),
    maxDate(supabase, "daily_indicators", "trade_date"),
    maxDate(supabase, "stock_daily", "date"),
    maxDate(supabase, "sector_daily", "date"),
    maxDate(supabase, "pullback_signals", "trade_date"),
  ]);

  const rowsAtLatest = {
    scores: scoresDate ? await countByDate(supabase, "scores", "asof", scoresDate) : 0,
    daily_indicators: indicatorsDate ? await countByDate(supabase, "daily_indicators", "trade_date", indicatorsDate) : 0,
    stock_daily: stockDailyDate ? await countByDate(supabase, "stock_daily", "date", stockDailyDate) : 0,
    sector_daily: sectorDailyDate ? await countByDate(supabase, "sector_daily", "date", sectorDailyDate) : 0,
    pullback_signals: pullbackDate ? await countByDate(supabase, "pullback_signals", "trade_date", pullbackDate) : 0,
  };

  const stale = {
    scores: scoresDate ? businessDaysDiff(scoresDate, todayKst) : 999,
    daily_indicators: indicatorsDate ? businessDaysDiff(indicatorsDate, todayKst) : 999,
    stock_daily: stockDailyDate ? businessDaysDiff(stockDailyDate, todayKst) : 999,
    sector_daily: sectorDailyDate ? businessDaysDiff(sectorDailyDate, todayKst) : 999,
    pullback_signals: pullbackDate ? businessDaysDiff(pullbackDate, todayKst) : 999,
  };

  const status =
    stale.scores <= 1 &&
    stale.daily_indicators <= 1 &&
    stale.stock_daily <= 1 &&
    stale.sector_daily <= 2
      ? "healthy"
      : "stale";

  console.log(
    JSON.stringify(
      {
        ok: status === "healthy",
        status,
        todayKst,
        latest: {
          scores: scoresDate,
          daily_indicators: indicatorsDate,
          stock_daily: stockDailyDate,
          sector_daily: sectorDailyDate,
          pullback_signals: pullbackDate,
        },
        staleBusinessDays: stale,
        rowsAtLatest,
      },
      null,
      2
    )
  );

  if (status !== "healthy") process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
