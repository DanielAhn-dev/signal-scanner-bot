import test from "node:test";
import assert from "node:assert/strict";
import { sma, roc, rsiWilder, avwap } from "../src/indicators";

test("SMA", () => {
  const v = [1, 2, 3, 4, 5];
  const s = sma(v, 3);
  assert.ok(Number.isFinite(s[2]));
  assert.equal(s[2], 2);
  assert.equal(s[4], 4);
});

test("ROC", () => {
  const v = [100, 100, 100, 110];
  const r = roc(v, 3);
  assert.ok(Number.isFinite(r[3]));
  assert.equal(Math.round((r[3] ?? 0) * 10) / 10, 10);
});

test("RSI Wilder", () => {
  const v = Array.from({ length: 30 }, (_, i) => 100 + i);
  const r = rsiWilder(v, 14);
  assert.ok(Number.isFinite(r[29]));
  assert.ok((r[29] ?? 0) > 50);
});

test("AVWAP", () => {
  const prices = [1, 2, 3];
  const volumes = [10, 10, 10];
  const a = avwap(prices, volumes, 0);
  assert.ok(Number.isFinite(a[2]));
  assert.equal(a[2], 2);
});
