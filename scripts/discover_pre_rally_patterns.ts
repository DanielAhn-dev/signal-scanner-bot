import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { supabase } from "../src/db/client";

type ScoreRow = {
  code: string;
  asof: string;
  total_score: number | null;
  signal: string | null;
  factors: Record<string, unknown> | null;
};

type PriceRow = {
  code: string;
  trade_date: string;
  close: number;
};

type PullbackRow = {
  trade_date: string;
  code: string;
  entry_grade: string | null;
  trend_grade: string | null;
  pivot_grade: string | null;
  dist_grade: string | null;
  warn_grade: string | null;
  entry_score: number | null;
};

type FeatureRow = {
  code: string;
  asof: string;
  totalScore: number;
  signal: string;
  marketRegime: string;
  stableAccumulation: boolean;
  stableAboveAvg: boolean;
  bullTurn: boolean;
  avwapSupport: number;
  foreign5d: number;
  institution5d: number;
  volRatio: number;
  rsi14: number;
  entryGrade: string;
  trendGrade: string;
  pivotGrade: string;
  distGrade: string;
  warnGrade: string;
};

type LabelRow = FeatureRow & {
  forwardReturnPct: number;
  maxDrawdownPct: number;
  isRally: boolean;
};

type Pattern = {
  name: string;
  check: (row: LabelRow) => boolean;
};

type PatternStat = {
  name: string;
  samples: number;
  rallyCount: number;
  winRatePct: number;
  liftVsBasePct: number;
  avgForwardReturnPct: number;
  avgMaxDrawdownPct: number;
};

type DiscoveryReport = {
  generatedAt: string;
  config: {
    lookbackDays: number;
    horizonBars: number;
    rallyThresholdPct: number;
    minSamples: number;
    splitRatio: number;
    maxRows: number;
    autoExtend: boolean;
  };
  dataset: {
    scoreRows: number;
    labeledRows: number;
    skippedMissingPrice: number;
    skippedTooRecent: number;
    uniqueCodes: number;
  };
  baseline: {
    trainWinRatePct: number;
    testWinRatePct: number;
    trainAvgReturnPct: number;
    testAvgReturnPct: number;
  };
  stablePatterns: PatternStat[];
  exploratoryTopTrain: PatternStat[];
  regimeSummary: Array<{
    regime: string;
    samples: number;
    winRatePct: number;
    avgForwardReturnPct: number;
  }>;
  notes: string[];
};

function parseArg(name: string, fallback: string): string {
  const hit = process.argv.find((x) => x.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : fallback;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function asNum(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function asBool(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function asStr(value: unknown, fallback = ""): string {
  const out = String(value ?? fallback).trim();
  return out || fallback;
}

function normalizeDate(value: string): string {
  return String(value || "").slice(0, 10);
}

function normalizeCode(value: unknown): string {
  const raw = asStr(value);
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 6) return digits.slice(-6);
  return raw.toUpperCase();
}

function splitArray<T>(values: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) out.push(values.slice(i, i + size));
  return out;
}

async function fetchScoreRows(fromDate: string, maxRows: number): Promise<ScoreRow[]> {
  const out: ScoreRow[] = [];
  const pageSize = 1000;

  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const { data, error } = await supabase
      .from("scores")
      .select("code,asof,total_score,signal,factors")
      .gte("asof", fromDate)
      .order("asof", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error(`scores 조회 실패: ${error.message}`);
    const rows = (data ?? []) as ScoreRow[];
    if (rows.length === 0) break;
    out.push(...rows);
    if (rows.length < pageSize) break;
  }

  return out.slice(0, maxRows);
}

async function fetchPriceRows(codes: string[], fromDate: string): Promise<PriceRow[]> {
  const out: PriceRow[] = [];

  async function appendFromStockDaily(chunk: string[]): Promise<void> {
    const { data, error } = await supabase
      .from("stock_daily")
      .select("ticker,date,close")
      .in("ticker", chunk)
      .gte("date", fromDate)
      .order("date", { ascending: true });

    if (error) throw new Error(`stock_daily 조회 실패: ${error.message}`);

    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      out.push({
        code: normalizeCode(row.ticker),
        trade_date: normalizeDate(asStr(row.date)),
        close: asNum(row.close),
      });
    }
  }

  async function appendFromDailyIndicators(chunk: string[]): Promise<void> {
    const { data, error } = await supabase
      .from("daily_indicators")
      .select("code,trade_date,close")
      .in("code", chunk)
      .gte("trade_date", fromDate)
      .order("trade_date", { ascending: true });

    if (error) throw new Error(`daily_indicators 조회 실패: ${error.message}`);

    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      out.push({
        code: normalizeCode(row.code),
        trade_date: normalizeDate(asStr(row.trade_date)),
        close: asNum(row.close),
      });
    }
  }

  // stock_daily와 daily_indicators를 합집합으로 사용해 날짜 커버리지를 최대화한다.
  for (const chunk of splitArray(codes, 100)) {
    await appendFromStockDaily(chunk);
  }
  for (const chunk of splitArray(codes, 100)) {
    await appendFromDailyIndicators(chunk);
  }

  return out.filter((row) => row.code && row.trade_date && row.close > 0);
}

