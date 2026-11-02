import test from "node:test";
import assert from "node:assert/strict";
import { buildRiskContribution, riskConcentrated } from "../src/lib/riskContribution";

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

test("위험 쏠림은 몫 40% 이상이면서 비중의 2배 이상일 때만", () => {
  assert.equal(riskConcentrated({ weightPct: 10, riskSharePct: 45 }), true);
  assert.equal(riskConcentrated({ weightPct: 50, riskSharePct: 60 }), false); // 몫은 크지만 비중이 원래 큼
  assert.equal(riskConcentrated({ weightPct: 5, riskSharePct: 30 }), false); // 비중의 2배 넘어도 몫이 40% 미만
  assert.equal(riskConcentrated({ weightPct: 20, riskSharePct: 40 }), true); // 경계값 포함
});

test("종목별 과거 최악 낙폭과 동시 발생 가정 합계", () => {
  // A: 100 → 200 → 100 (−50%), B: 일정
  const a = Array.from({ length: 200 }, (_, t) => ({ date: `d${String(t).padStart(4, "0")}`, close: t < 100 ? 100 + t : 200 - (t - 100) }));
  const b = series(200, wave(0.001));
  const r = buildRiskContribution([
    { code: "A", name: "롤러", value: 500, closes: a },
    { code: "B", name: "잔잔", value: 500, closes: b },
  ])!;
  const ha = r.holdings.find((h) => h.code === "A")!;
  assert.ok(Math.abs(ha.worstDrawdownPct - (101 / 199 - 1) * 100) < 1e-6); // 고점 199 → 101
  assert.ok(r.worstCaseLossPct < 0 && r.worstCaseLossPct > ha.worstDrawdownPct);
  assert.equal(r.worstCaseMinDays, 200);
});
