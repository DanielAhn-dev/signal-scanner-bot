import "dotenv/config";
import { supabase } from "../src/db/client";

type DateRow = { date: string };

function parseArg(name: string, fallback: string): string {
  const hit = process.argv.find((x) => x.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : fallback;
}

function normalizeDate(value: unknown): string {
  return String(value ?? "").slice(0, 10);
}

async function fetchDistinctDates(
  table: string,
  dateColumn: string,
  fromDate: string,
  maxRows = 200000,
): Promise<string[]> {
  const uniq = new Set<string>();
  const pageSize = 1000;

  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(dateColumn)
      .gte(dateColumn, fromDate)
      .order(dateColumn, { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
    const rows = Array.isArray(data) ? data : [];
    if (rows.length === 0) break;

    for (const row of rows) {
      const date = normalizeDate(
        row && typeof row === "object" ? (row as Record<string, unknown>)[dateColumn] : undefined,
      );
      if (date) uniq.add(date);
    }

    if (rows.length < pageSize) break;
  }

  return Array.from(uniq).sort((a, b) => a.localeCompare(b));
}

function countLabelableEvents(eventDates: string[], priceDates: string[], horizonBars: number): { labelable: number; tooRecent: number } {
  if (eventDates.length === 0 || priceDates.length === 0) return { labelable: 0, tooRecent: eventDates.length };

  const priceIndex = new Map<string, number>();
  for (let i = 0; i < priceDates.length; i += 1) {
    priceIndex.set(priceDates[i], i);
  }

  let labelable = 0;
  let tooRecent = 0;

  for (const date of eventDates) {
    const exact = priceIndex.get(date);
    const idx = exact != null ? exact : priceDates.findIndex((d) => d >= date);
    if (idx < 0) {
      tooRecent += 1;
      continue;
    }
    if (idx + horizonBars < priceDates.length) labelable += 1;
    else tooRecent += 1;
  }

  return { labelable, tooRecent };
}

function mergeSortedUnique(a: string[], b: string[]): string[] {
  return Array.from(new Set([...a, ...b])).sort((x, y) => x.localeCompare(y));
}

async function main() {
  const lookbackDays = Number(parseArg("lookback", "900"));
  const horizons = parseArg("horizons", "20,40,60")
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((x) => Number.isFinite(x) && x > 0);

  const from = new Date();
  from.setDate(from.getDate() - lookbackDays);
  const fromDate = from.toISOString().slice(0, 10);

  const [scoreDates, pullbackDates, stockDailyDates, indicatorDates] = await Promise.all([
    fetchDistinctDates("scores", "asof", fromDate),
    fetchDistinctDates("pullback_signals", "trade_date", fromDate),
    fetchDistinctDates("stock_daily", "date", fromDate),
    fetchDistinctDates("daily_indicators", "trade_date", fromDate),
  ]);

  const priceDates = mergeSortedUnique(stockDailyDates, indicatorDates);
  const priceSource = "stock_daily.date + daily_indicators.trade_date";

  console.log(`[coverage] from=${fromDate} lookbackDays=${lookbackDays}`);
  console.log(`[coverage] priceSource=${priceSource} dates=${priceDates.length} range=${priceDates[0] ?? "-"}..${priceDates[priceDates.length - 1] ?? "-"}`);
  console.log(`[coverage] stockDaily dates=${stockDailyDates.length} range=${stockDailyDates[0] ?? "-"}..${stockDailyDates[stockDailyDates.length - 1] ?? "-"}`);
  console.log(`[coverage] dailyIndicators dates=${indicatorDates.length} range=${indicatorDates[0] ?? "-"}..${indicatorDates[indicatorDates.length - 1] ?? "-"}`);
  console.log(`[coverage] scores dates=${scoreDates.length} range=${scoreDates[0] ?? "-"}..${scoreDates[scoreDates.length - 1] ?? "-"}`);
  console.log(`[coverage] pullback dates=${pullbackDates.length} range=${pullbackDates[0] ?? "-"}..${pullbackDates[pullbackDates.length - 1] ?? "-"}`);

  for (const horizon of horizons) {
    const scoreResult = countLabelableEvents(scoreDates, priceDates, horizon);
    const pullbackResult = countLabelableEvents(pullbackDates, priceDates, horizon);
    console.log(
      `[coverage] horizon=${horizon} scoreLabelable=${scoreResult.labelable}/${scoreDates.length} scoreTooRecent=${scoreResult.tooRecent} pullbackLabelable=${pullbackResult.labelable}/${pullbackDates.length} pullbackTooRecent=${pullbackResult.tooRecent}`,
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
