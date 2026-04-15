import "dotenv/config";
import { supabase } from "../src/db/client";

type MarketKind = "KOSPI" | "KOSDAQ" | "ETF";

type StockMeta = {
  code: string;
  name: string;
  market: string;
  liquidity: number;
  market_cap: number;
};

type IndicatorRow = {
  code: string;
  trade_date: string;
  close: number;
  value_traded: number;
  rsi14: number;
  roc14: number;
  sma20: number;
  sma50: number;
  sma200: number;
};

type ScoreWeights = {
  technical: number;
  momentum: number;
  safety: number;
  trend: number;
  liquidity: number;
};

type Config = {
  name: string;
  weights: ScoreWeights;
  maxRsi: number;
  minValueTraded: number;
};

type CandidateEval = {
  code: string;
  date: string;
  score: number;
  holdReturnPct: number;
  maxReturnPct: number;
  maxDrawdownPct: number;
};

const EXCLUDED_ETF_PATTERNS = [
  /레버리지/i,
  /인버스/i,
  /선물/i,
  /곱버스/i,
  /2X/i,
  /3X/i,
  /ETN/i,
  /채권/i,
  /회사채/i,
];

function clamp(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function getTrendScore(row: IndicatorRow): number {
  const { close, sma20, sma50, sma200 } = row;
  let score = 0;
  if (close > sma20 && sma20 > 0) score += 20;
  if (close > sma50 && sma50 > 0) score += 20;
  if (close > sma200 && sma200 > 0) score += 18;
  if (sma20 > sma50 && sma50 > sma200 && sma200 > 0) score += 28;
  else if (sma50 > sma200 && sma200 > 0) score += 16;
  return clamp(score, 0, 100);
}

function getLiquidityScore(valueTraded: number): number {
  if (valueTraded >= 150_000_000_000) return 100;
  if (valueTraded >= 80_000_000_000) return 85;
  if (valueTraded >= 30_000_000_000) return 70;
  if (valueTraded >= 10_000_000_000) return 55;
  if (valueTraded >= 3_000_000_000) return 35;
  return 10;
}

function getSafetyScore(meta: StockMeta, row: IndicatorRow, market: MarketKind): number {
  let score = 40;

  if (market === "KOSPI") score += 22;
  if (market === "KOSDAQ") score += 8;
  if (market === "ETF") score += 14;

  if (meta.liquidity >= 300_000_000_000) score += 18;
  else if (meta.liquidity >= 100_000_000_000) score += 12;
  else if (meta.liquidity >= 30_000_000_000) score += 8;
  else score -= 6;

  if (meta.market_cap >= 5_000_000_000_000) score += 10;
  else if (meta.market_cap >= 1_000_000_000_000) score += 6;

  if (row.rsi14 >= 43 && row.rsi14 <= 66) score += 6;
  else if (row.rsi14 >= 70 || row.rsi14 <= 30) score -= 8;

  return clamp(score, 0, 100);
}

function calcScore(row: IndicatorRow, meta: StockMeta, market: MarketKind, config: Config): number {
  const technical = clamp((row.roc14 + 10) * 5, 0, 100);
  const momentum = clamp((row.roc14 + 6) * 7, 0, 100);
  const trend = getTrendScore(row);
  const liquidity = getLiquidityScore(row.value_traded);
  const safety = getSafetyScore(meta, row, market);

  const score =
    technical * config.weights.technical +
    momentum * config.weights.momentum +
    safety * config.weights.safety +
    trend * config.weights.trend +
    liquidity * config.weights.liquidity;

  return clamp(score, 0, 100);
}

async function fetchUniverse(market: MarketKind, limit: number): Promise<StockMeta[]> {
  let query = supabase
    .from("stocks")
    .select("code, name, market, liquidity, market_cap")
    .eq("is_active", true)
    .order("liquidity", { ascending: false })
    .limit(limit * 2);

  if (market === "ETF") {
    query = query.or("market.eq.ETF,name.ilike.%ETF%");
  } else {
    query = query.eq("market", market);
  }

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as Array<any>;
  const filtered = rows.filter((r) => {
    const name = String(r.name ?? "");
    if (!name || !r.code) return false;
    if (market === "ETF") return !EXCLUDED_ETF_PATTERNS.some((p) => p.test(name));
    return true;
  });

  return filtered.slice(0, limit).map((r) => ({
    code: r.code,
    name: r.name,
    market: r.market,
    liquidity: Number(r.liquidity ?? 0),
    market_cap: Number(r.market_cap ?? 0),
  }));
}

async function fetchSeries(code: string, fromDate: string): Promise<IndicatorRow[]> {
  const { data, error } = await supabase
    .from("daily_indicators")
    .select("code, trade_date, close, value_traded, rsi14, roc14, sma20, sma50, sma200")
    .eq("code", code)
    .gte("trade_date", fromDate)
    .order("trade_date", { ascending: true })
    .limit(500);

  if (error) throw error;

  return ((data ?? []) as Array<any>)
    .map((r) => ({
      code: r.code,
      trade_date: r.trade_date,
      close: Number(r.close ?? 0),
      value_traded: Number(r.value_traded ?? 0),
      rsi14: Number(r.rsi14 ?? 50),
      roc14: Number(r.roc14 ?? 0),
      sma20: Number(r.sma20 ?? 0),
      sma50: Number(r.sma50 ?? 0),
      sma200: Number(r.sma200 ?? 0),
    }))
    .filter((r) => r.close > 0);
}

function calcForwardStats(rows: IndicatorRow[], idx: number, holdDays: number) {
  const entry = rows[idx].close;
  const endIdx = Math.min(rows.length - 1, idx + holdDays);
  const future = rows.slice(idx + 1, endIdx + 1);
  if (!future.length) return null;

  const endClose = future[future.length - 1].close;
  const holdReturnPct = ((endClose - entry) / entry) * 100;

  let maxReturnPct = -999;
  let maxDrawdownPct = 999;
  for (const f of future) {
    const pct = ((f.close - entry) / entry) * 100;
    if (pct > maxReturnPct) maxReturnPct = pct;
    if (pct < maxDrawdownPct) maxDrawdownPct = pct;
  }

  return { holdReturnPct, maxReturnPct, maxDrawdownPct };
}

function parseArg(name: string, fallback: string): string {
  const hit = process.argv.find((x) => x.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : fallback;
}

async function main() {
  const market = (parseArg("market", "KOSPI").toUpperCase() as MarketKind);
  const lookbackDays = Number(parseArg("lookback", "220"));
  const holdDays = Number(parseArg("hold", "7"));
  const topN = Number(parseArg("top", "5"));
  const targetPct = Number(parseArg("target", "5"));
  const universeLimit = Number(parseArg("universe", "120"));

  const from = new Date();
  from.setDate(from.getDate() - lookbackDays);
  const fromDate = from.toISOString().slice(0, 10);

  const configs: Config[] = [
    {
      name: "baseline",
      weights: { technical: 0.36, momentum: 0.22, safety: 0.2, trend: 0.14, liquidity: 0.08 },
      maxRsi: 66,
      minValueTraded: 10_000_000_000,
    },
    {
      name: "defensive",
      weights: { technical: 0.3, momentum: 0.16, safety: 0.28, trend: 0.16, liquidity: 0.1 },
      maxRsi: 62,
      minValueTraded: 20_000_000_000,
    },
    {
      name: "balanced_plus",
      weights: { technical: 0.34, momentum: 0.2, safety: 0.22, trend: 0.16, liquidity: 0.08 },
      maxRsi: 65,
      minValueTraded: 15_000_000_000,
    },
  ];

  console.log(`[backtest] market=${market} from=${fromDate} hold=${holdDays}d top=${topN}`);

  const universe = await fetchUniverse(market, universeLimit);
  if (!universe.length) {
    console.log("No universe.");
    return;
  }

  const byDateByConfig = new Map<string, Map<string, CandidateEval[]>>();

  for (let i = 0; i < universe.length; i++) {
    const stock = universe[i];
    try {
      const rows = await fetchSeries(stock.code, fromDate);
      if (rows.length < holdDays + 20) continue;

      for (let j = 0; j < rows.length - holdDays; j++) {
        const row = rows[j];
        const forward = calcForwardStats(rows, j, holdDays);
        if (!forward) continue;

        for (const cfg of configs) {
          if (row.rsi14 > cfg.maxRsi) continue;
          if (row.value_traded < cfg.minValueTraded) continue;
          if (!(row.close > row.sma20 && row.sma20 > 0)) continue;

          const score = calcScore(row, stock, market, cfg);
          if (score < 55) continue;

          const dateMap = byDateByConfig.get(row.trade_date) ?? new Map<string, CandidateEval[]>();
          const list = dateMap.get(cfg.name) ?? [];
          list.push({
            code: stock.code,
            date: row.trade_date,
            score,
            holdReturnPct: forward.holdReturnPct,
            maxReturnPct: forward.maxReturnPct,
            maxDrawdownPct: forward.maxDrawdownPct,
          });
          dateMap.set(cfg.name, list);
          byDateByConfig.set(row.trade_date, dateMap);
        }
      }

      if ((i + 1) % 20 === 0) {
        console.log(`[backtest] processed ${i + 1}/${universe.length}`);
      }
    } catch (e) {
      console.error(`[backtest] skip ${stock.code}:`, String(e));
    }
  }

  for (const cfg of configs) {
    let trades = 0;
    let hit = 0;
    let holdSum = 0;
    let maxRetSum = 0;
    let ddSum = 0;

    for (const [, dateMap] of byDateByConfig) {
      const list = (dateMap.get(cfg.name) ?? [])
        .sort((a, b) => b.score - a.score)
        .slice(0, topN);

      for (const x of list) {
        trades += 1;
        holdSum += x.holdReturnPct;
        maxRetSum += x.maxReturnPct;
        ddSum += x.maxDrawdownPct;
        if (x.maxReturnPct >= targetPct) hit += 1;
      }
    }

    const avgHold = trades ? holdSum / trades : 0;
    const avgMaxRet = trades ? maxRetSum / trades : 0;
    const avgDD = trades ? ddSum / trades : 0;
    const hitRate = trades ? (hit / trades) * 100 : 0;

    console.log("\n===", cfg.name, "===");
    console.log(`trades=${trades}`);
    console.log(`hitRate(>${targetPct}%)=${hitRate.toFixed(2)}%`);
    console.log(`avgHoldReturn=${avgHold.toFixed(2)}%`);
    console.log(`avgMaxReturn=${avgMaxRet.toFixed(2)}%`);
    console.log(`avgMaxDrawdown=${avgDD.toFixed(2)}%`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
