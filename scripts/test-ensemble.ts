import ensemble, { Signal } from '../src/strategies/ensemble';

function mockSignals(prefix: string, tickers: string[]): Signal[] {
  return tickers.map((t, i) => ({ id: t, score: Math.random() * (i + 1), timestamp: new Date().toISOString(), strategy: prefix }));
}

async function main() {
  const s1 = mockSignals('alpha', ['A', 'B', 'C', 'D']);
  const s2 = mockSignals('trend', ['B', 'C', 'E']);
  const s3 = mockSignals('value', ['A', 'E', 'F']);

  const decayed1 = ensemble.applyTimeDecay(s1, new Date(), 10);
  const combined = ensemble.combineSignals([decayed1, s2, s3], [0.5, 0.3, 0.2]);
  console.log('Combined signals:', combined);

  const weights = ensemble.computePortfolioWeights(combined);
  console.log('Portfolio weights:', weights);
}

main().catch(e => {
  console.error(e);
  process.exit(2);
});