async function fetchPullbackFeatureRows(fromDate: string, maxRows: number): Promise<FeatureRow[]> {
  const out: PullbackRow[] = [];
  const pageSize = 1000;

  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const { data, error } = await supabase
      .from("pullback_signals")
      .select("trade_date,code,entry_grade,trend_grade,pivot_grade,dist_grade,warn_grade,entry_score")
      .gte("trade_date", fromDate)
      .order("trade_date", { ascending: true })
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error(`pullback_signals 조회 실패: ${error.message}`);
    const rows = (data ?? []) as PullbackRow[];
    if (rows.length === 0) break;
    out.push(...rows);
    if (rows.length < pageSize) break;
  }

  return out.slice(0, maxRows).map((row) => {
    const entryGrade = asStr(row.entry_grade, "").toUpperCase();
    const trendGrade = asStr(row.trend_grade, "").toUpperCase();
    const pivotGrade = asStr(row.pivot_grade, "").toUpperCase();
    const distGrade = asStr(row.dist_grade, "").toUpperCase();
    const warnGrade = asStr(row.warn_grade, "").toUpperCase();

    return {
      code: normalizeCode(row.code),
      asof: normalizeDate(asStr(row.trade_date)),
      totalScore: asNum(row.entry_score) * 20,
      signal: warnGrade === "SELL" ? "SELL" : "BUY",
      marketRegime: "unknown",
      stableAccumulation: false,
      stableAboveAvg: false,
      bullTurn: false,
      avwapSupport: 0,
      foreign5d: 0,
      institution5d: 0,
      volRatio: 0,
      rsi14: 0,
      entryGrade,
      trendGrade,
      pivotGrade,
      distGrade,
      warnGrade,
    };
  });
}

function extractFeature(row: ScoreRow): FeatureRow {
  const factors = row.factors ?? {};
  const signal = asStr(row.signal, "NONE").toUpperCase();
  const stableTurn = asStr(factors.stable_turn, "").toLowerCase();

  return {
    code: normalizeCode(row.code),
    asof: normalizeDate(asStr(row.asof)),
    totalScore: asNum(row.total_score),
    signal,
    marketRegime: asStr((factors as Record<string, unknown>).market_regime, "unknown").toLowerCase(),
    stableAccumulation:
      asBool((factors as Record<string, unknown>).stable_accumulation) ||
      asNum((factors as Record<string, unknown>).stable_accumulation_days) >= 2,
    stableAboveAvg:
      asBool((factors as Record<string, unknown>).stable_above_avg) ||
      asNum((factors as Record<string, unknown>).stable_above_avg_days_5) >= 1,
    bullTurn: stableTurn === "bull-weak" || stableTurn === "bull-strong",
    avwapSupport: asNum((factors as Record<string, unknown>).avwap_support),
    foreign5d: asNum((factors as Record<string, unknown>).foreign_5d),
    institution5d: asNum((factors as Record<string, unknown>).institution_5d),
    volRatio: asNum((factors as Record<string, unknown>).vol_ratio),
    rsi14: asNum((factors as Record<string, unknown>).rsi14),
    entryGrade: asStr((factors as Record<string, unknown>).entry_grade, "").toUpperCase(),
    trendGrade: asStr((factors as Record<string, unknown>).trend_grade, "").toUpperCase(),
    pivotGrade: asStr((factors as Record<string, unknown>).pivot_grade, "").toUpperCase(),
    distGrade: asStr((factors as Record<string, unknown>).dist_grade, "").toUpperCase(),
    warnGrade: asStr((factors as Record<string, unknown>).warn_grade, "").toUpperCase(),
  };
}

