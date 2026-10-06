import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { computePullbackSignal, withIntradayBar, wilderRsiLast } from "../src/lib/pullbackSignal";

// 기대값은 밤 배치 Python(scripts/batch_modules/signals.py compute_pullback_signal)으로 만든 값이다.
// 2026-10-06 운영 DB 10/02 신호 230개 중 이력 21일 이상인 212개와 대조해 210개 완전 일치(2개는 DB 저장 정밀도 차이).
const fixture = JSON.parse(readFileSync(new URL("./fixtures/pullback_signal_python.json", import.meta.url), "utf8")) as Record<
  string,
  { bars: Array<{ date: string; high: number; low: number; close: number; volume: number }>; expected: Record<string, unknown> }
>;

for (const [name, { bars, expected }] of Object.entries(fixture)) {
  test(`computePullbackSignal: Python 밤 배치와 같은 값 (${name})`, () => {
    const got = computePullbackSignal(bars) as unknown as Record<string, unknown>;
    assert.ok(got);
    for (const [k, v] of Object.entries(expected)) {
      if (typeof v === "number") assert.ok(Math.abs(Number(got[k]) - v) <= (k === "dist_pct" ? 0.01 : 0.5), `${k}: ${got[k]} vs ${v}`);
      else assert.equal(got[k], v, k);
    }
  });
}

test("computePullbackSignal: 이력 21일 미만이면 신호를 내지 않는다(밤 배치와 같음)", () => {
  assert.equal(computePullbackSignal(fixture.up.bars.slice(-20)), null);
});

test("wilderRsiLast: 손실이 없으면 100, 변동이 없으면 계산 불가", () => {
  assert.equal(wilderRsiLast(Array.from({ length: 20 }, (_, i) => 100 + i)), 100);
  assert.equal(wilderRsiLast(Array.from({ length: 20 }, () => 100)), null);
});

test("withIntradayBar: 오늘 봉은 현재가 하나로 만들고 어제 고가·저가를 복사하지 않는다", () => {
  const hist = [
    { date: "2026-10-01", high: 110, low: 90, close: 100, volume: 1000 },
    { date: "2026-10-02", high: 120, low: 95, close: 105, volume: 1200 },
  ];
  const out = withIntradayBar(hist, "2026-10-06", 101, 300);
  assert.equal(out.length, 3);
  assert.deepEqual(out[2], { date: "2026-10-06", high: 101, low: 101, close: 101, volume: 300 });
  // 같은 날짜 봉이 이미 있으면 교체, 가격이 없으면 그대로
  assert.equal(withIntradayBar(out, "2026-10-06", 102, 400).length, 3);
  assert.equal(withIntradayBar(hist, "2026-10-06", 0, 300), hist);
});
