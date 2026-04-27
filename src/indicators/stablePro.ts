import type { StockOHLCV } from "../data/types";

export type StableTurnType =
  | "bull-weak"
  | "bull-strong"
  | "bear-weak"
  | "bear-strong"
  | "none";

export type StableProSignal = {
  avgPrice: number;
  support: number;
  boxHigh: number;
  boxLow: number;
  volMa: number;
  volRatio: number;
  aboveAvg: boolean;
  bullBreak: boolean;
  bearBreak: boolean;
  turn: StableTurnType;
  trustScore: number;
  accumulation: boolean;
};

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function highest(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((acc, value) => (value > acc ? value : acc), values[0] ?? 0);
}

function lowest(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((acc, value) => (value < acc ? value : acc), values[0] ?? 0);
}

function computeAtr(data: StockOHLCV[], period: number): number {
  if (!data.length) return 0;

  const trValues: number[] = [];
  for (let i = 1; i < data.length; i += 1) {
    const high = toNumber(data[i]?.high, 0);
    const low = toNumber(data[i]?.low, 0);
    const prevClose = toNumber(data[i - 1]?.close, 0);
    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );
    trValues.push(Math.max(0, tr));
  }

  const target = trValues.slice(-Math.max(1, period));
  return average(target);
}

function computeVwma(data: StockOHLCV[]): number {
  let weighted = 0;
  let volSum = 0;

  for (const row of data) {
    const close = toNumber(row.close, 0);
    const vol = Math.max(0, toNumber(row.volume, 0));
    weighted += close * vol;
    volSum += vol;
  }

  if (volSum <= 0) {
    return toNumber(data[data.length - 1]?.close, 0);
  }

  return weighted / volSum;
}

export function calculateStableProSignal(
  data: StockOHLCV[],
  options?: {
    volLen?: number;
    boxLen?: number;
    avgLen?: number;
    atrLen?: number;
  }
): StableProSignal {
  const volLen = Math.max(5, Math.floor(options?.volLen ?? 20));
  const boxLen = Math.max(5, Math.floor(options?.boxLen ?? 25));
  const avgLen = Math.max(5, Math.floor(options?.avgLen ?? 30));
  const atrLen = Math.max(5, Math.floor(options?.atrLen ?? 20));

  if (!data.length) {
    return {
      avgPrice: 0,
      support: 0,
      boxHigh: 0,
      boxLow: 0,
      volMa: 0,
      volRatio: 0,
      aboveAvg: false,
      bullBreak: false,
      bearBreak: false,
      turn: "none",
      trustScore: 0,
      accumulation: false,
    };
  }

  const closes = data.map((row) => toNumber(row.close, 0));
  const highs = data.map((row) => toNumber(row.high, 0));
  const lows = data.map((row) => toNumber(row.low, 0));
  const volumes = data.map((row) => Math.max(0, toNumber(row.volume, 0)));
  const lastClose = closes[closes.length - 1] ?? 0;

  const avgPrice = computeVwma(data.slice(-avgLen));
  const aboveAvg = lastClose >= avgPrice;

  const boxHigh = highest(highs.slice(-boxLen));
  const boxLow = lowest(lows.slice(-boxLen));
  const prevBoxHigh = highest(highs.slice(-(boxLen + 1), -1));
  const prevBoxLow = lowest(lows.slice(-(boxLen + 1), -1));

  const bullBreak = lastClose > prevBoxHigh && prevBoxHigh > 0;
  const bearBreak = lastClose < prevBoxLow && prevBoxLow > 0;

  const volMa = average(volumes.slice(-volLen));
  const volRatio = volMa > 0 ? volumes[volumes.length - 1] / volMa : 0;
  const volStrong = volRatio >= 1.3;
  const volVeryStrong = volRatio >= 1.6;

  const bullWeak = bullBreak && volStrong;
  const bullStrong = bullBreak && volVeryStrong && aboveAvg;
  const bearWeak = bearBreak && volStrong;
  const bearStrong = bearBreak && volVeryStrong && !aboveAvg;

  let turn: StableTurnType = "none";
  if (bullStrong) turn = "bull-strong";
  else if (bullWeak) turn = "bull-weak";
  else if (bearStrong) turn = "bear-strong";
  else if (bearWeak) turn = "bear-weak";

  const atr = computeAtr(data, atrLen);
  const support = Math.max(0, avgPrice - atr * 1.2);

  const nearAvgBandPct = avgPrice > 0 ? Math.abs((lastClose - avgPrice) / avgPrice) * 100 : 100;
  const accumulation =
    aboveAvg &&
    !bullBreak &&
    !bearBreak &&
    nearAvgBandPct <= 4 &&
    volRatio >= 0.9 &&
    volRatio <= 1.4;

  let trustScore = 50;
  trustScore += aboveAvg ? 10 : -10;
  trustScore += bullStrong ? 18 : 0;
  trustScore += bullWeak ? 10 : 0;
  trustScore -= bearStrong ? 20 : 0;
  trustScore -= bearWeak ? 10 : 0;
  trustScore += volRatio >= 1.6 ? 8 : volRatio >= 1.3 ? 5 : volRatio < 0.8 ? -8 : 0;
  trustScore += accumulation ? 6 : 0;
  trustScore += support > 0 && lastClose >= support ? 4 : -6;

  return {
    avgPrice,
    support,
    boxHigh,
    boxLow,
    volMa,
    volRatio,
    aboveAvg,
    bullBreak,
    bearBreak,
    turn,
    trustScore: Math.round(clamp(trustScore, 0, 100)),
    accumulation,
  };
}
