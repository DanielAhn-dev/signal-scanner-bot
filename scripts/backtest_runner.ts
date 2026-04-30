import ensemble from '../src/strategies/ensemble';
import { positionSizeByVolatility } from '../src/risk/index';

// Enhanced synthetic backtester: includes trading costs, slippage, and basic metrics

function generatePriceSeries(days = 252, start = 100) {
  const prices: number[] = [start];
  for (let i = 1; i < days; i++) {
    const r = (Math.random() - 0.5) * 0.02; // +/-1%
    prices.push(prices[i - 1] * (1 + r));
  }
  return prices;
}

function mean(arr: number[]) { return arr.reduce((a, b) => a + b, 0) / (arr.length || 1); }
function std(arr: number[]) {
  const m = mean(arr); const v = arr.reduce((s, x) => s + Math.pow(x - m, 2), 0) / (Math.max(1, arr.length - 1));
  return Math.sqrt(v);
}

function maxDrawdown(equity: number[]) {
  let peak = -Infinity; let maxDd = 0;
  for (const v of equity) {
    if (v > peak) peak = v;
    const dd = (peak - v) / peak;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd;
}

async function main() {
  console.log('Starting enhanced backtest demo');
  const tickers = ['A', 'B', 'C'];
  const priceSeries = Object.fromEntries(tickers.map(t => [t, generatePriceSeries(120, 100 + Math.random() * 20)]));

  const days = 120;
  let account = 100000;
  const equityCurve: number[] = [];
  const dailyReturns: number[] = [];

  // trading cost parameters
  const costPct = 0.0005; // proportional cost per notional (0.05%)
  const perShare = 0.005; // per-share fee
  const slippagePct = 0.0005; // slippage as fraction of notional

  for (let d = 20; d < days - 1; d++) {
    const momentumSignals = tickers.map(t => ({ id: t, score: priceSeries[t][d] / priceSeries[t][d - 5] - 1 }));
    const meanRevSignals = tickers.map(t => ({ id: t, score: priceSeries[t][d - 1] / priceSeries[t][d - 20] - 1 }));

    const combined = ensemble.combineSignals([momentumSignals, meanRevSignals], [0.6, 0.4]);
    const weights = ensemble.computePortfolioWeights(combined);

    let dayPnL = 0;
    let dayNotionalTraded = 0;
    for (const w of weights) {
      if (w.weight <= 0) continue;
      const price = priceSeries[w.id][d];
      const vol = 0.02; // placeholder
      const sizing = positionSizeByVolatility({ accountBalance: account, targetRiskPct: 0.01 * w.weight, price, volatility: vol });
      const shares = sizing.shares || 0;
      const positionValue = sizing.positionValue || 0;

      // costs: proportional + per-share
      const tc = positionValue * costPct + shares * perShare;
      const slip = positionValue * slippagePct;

      // simulate next-day return
      const nextPrice = priceSeries[w.id][d + 1];
      const nextReturn = nextPrice !== undefined ? (nextPrice - price) / price : 0;
      const pnl = positionValue * nextReturn - tc - slip;
      dayPnL += pnl;
      dayNotionalTraded += positionValue;
    }

    const prevAccount = account;
    account += dayPnL;
    equityCurve.push(account);
    const dailyR = (account - prevAccount) / prevAccount;
    dailyReturns.push(dailyR);
  }

  const totalReturn = account / 100000 - 1;
  const annualized = Math.pow(account / 100000, 252 / (days - 20)) - 1;
  const sharpe = (mean(dailyReturns) / (std(dailyReturns) || 1)) * Math.sqrt(252);
  const mdd = maxDrawdown(equityCurve);

  console.log('Backtest finished. Final account:', account.toFixed(2));
  console.log('Total return:', (totalReturn * 100).toFixed(2) + '%', 'Annualized:', (annualized * 100).toFixed(2) + '%');
  console.log('Sharpe (ann):', sharpe.toFixed(3), 'Max Drawdown:', (mdd * 100).toFixed(2) + '%');
  console.log('Equity sample (last 10):', equityCurve.slice(-10).map(x => x.toFixed(2)));
}

main().catch(e => {
  console.error(e);
  process.exit(2);
});
