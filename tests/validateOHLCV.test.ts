import test from "node:test";
import assert from "node:assert/strict";
import type { StockOHLCV } from "../src/data/types";
import { sanitizeOHLCV } from "../src/lib/validateOHLCV";
import { calculateScore } from "../src/score/engine";

function bar(day: number, close: number, volume = 1000): StockOHLCV {
  const d = new Date(Date.UTC(2025, 0, 1) + day * 86_400_000).toISOString().slice(0, 10);
  return { date: d, code: "T", open: close, high: close * 1.01, low: close * 0.99, close, volume, amount: close * volume };
}

function series(n: number, close = 100): StockOHLCV[] {
  return Array.from({ length: n }, (_, i) => bar(i, close + (i % 5)));
}

test("sanitizeOHLCV: 하루짜리 스파이크는 제거", () => {
  const data = series(10);
  data[5] = bar(5, 1000);
  const out = sanitizeOHLCV(data);
  assert.equal(out.length, 9);
});

test("sanitizeOHLCV: 액면분할 후에도 이후 봉이 살아남고 과거는 새 수준으로 환산", () => {
  const data = [...series(10, 1000), ...Array.from({ length: 10 }, (_, i) => bar(10 + i, 200 + (i % 5)))];
  const out = sanitizeOHLCV(data);
  assert.equal(out.length, 20);
  const maxClose = Math.max(...out.map((b) => b.close));
  assert.ok(maxClose < 300, `환산 후 최대 종가 ${maxClose}`);
  assert.ok(out[0].volume > 1000, "가격이 줄면 거래량은 늘어야 함");
});

test("sanitizeOHLCV: 마지막 봉이 급변이면 확인 불가로 제거", () => {
  const data = series(10);
  data.push(bar(10, 1000));
  assert.equal(sanitizeOHLCV(data).length, 10);
});

test("calculateScore: 최신 봉이 이상값으로 제거되면 null", () => {
  const data = series(260);
  assert.ok(calculateScore(data));
  data.push(bar(260, 1000));
  assert.equal(calculateScore(data), null);
});
