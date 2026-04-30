import ensemble from '../src/strategies/ensemble';
import { positionSizeByVolatility } from '../src/risk/index';

// Simple synthetic backtester that demonstrates connecting ensemble -> risk -> trade

function generatePriceSeries(days = 252, start = 100) {
  const prices: number[] = [start];
  for (let i = 1; i < days; i++) {
    const r = (Math.random() - 0.5) * 0.02; // +/-1%
    prices.push(prices[i - 1] * (1 + r));
  }
  return prices;
}

async function main() {
  console.log('Starting minimal backtest demo');
  const tickers = ['A', 'B', 'C'];
  const priceSeries = Object.fromEntries(tickers.map(t => [t, generatePriceSeries(60, 100 + Math.random() * 20)]));

  // simulate daily signals from two simple strategies
  const days = 60;
  let account = 100000;
  const equityCurve: number[] = [];

  for (let d = 20; d < days - 1; d++) {
    // produce simple momentum and mean-reversion scores
    const momentumSignals = tickers.map(t => ({ id: t, score: priceSeries[t][d] / priceSeries[t][d - 5] - 1 }));
    const meanRevSignals = tickers.map(t => ({ id: t, score: priceSeries[t][d - 1] / priceSeries[t][d - 20] - 1 }));

    const combined = ensemble.combineSignals([momentumSignals, meanRevSignals], [0.6, 0.4]);
    const weights = ensemble.computePortfolioWeights(combined);

    // execute: buy weights proportional using risk manager at today's price
    let dayPnL = 0;
    for (const w of weights) {
      if (w.weight <= 0) continue;
      const price = priceSeries[w.id][d];
      const vol = 0.02; // placeholder
      const sizing = positionSizeByVolatility({ accountBalance: account, targetRiskPct: 0.01 * w.weight, price, volatility: vol });
      const positionValue = sizing.positionValue || 0;
      // simulate next-day return (guarded)
      const nextPrice = priceSeries[w.id][d + 1];
      const nextReturn = nextPrice !== undefined ? (nextPrice - price) / price : 0;
      const pnl = positionValue * nextReturn;
      dayPnL += pnl;
    }
    account += dayPnL;
    equityCurve.push(account);
  }

  console.log('Backtest finished. Final account:', account.toFixed(2));
  console.log('Equity sample (last 10):', equityCurve.slice(-10).map(x => x.toFixed(2)));
}

main().catch(e => {
  console.error(e);
  process.exit(2);
});
