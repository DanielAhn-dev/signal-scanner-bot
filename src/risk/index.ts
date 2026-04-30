export type PositionSizingOptions = {
  accountBalance: number; // total account value
  targetRiskPct?: number; // fraction of account to risk per trade (e.g., 0.01 = 1%)
  price: number; // entry price
  stopLossPct?: number; // explicit stop distance as fraction of price (e.g., 0.05)
  volatility?: number; // historical vol as fraction (e.g., 0.02 = 2%)
  volMultiplier?: number; // convert vol -> stop distance (default 2)
};

export function volatilityFromReturns(returns: number[], annualize = true): number {
  if (!returns || returns.length === 0) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / (returns.length - 1 || 1);
  const sd = Math.sqrt(variance);
  return annualize ? sd * Math.sqrt(252) : sd;
}

export function positionSizeByVolatility(opts: PositionSizingOptions) {
  const { accountBalance, targetRiskPct = 0.01, price, stopLossPct, volatility, volMultiplier = 2 } = opts;
  if (!accountBalance || !price) return { shares: 0, dollars: 0, reason: 'invalid inputs' };

  let stop = stopLossPct;
  if ((!stop || stop <= 0) && volatility && volatility > 0) {
    stop = Math.max(0.001, volatility * volMultiplier);
  }
  if (!stop || stop <= 0) return { shares: 0, dollars: 0, reason: 'no stop or volatility provided' };

  const riskPerShare = price * stop;
  const dollarsRisked = accountBalance * targetRiskPct;
  const rawShares = Math.floor(dollarsRisked / riskPerShare);
  const positionValue = rawShares * price;

  return {
    shares: rawShares,
    positionValue,
    dollarsRisked: rawShares * riskPerShare,
    stopLossPct: stop,
  };
}

// fractional Kelly position sizing: returns fractional risk of account (0..1)
export function fractionalKelly(winProb: number, winLossRatio: number, fraction = 0.5) {
  if (winLossRatio <= 0) return 0;
  const kelly = winProb - (1 - winProb) / winLossRatio;
  return Math.max(0, kelly * fraction);
}

export function enforceMaxDrawdown(currentBalance: number, peakBalance: number, maxDrawdownPct: number) {
  if (peakBalance <= 0) return { ok: true };
  const dd = (peakBalance - currentBalance) / peakBalance;
  const breach = dd > maxDrawdownPct;
  return { ok: !breach, drawdown: dd, breach };
}

export function enforceDailyLossLimit(dailyLoss: number, dailyLimitPct: number, accountBalance: number) {
  const limit = accountBalance * dailyLimitPct;
  return { withinLimit: Math.abs(dailyLoss) <= limit, limit, dailyLoss };
}

export default {
  volatilityFromReturns,
  positionSizeByVolatility,
  fractionalKelly,
  enforceMaxDrawdown,
  enforceDailyLossLimit,
};
