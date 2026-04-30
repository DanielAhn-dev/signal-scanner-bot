import tm from '../src/execution/tradeManager';

function main() {
  const base = { id: 'A', qty: 100, avgPrice: 10, stops: {} };
  console.log('Base position:', base);
  const order = { id: 'A', qty: 50, entryPrice: 12 };
  const p1 = tm.applyPyramiding(base, order, 4);
  console.log('After pyramid:', p1);
  const updated = tm.updateTrailingStop(p1, 13, 0.05);
  console.log('After trailing update:', updated);
}

main();
