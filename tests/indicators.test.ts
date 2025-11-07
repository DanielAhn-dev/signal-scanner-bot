import { sma, roc, rsiWilder, avwap } from "../lib/indicators";

test("SMA", () => {
  const v = [1, 2, 3, 4, 5];
  const s = sma(v, 3);
  expect(s[2]).toBeCloseTo(2);
  expect(s[4]).toBeCloseTo(4);
});

test("ROC", () => {
  const v = [100, 100, 100, 110];
  const r = roc(v, 3);
  expect(r[3]).toBeCloseTo(10);
});

test("RSI Wilder", () => {
  const v = Array.from({ length: 30 }, (_, i) => 100 + i);
  const r = rsiWilder(v, 14);
  expect(r[29]!).toBeGreaterThan(50);
});

test("AVWAP", () => {
  const series = [
    { t: "1", o: 1, h: 1, l: 1, c: 1, v: 10 },
    { t: "2", o: 2, h: 2, l: 2, c: 2, v: 10 },
    { t: "3", o: 3, h: 3, l: 3, c: 3, v: 10 },
  ];
  const a = avwap(series, { idx: 0 });
  expect(a[2]!).toBeCloseTo(2);
});
