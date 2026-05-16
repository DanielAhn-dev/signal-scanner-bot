import "dotenv/config";
import { supabase } from "../src/db/client";
import { getDailySeries } from "../src/adapters";

type ScoreRow = {
  code: string;
  asof: string;
  total_score: number | null;
  signal: string | null;
  factors: Record<string, any> | null;
};

type PriceRow = {
  code: string;
  trade_date: string;
  close: number;
};

type RuleStats = {
  count: number;
  sum5: number;
  sum20: number;
  sum60: number;
  hit5_10: number;
  hit20_20: number;
  hit60_30: number;
};

function parseArg(name: string, fallback: string): string {
  const hit = process.argv.find((x) => x.startsWith(`--${name}=`));
  return hit ? hit.split('=')[1] : fallback;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function asBool(value: any): boolean {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function asStr(value: any): string {
  return String(value ?? '').trim().toLowerCase();
}

function getForwardReturn(series: PriceRow[], asof: string, horizon: number): number | null {
  const idx = series.findIndex((row) => row.trade_date >= asof);
  if (idx < 0) return null;
  const future = series[idx + horizon];
  if (!future) return null;
  const entry = series[idx]?.close ?? 0;
  const exit = future.close ?? 0;
  if (!(entry > 0) || !(exit > 0)) return null;
  return ((exit - entry) / entry) * 100;
}

async function fetchScoreRows(fromDate: string): Promise<ScoreRow[]> {
  const { data, error } = await supabase
    .from('scores')
    .select('code,asof,total_score,signal,factors')
    .gte('asof', fromDate)
    .order('asof', { ascending: true });

  if (error) throw new Error(`scores 조회 실패: ${error.message}`);
  return (data ?? []) as ScoreRow[];
}

async function fetchPrices(codes: string[], bars: number): Promise<PriceRow[]> {
  const allRows: PriceRow[] = [];

  for (const code of codes) {
    const series = await getDailySeries(code, bars);
    for (const row of series) {
      allRows.push({
        code,
        trade_date: String((row as any).date ?? ''),
        close: Number((row as any).close ?? 0),
      });
    }
  }

  return allRows.filter((row) => row.code && row.trade_date && Number.isFinite(row.close) && row.close > 0);
}

function makeRuleStats(): RuleStats {
  return { count: 0, sum5: 0, sum20: 0, sum60: 0, hit5_10: 0, hit20_20: 0, hit60_30: 0 };
}

function scoreRowForRules(row: ScoreRow) {
  const f = row.factors ?? {};
  const score = Number(row.total_score ?? 0);
  const signal = asStr(row.signal);
  const stableAccumulation = asBool(f.stable_accumulation) || Number(f.stable_accumulation_days ?? 0) >= 2;
  const stableAboveAvg = asBool(f.stable_above_avg) || asBool(f.stable_above_avg_days_5) || asBool(f.stable_above_avg_days_10);
  const stableTurn = asStr(f.stable_turn);
  const bullTurn = stableTurn === 'bull-weak' || stableTurn === 'bull-strong';
  const avwapSupport = Number(f.avwap_support ?? 0) >= 2 || Number(f.avwap_support_days ?? 0) >= 2;
  return { score, signal, stableAccumulation, stableAboveAvg, bullTurn, avwapSupport };
}

async function main() {
  const lookbackDays = Number(parseArg('lookback', '420'));
  const maxRows = Number(parseArg('maxRows', '25000'));

  const from = new Date();
  from.setDate(from.getDate() - lookbackDays);
  const fromDate = from.toISOString().slice(0, 10);

  const rows = await fetchScoreRows(fromDate);
  const limitedRows = rows.slice(0, maxRows);
  if (limitedRows.length === 0) {
    console.log('No score rows found.');
    return;
  }

  const codes = Array.from(new Set(limitedRows.map((row) => row.code).filter(Boolean)));
  const prices = await fetchPrices(codes, Math.max(lookbackDays + 80, 260));

  const priceMap = new Map<string, PriceRow[]>();
  for (const row of prices) {
    if (!priceMap.has(row.code)) priceMap.set(row.code, []);
    priceMap.get(row.code)!.push(row);
  }

  const rules = new Map<string, RuleStats>([
    ['전체', makeRuleStats()],
    ['score>=70', makeRuleStats()],
    ['stable_accumulation', makeRuleStats()],
    ['stable_turn_bull', makeRuleStats()],
    ['stable_accumulation+turn', makeRuleStats()],
    ['stable_accumulation+turn+above_avg', makeRuleStats()],
    ['stable_accumulation+turn+above_avg+avwap', makeRuleStats()],
  ]);

  let evaluated = 0;

  for (const row of limitedRows) {
    const code = String(row.code || '').trim();
    const asof = String(row.asof || '').slice(0, 10);
    if (!code || !asof) continue;

    const series = priceMap.get(code);
    if (!series || series.length === 0) continue;

    const r5 = getForwardReturn(series, asof, 5);
    const r20 = getForwardReturn(series, asof, 20);
    const r60 = getForwardReturn(series, asof, 60);
    if (r5 == null && r20 == null && r60 == null) continue;

    const features = scoreRowForRules(row);
    evaluated += 1;

    const apply = (name: string) => {
      const stat = rules.get(name)!;
      stat.count += 1;
      if (r5 != null) {
        stat.sum5 += r5;
        if (r5 >= 10) stat.hit5_10 += 1;
      }
      if (r20 != null) {
        stat.sum20 += r20;
        if (r20 >= 20) stat.hit20_20 += 1;
      }
      if (r60 != null) {
        stat.sum60 += r60;
        if (r60 >= 30) stat.hit60_30 += 1;
      }
    };

    apply('전체');
    if (features.score >= 70) apply('score>=70');
    if (features.stableAccumulation) apply('stable_accumulation');
    if (features.bullTurn) apply('stable_turn_bull');
    if (features.stableAccumulation && features.bullTurn) apply('stable_accumulation+turn');
    if (features.stableAccumulation && features.bullTurn && features.stableAboveAvg) apply('stable_accumulation+turn+above_avg');
    if (features.stableAccumulation && features.bullTurn && features.stableAboveAvg && features.avwapSupport) apply('stable_accumulation+turn+above_avg+avwap');
  }

  console.log(`[stable-accumulation-backtest] rows=${limitedRows.length} evaluated=${evaluated} lookback=${lookbackDays}d`);
  for (const [name, stat] of rules.entries()) {
    if (stat.count === 0) {
      console.log(`${name}: no samples`);
      continue;
    }
    console.log(
      `${name}: count=${stat.count} avg5=${round1(stat.sum5 / stat.count)}% avg20=${round1(stat.sum20 / stat.count)}% avg60=${round1(stat.sum60 / stat.count)}% hit5>=10%=${round1((stat.hit5_10 / stat.count) * 100)}% hit20>=20%=${round1((stat.hit20_20 / stat.count) * 100)}% hit60>=30%=${round1((stat.hit60_30 / stat.count) * 100)}%`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});