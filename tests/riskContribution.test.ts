import test from "node:test";
import assert from "node:assert/strict";
import { buildRiskContribution } from "../src/lib/riskContribution";

function series(n: number, f: (t: number) => number) {
  let p = 100;
  const out: Array<{ date: string; close: number }> = [];
  for (let t = 0; t < n; t++) {
    p *= 1 + f(t);
    out.push({ date: `d${String(t).padStart(4, "0")}`, close: p });
  }
  return out;
}
const wave = (amp: number, phase = 0) => (t: number) => amp * Math.sin(t * 0.7 + phase) + amp * 0.3 * Math.cos(t * 1.9 + phase);

test("위험 몫 합은 100%, 변동 큰 종목이 비중보다 큰 몫을 가진다", () => {
  const r = buildRiskContribution([
    { code: "A", name: "안정", value: 500, closes: series(200, wave(0.002)) },
    { code: "B", name: "출렁", value: 500, closes: series(200, wave(0.02, 2)) },
  ])!;
  const sum = r.holdings.reduce((s, h) => s + h.riskSharePct, 0);
  assert.ok(Math.abs(sum - 100) < 1e-6);
  assert.equal(r.holdings[0].code, "B");
  assert.ok(r.holdings[0].riskSharePct > 80);
  assert.equal(r.holdings[0].weightPct, 50);
});

test("현금성은 변동 0으로 비중만 차지해 계좌 변동성을 낮춘다", () => {
  const rows = [{ code: "B", name: "출렁", value: 500, closes: series(200, wave(0.02)) }];
  const solo = buildRiskContribution(rows)!;
  const mixed = buildRiskContribution([...rows, { code: "CASH", name: "예수금", value: 500, closes: null }])!;
  assert.ok(Math.abs(mixed.portfolioVolPct - solo.portfolioVolPct / 2) < 1e-6);
  assert.ok(Math.abs(mixed.holdings[0].weightPct - 50) < 1e-9);
});

test("같이 움직이는 두 종목은 분산 착시 쌍으로 잡힌다", () => {
  const f = wave(0.01);
  const r = buildRiskContribution([
    { code: "A", name: "가", value: 500, closes: series(200, f) },
    { code: "B", name: "나", value: 500, closes: series(200, (t) => f(t) * 1.5) },
  ])!;
  assert.equal(r.highCorrPairs.length, 1);
  assert.ok(r.effectiveBets < 2);
});

test("이력이 짧은 종목은 제외하고 목록에 남긴다", () => {
  const r = buildRiskContribution([
    { code: "A", name: "긴", value: 500, closes: series(200, wave(0.01)) },
    { code: "N", name: "신규", value: 500, closes: series(30, wave(0.01)) },
  ])!;
  assert.deepEqual(r.excluded.map((e) => e.code), ["N"]);
  assert.ok(r.coveragePct < 100 || r.holdings.length === 1);
});

test("이력이 전부 없거나 평가금이 없으면 null", () => {
  assert.equal(buildRiskContribution([]), null);
  assert.equal(buildRiskContribution([{ code: "N", name: "신규", value: 100, closes: series(10, wave(0.01)) }]), null);
});
