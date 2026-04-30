import path from 'path';
import fs from 'fs';
import { volatilityFromReturns, positionSizeByVolatility, fractionalKelly, enforceMaxDrawdown, enforceDailyLossLimit } from '../src/risk/index';

function sampleReturns(days = 60) {
  // simple synthetic daily returns around 0 with some volatility
  const arr: number[] = [];
  for (let i = 0; i < days; i++) {
    const r = (Math.random() - 0.5) * 0.02; // +/-1% range
    arr.push(r);
  }
  return arr;
}

async function main() {
  console.log('Running simple risk tests');
  const returns = sampleReturns(90);
  const vol = volatilityFromReturns(returns, true);
  console.log('Estimated annual vol:', (vol * 100).toFixed(2) + '%');

  const sizing = positionSizeByVolatility({
    accountBalance: 100000,
    targetRiskPct: 0.01,
    price: 50,
    volatility: vol / Math.sqrt(252), // convert annual -> daily approx
    volMultiplier: 2,
  });
  console.log('Position sizing result:', sizing);

  const k = fractionalKelly(0.55, 1.5, 0.5);
  console.log('Fractional Kelly suggested risk fraction:', k.toFixed(4));

  const dd = enforceMaxDrawdown(85000, 120000, 0.2);
  console.log('Drawdown check:', dd);

  const daily = enforceDailyLossLimit(-800, 0.01, 100000);
  console.log('Daily loss check:', daily);
}

main().catch(e => {
  console.error('Error running tests', e);
  process.exit(2);
});