function buildPriceMap(rows: PriceRow[]): Map<string, PriceRow[]> {
  const map = new Map<string, PriceRow[]>();
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.code}:${row.trade_date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!map.has(row.code)) map.set(row.code, []);
    map.get(row.code)!.push(row);
  }
  for (const [code, series] of map.entries()) {
    map.set(
      code,
      series.slice().sort((a, b) => a.trade_date.localeCompare(b.trade_date)),
    );
  }
  return map;
}

function getForwardStats(series: PriceRow[], asof: string, horizonBars: number): { ret: number; mdd: number } | null {
  const idx = series.findIndex((x) => x.trade_date >= asof);
  if (idx < 0) return null;
  const future = series[idx + horizonBars];
  if (!future) return null;

  const entry = series[idx].close;
  const exit = future.close;
  if (!(entry > 0) || !(exit > 0)) return null;

  let worst = 0;
  for (let i = idx + 1; i <= idx + horizonBars; i += 1) {
    const close = series[i]?.close;
    if (!(close > 0)) continue;
    const drawdown = ((close - entry) / entry) * 100;
    if (drawdown < worst) worst = drawdown;
  }

  return {
    ret: ((exit - entry) / entry) * 100,
    mdd: worst,
  };
}

function computePatternStats(rows: LabelRow[], patterns: Pattern[], baselineWinRate: number, minSamples: number): PatternStat[] {
  const stats: PatternStat[] = [];

  for (const pattern of patterns) {
    const matched = rows.filter(pattern.check);
    if (matched.length < minSamples) continue;
    const rallyCount = matched.filter((x) => x.isRally).length;
    const avgRet = matched.reduce((sum, x) => sum + x.forwardReturnPct, 0) / matched.length;
    const avgMdd = matched.reduce((sum, x) => sum + x.maxDrawdownPct, 0) / matched.length;
    const winRate = (rallyCount / matched.length) * 100;

    stats.push({
      name: pattern.name,
      samples: matched.length,
      rallyCount,
      winRatePct: round2(winRate),
      liftVsBasePct: round2(winRate - baselineWinRate),
      avgForwardReturnPct: round2(avgRet),
      avgMaxDrawdownPct: round2(avgMdd),
    });
  }

  return stats.sort((a, b) => b.liftVsBasePct - a.liftVsBasePct || b.samples - a.samples);
}

