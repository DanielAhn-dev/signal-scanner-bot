import "dotenv/config";
import { supabase } from "../src/db/client";

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

async function fetchScoreRows(fromDate: string, maxRows: number, untilDate?: string): Promise<ScoreRow[]> {
  const out: ScoreRow[] = [];
  const pageSize = 1000;

  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const { data, error } = await supabase
      .from('scores')
      .select('code,asof,total_score,signal,factors')
      .gte('asof', fromDate)
      .lte('asof', untilDate ?? '9999-12-31')
      .order('asof', { ascending: false })
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error(`scores 조회 실패: ${error.message}`);

    const rows = (data ?? []) as ScoreRow[];
    if (rows.length === 0) break;
    out.push(...rows);
    if (rows.length < pageSize) break;
  }

  return out.slice(0, maxRows);
}

async function fetchPrices(codes: string[], fromDate: string): Promise<PriceRow[]> {
  const allRows: PriceRow[] = [];

  for (const code of codes) {
    const { data, error } = await supabase
      .from('stock_daily')
      .select('ticker,date,close')
      .eq('ticker', code)
      .gte('date', fromDate)
      .order('date', { ascending: true })
      .limit(800);

    if (error) throw new Error(`stock_daily 조회 실패(${code}): ${error.message}`);

    const series = (data ?? []) as Array<any>;
    for (const row of series) {
      allRows.push({
        code,
        trade_date: String(row.date ?? ''),
        close: Number(row.close ?? 0),
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

type RowFeature = {
  asof: string;
  stableAboveAvg: boolean;
  bullTurn: boolean;
};

function toDay(value: string): number {
  return Date.parse(`${value}T00:00:00Z`);
}

function hasFutureFeatureWithinDays(
  rows: RowFeature[] | undefined,
  asof: string,
  maxDays: number,
  pick: (row: RowFeature) => boolean,
): boolean {
  if (!rows || rows.length === 0) return false;
  const base = toDay(asof);
  const limit = base + maxDays * 24 * 60 * 60 * 1000;
  for (const row of rows) {
    const day = toDay(row.asof);
    if (day <= base) continue;
    if (day > limit) break;
    if (pick(row)) return true;
  }
  return false;
}

async function main() {
  const lookbackDays = Number(parseArg('lookback', '420'));
  const maxRows = Number(parseArg('maxRows', '25000'));
  const skipRecentDays = Number(parseArg('skipRecentDays', '0'));
  const promotionMinSamples = Number(parseArg('promotionMinSamples', '50'));

  const from = new Date();
  from.setDate(from.getDate() - lookbackDays);
  const fromDate = from.toISOString().slice(0, 10);
  const untilDate = (() => {
    if (!Number.isFinite(skipRecentDays) || skipRecentDays <= 0) return undefined;
    const d = new Date();
    d.setDate(d.getDate() - Math.floor(skipRecentDays));
    return d.toISOString().slice(0, 10);
  })();

  const limitedRows = await fetchScoreRows(fromDate, maxRows, untilDate);
  if (limitedRows.length === 0) {
    console.log('No score rows found.');
    return;
  }

  const codes = Array.from(new Set(limitedRows.map((row) => row.code).filter(Boolean)));
  const prices = await fetchPrices(codes, fromDate);

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
    ['accumulation->turn<=5d', makeRuleStats()],
    ['accumulation->turn<=10d', makeRuleStats()],
    ['accumulation->above<=5d', makeRuleStats()],
    ['accumulation->above<=10d', makeRuleStats()],
    ['accumulation->above<=20d', makeRuleStats()],
    ['accumulation->(turn|above)<=10d', makeRuleStats()],
    ['accumulation->(turn|above)<=20d', makeRuleStats()],
  ]);

  const featureByCode = new Map<string, RowFeature[]>();
  for (const row of limitedRows) {
    const code = String(row.code || '').trim();
    const asof = String(row.asof || '').slice(0, 10);
    if (!code || !asof) continue;
    const features = scoreRowForRules(row);
    if (!featureByCode.has(code)) featureByCode.set(code, []);
    featureByCode.get(code)!.push({
      asof,
      stableAboveAvg: features.stableAboveAvg,
      bullTurn: features.bullTurn,
    });
  }
  for (const [code, rows] of featureByCode.entries()) {
    featureByCode.set(code, rows.slice().sort((a, b) => a.asof.localeCompare(b.asof)));
  }

  let evaluated = 0;
  let stableFactorRows = 0;
  let stableFactorEvaluableRows = 0;

  for (const row of limitedRows) {
    const code = String(row.code || '').trim();
    const asof = String(row.asof || '').slice(0, 10);
    if (!code || !asof) continue;

    const series = priceMap.get(code);
    if (!series || series.length === 0) continue;

    const r5 = getForwardReturn(series, asof, 5);
    const r20 = getForwardReturn(series, asof, 20);
    const r60 = getForwardReturn(series, asof, 60);
    const features = scoreRowForRules(row);
    if (features.stableAccumulation || features.bullTurn || features.stableAboveAvg || features.avwapSupport) {
      stableFactorRows += 1;
      if (r5 != null || r20 != null || r60 != null) {
        stableFactorEvaluableRows += 1;
      }
    }

    if (r5 == null && r20 == null && r60 == null) continue;

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

    const codeFeatureRows = featureByCode.get(code);
    const hasTurn5 = hasFutureFeatureWithinDays(codeFeatureRows, asof, 5, (x) => x.bullTurn);
    const hasTurn10 = hasFutureFeatureWithinDays(codeFeatureRows, asof, 10, (x) => x.bullTurn);
    const hasAbove5 = hasFutureFeatureWithinDays(codeFeatureRows, asof, 5, (x) => x.stableAboveAvg);
    const hasAbove10 = hasFutureFeatureWithinDays(codeFeatureRows, asof, 10, (x) => x.stableAboveAvg);
    const hasAbove20 = hasFutureFeatureWithinDays(codeFeatureRows, asof, 20, (x) => x.stableAboveAvg);
    const hasTurnOrAbove10 = hasFutureFeatureWithinDays(
      codeFeatureRows,
      asof,
      10,
      (x) => x.bullTurn || x.stableAboveAvg,
    );
    const hasTurnOrAbove20 = hasFutureFeatureWithinDays(
      codeFeatureRows,
      asof,
      20,
      (x) => x.bullTurn || x.stableAboveAvg,
    );
    if (features.stableAccumulation && hasTurn5) apply('accumulation->turn<=5d');
    if (features.stableAccumulation && hasTurn10) apply('accumulation->turn<=10d');
    if (features.stableAccumulation && hasAbove5) apply('accumulation->above<=5d');
    if (features.stableAccumulation && hasAbove10) apply('accumulation->above<=10d');
    if (features.stableAccumulation && hasAbove20) apply('accumulation->above<=20d');
    if (features.stableAccumulation && hasTurnOrAbove10) apply('accumulation->(turn|above)<=10d');
    if (features.stableAccumulation && hasTurnOrAbove20) apply('accumulation->(turn|above)<=20d');
  }

  console.log(`[stable-accumulation-backtest] rows=${limitedRows.length} evaluated=${evaluated} lookback=${lookbackDays}d skipRecentDays=${skipRecentDays}`);
  console.log(
    `[stable-accumulation-backtest] stableFactorRows=${stableFactorRows} stableFactorEvaluableRows=${stableFactorEvaluableRows}`,
  );
  if (stableFactorRows > 0 && stableFactorEvaluableRows === 0) {
    console.log(
      `[stable-accumulation-backtest] note=stable factor rows exist but all are too recent for forward horizons (5/20/60).`,
    );
  }
  for (const [name, stat] of rules.entries()) {
    if (stat.count === 0) {
      console.log(`${name}: no samples`);
      continue;
    }
    console.log(
      `${name}: count=${stat.count} avg5=${round1(stat.sum5 / stat.count)}% avg20=${round1(stat.sum20 / stat.count)}% avg60=${round1(stat.sum60 / stat.count)}% hit5>=10%=${round1((stat.hit5_10 / stat.count) * 100)}% hit20>=20%=${round1((stat.hit20_20 / stat.count) * 100)}% hit60>=30%=${round1((stat.hit60_30 / stat.count) * 100)}%`,
    );
  }

  const promotionRuleName = 'accumulation->above<=5d';
  const promotionRule = rules.get(promotionRuleName);
  const promoted = Boolean(promotionRule && promotionRule.count >= promotionMinSamples);
  console.log(
    `[stable-accumulation-backtest] promotionGate rule=${promotionRuleName} samples=${promotionRule?.count ?? 0} threshold=${promotionMinSamples} promoted=${promoted}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});