function buildPatterns(): Pattern[] {
  return [
    { name: "score>=70", check: (x) => x.totalScore >= 70 },
    { name: "score>=75", check: (x) => x.totalScore >= 75 },
    { name: "signal=BUY|STRONG_BUY", check: (x) => x.signal === "BUY" || x.signal === "STRONG_BUY" },
    { name: "stable_accumulation", check: (x) => x.stableAccumulation },
    { name: "stable_turn_bull", check: (x) => x.bullTurn },
    { name: "stable_above_avg", check: (x) => x.stableAboveAvg },
    { name: "avwap_support>=2", check: (x) => x.avwapSupport >= 2 },
    { name: "foreign_5d>0", check: (x) => x.foreign5d > 0 },
    { name: "institution_5d>0", check: (x) => x.institution5d > 0 },
    { name: "foreign+institution>0", check: (x) => x.foreign5d > 0 && x.institution5d > 0 },
    { name: "vol_ratio>=1.5", check: (x) => x.volRatio >= 1.5 },
    { name: "rsi14_45_65", check: (x) => x.rsi14 >= 45 && x.rsi14 <= 65 },
    { name: "accumulation+turn", check: (x) => x.stableAccumulation && x.bullTurn },
    {
      name: "accumulation+turn+avwap",
      check: (x) => x.stableAccumulation && x.bullTurn && x.avwapSupport >= 2,
    },
    {
      name: "buy_signal+score70+flow",
      check: (x) => (x.signal === "BUY" || x.signal === "STRONG_BUY") && x.totalScore >= 70 && x.foreign5d > 0,
    },
    { name: "entry_grade=A|B", check: (x) => x.entryGrade === "A" || x.entryGrade === "B" },
    { name: "trend_grade=A|B", check: (x) => x.trendGrade === "A" || x.trendGrade === "B" },
    { name: "pivot_grade=A|B", check: (x) => x.pivotGrade === "A" || x.pivotGrade === "B" },
    { name: "dist_grade=A|B", check: (x) => x.distGrade === "A" || x.distGrade === "B" },
    {
      name: "entry+trend+pivot all A|B",
      check: (x) =>
        (x.entryGrade === "A" || x.entryGrade === "B") &&
        (x.trendGrade === "A" || x.trendGrade === "B") &&
        (x.pivotGrade === "A" || x.pivotGrade === "B"),
    },
    { name: "warn_not_sell", check: (x) => x.warnGrade !== "SELL" },
  ];
}

function summarizeRegime(rows: LabelRow[]): DiscoveryReport["regimeSummary"] {
  const bucket = new Map<string, { count: number; wins: number; retSum: number }>();
  for (const row of rows) {
    const key = row.marketRegime || "unknown";
    const acc = bucket.get(key) ?? { count: 0, wins: 0, retSum: 0 };
    acc.count += 1;
    if (row.isRally) acc.wins += 1;
    acc.retSum += row.forwardReturnPct;
    bucket.set(key, acc);
  }

  return Array.from(bucket.entries())
    .map(([regime, acc]) => ({
      regime,
      samples: acc.count,
      winRatePct: round2((acc.wins / Math.max(1, acc.count)) * 100),
      avgForwardReturnPct: round2(acc.retSum / Math.max(1, acc.count)),
    }))
    .sort((a, b) => b.samples - a.samples);
}

function safeAvg(rows: LabelRow[]): { winRatePct: number; avgReturnPct: number } {
  if (rows.length === 0) return { winRatePct: 0, avgReturnPct: 0 };
  const wins = rows.filter((x) => x.isRally).length;
  const ret = rows.reduce((sum, x) => sum + x.forwardReturnPct, 0) / rows.length;
  return {
    winRatePct: round2((wins / rows.length) * 100),
    avgReturnPct: round2(ret),
  };
}

function saveReport(path: string, report: DiscoveryReport): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function main() {
  const lookbackDays = Number(parseArg("lookback", "780"));
  const horizonBars = Number(parseArg("horizon", "60"));
  const rallyThresholdPct = Number(parseArg("rally", "30"));
  const minSamples = Number(parseArg("minSamples", "40"));
  const splitRatio = Number(parseArg("split", "0.7"));
  const maxRows = Number(parseArg("maxRows", "120000"));
  const outPath = parseArg("out", "tmp/pre_rally_patterns_report.json");
  const autoExtend = parseArg("autoExtend", "true") !== "false";
  const notes: string[] = [];

  const from = new Date();
  from.setDate(from.getDate() - lookbackDays);
  const fromDate = from.toISOString().slice(0, 10);

  const rawRows = await fetchScoreRows(fromDate, maxRows);
  if (rawRows.length === 0) {
    const report: DiscoveryReport = {
      generatedAt: new Date().toISOString(),
      config: {
        lookbackDays,
        horizonBars,
        rallyThresholdPct,
        minSamples,
        splitRatio,
        maxRows,
        autoExtend,
      },
      dataset: {
        scoreRows: 0,
        labeledRows: 0,
        skippedMissingPrice: 0,
        skippedTooRecent: 0,
        uniqueCodes: 0,
      },
      baseline: {
        trainWinRatePct: 0,
        testWinRatePct: 0,
        trainAvgReturnPct: 0,
        testAvgReturnPct: 0,
      },
      stablePatterns: [],
      exploratoryTopTrain: [],
      regimeSummary: [],
      notes: ["scores 데이터가 없어 분석을 진행하지 못했습니다."],
    };
    saveReport(outPath, report);
    console.log("[pre-rally] no score rows found.");
    console.log(`[pre-rally] report=${outPath}`);
    return;
  }

  let features = rawRows.map(extractFeature).filter((x) => x.code && x.asof);
  let activeCodes = Array.from(new Set(features.map((x) => x.code)));
  const priceRows = await fetchPriceRows(activeCodes, fromDate);
  const priceMap = buildPriceMap(priceRows);

  let skippedMissingPrice = 0;
  let skippedTooRecent = 0;
  const labeledRows: LabelRow[] = [];

  for (const row of features) {
    const series = priceMap.get(row.code);
    if (!series || series.length === 0) {
      skippedMissingPrice += 1;
      continue;
    }
    const stats = getForwardStats(series, row.asof, horizonBars);
    if (!stats) {
      skippedTooRecent += 1;
      continue;
    }

    labeledRows.push({
      ...row,
      forwardReturnPct: round2(stats.ret),
      maxDrawdownPct: round2(stats.mdd),
      isRally: stats.ret >= rallyThresholdPct,
    });
  }

  if (priceRows.length === 0) {
    notes.push("stock_daily 조회 결과가 비어 daily_indicators fallback을 사용했거나, 가격 데이터 소스가 비어 있습니다.");
  }

  if (labeledRows.length === 0) {
    const pullbackFeatures = await fetchPullbackFeatureRows(fromDate, maxRows);
    if (pullbackFeatures.length > 0) {
      notes.push(`scores 라벨이 0건이라 pullback_signals fallback 사용: rows=${pullbackFeatures.length}`);
      features = pullbackFeatures;
      activeCodes = Array.from(new Set(features.map((x) => x.code)));

      const pbPrices = await fetchPriceRows(activeCodes, fromDate);
      const pbPriceMap = buildPriceMap(pbPrices);

      skippedMissingPrice = 0;
      skippedTooRecent = 0;
      labeledRows.length = 0;

      for (const row of features) {
        const series = pbPriceMap.get(row.code);
        if (!series || series.length === 0) {
          skippedMissingPrice += 1;
          continue;
        }
        const stats = getForwardStats(series, row.asof, horizonBars);
        if (!stats) {
          skippedTooRecent += 1;
          continue;
        }

        labeledRows.push({
          ...row,
          forwardReturnPct: round2(stats.ret),
          maxDrawdownPct: round2(stats.mdd),
          isRally: stats.ret >= rallyThresholdPct,
        });
      }
    }
  }

  if (autoExtend && labeledRows.length === 0 && skippedTooRecent > 0) {
    const extendDays = lookbackDays + horizonBars * 8;
    const extendedFrom = new Date();
    extendedFrom.setDate(extendedFrom.getDate() - extendDays);
    const extendedFromDate = extendedFrom.toISOString().slice(0, 10);

    const extendedFeatures = await fetchPullbackFeatureRows(extendedFromDate, maxRows);
    if (extendedFeatures.length > 0) {
      notes.push(`auto-extend 재시도: lookback ${lookbackDays}d -> ${extendDays}d`);
      features = extendedFeatures;
      activeCodes = Array.from(new Set(features.map((x) => x.code)));

      const extPrices = await fetchPriceRows(activeCodes, extendedFromDate);
      const extPriceMap = buildPriceMap(extPrices);

      skippedMissingPrice = 0;
      skippedTooRecent = 0;
      labeledRows.length = 0;

      for (const row of features) {
        const series = extPriceMap.get(row.code);
        if (!series || series.length === 0) {
          skippedMissingPrice += 1;
          continue;
        }
        const stats = getForwardStats(series, row.asof, horizonBars);
        if (!stats) {
          skippedTooRecent += 1;
          continue;
        }

        labeledRows.push({
          ...row,
          forwardReturnPct: round2(stats.ret),
          maxDrawdownPct: round2(stats.mdd),
          isRally: stats.ret >= rallyThresholdPct,
        });
      }
    }
  }

  if (labeledRows.length < minSamples * 2) {
    notes.push(`라벨 표본 부족: labeledRows=${labeledRows.length}, minNeeded=${minSamples * 2}`);
  }
  if (labeledRows.length === 0 && skippedTooRecent > 0) {
    notes.push(`미래 구간 부족 비중 높음: skippedTooRecent=${skippedTooRecent}`);
  }

  const sortedRows = labeledRows.slice().sort((a, b) => a.asof.localeCompare(b.asof));
  const splitIndex = Math.max(1, Math.min(sortedRows.length - 1, Math.floor(sortedRows.length * splitRatio)));
  const trainRows = sortedRows.slice(0, splitIndex);
  const testRows = sortedRows.slice(splitIndex);

  const baselineTrain = safeAvg(trainRows);
  const baselineTest = safeAvg(testRows);

  const patterns = buildPatterns();
  const trainStats = computePatternStats(trainRows, patterns, baselineTrain.winRatePct, minSamples);
  const testStats = computePatternStats(testRows, patterns, baselineTest.winRatePct, Math.max(20, Math.floor(minSamples * 0.5)));
  const testMap = new Map(testStats.map((x) => [x.name, x]));

  const stablePatterns: PatternStat[] = [];
  for (const train of trainStats) {
    const test = testMap.get(train.name);
    if (!test) continue;
    if (train.liftVsBasePct <= 0 || test.liftVsBasePct <= 0) continue;
    if (test.winRatePct < baselineTest.winRatePct + 2) continue;
    stablePatterns.push(test);
  }

  stablePatterns.sort((a, b) => b.liftVsBasePct - a.liftVsBasePct || b.samples - a.samples);

  const report: DiscoveryReport = {
    generatedAt: new Date().toISOString(),
    config: {
      lookbackDays,
      horizonBars,
      rallyThresholdPct,
      minSamples,
      splitRatio,
      maxRows,
      autoExtend,
    },
    dataset: {
      scoreRows: rawRows.length,
      labeledRows: labeledRows.length,
      skippedMissingPrice,
      skippedTooRecent,
        uniqueCodes: activeCodes.length,
    },
    baseline: {
      trainWinRatePct: baselineTrain.winRatePct,
      testWinRatePct: baselineTest.winRatePct,
      trainAvgReturnPct: baselineTrain.avgReturnPct,
      testAvgReturnPct: baselineTest.avgReturnPct,
    },
    stablePatterns: stablePatterns.slice(0, 20),
    exploratoryTopTrain: trainStats.slice(0, 20),
    regimeSummary: summarizeRegime(labeledRows),
    notes,
  };

  saveReport(outPath, report);

  console.log(
    `[pre-rally] done lookback=${lookbackDays}d horizon=${horizonBars}d rally>=${rallyThresholdPct}% rows=${labeledRows.length} train=${trainRows.length} test=${testRows.length}`,
  );
  console.log(
    `[pre-rally] baseline trainWin=${baselineTrain.winRatePct}% testWin=${baselineTest.winRatePct}% stablePatterns=${report.stablePatterns.length}`,
  );

  if (report.stablePatterns.length === 0) {
    console.log("[pre-rally] no stable pattern found. Try lowering --minSamples or rally threshold.");
  } else {
    for (const row of report.stablePatterns.slice(0, 10)) {
      console.log(
        `[pre-rally] pattern=${row.name} samples=${row.samples} win=${row.winRatePct}% lift=${row.liftVsBasePct}% avgRet=${row.avgForwardReturnPct}% avgMdd=${row.avgMaxDrawdownPct}%`,
      );
    }
  }

  console.log(`[pre-rally] report=${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
