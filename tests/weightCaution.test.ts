import test from "node:test";
import assert from "node:assert/strict";
import { computeWeightCaution, WEIGHT_CAUTION_MIN_BARS } from "../src/services/weightCautionSignal";
import { computeMarketFlowCaution, MARKET_FLOW_MIN_DAYS, type MarketFlowDay } from "../src/services/marketFlowCaution";

// 하루 ±1% 번갈아 움직이는 잔잔한 종가
function calm(n: number, start = 100): number[] {
  const out = [start];
  for (let i = 1; i < n; i += 1) out.push(out[i - 1] * (i % 2 ? 1.01 : 0.99));
  return out;
}

test("computeWeightCaution: 데이터 부족·비정상 값이면 null", () => {
  assert.equal(computeWeightCaution(calm(WEIGHT_CAUTION_MIN_BARS - 1)), null);
  const bad = calm(WEIGHT_CAUTION_MIN_BARS);
  bad[10] = 0;
  assert.equal(computeWeightCaution(bad), null);
});

test("computeWeightCaution: 잔잔한 종목은 경고 없음", () => {
  const r = computeWeightCaution(calm(300))!;
  assert.equal(r.level, "none");
  assert.equal(r.message, null);
});

test("computeWeightCaution: 200일 평균보다 60% 넘게 오르면 과열", () => {
  const closes = calm(300);
  // 마지막 40일 동안 꾸준히 올려 200일 평균 대비 +60% 초과 (하루 변동성은 평소 수준 유지)
  for (let i = 260; i < 300; i += 1) closes[i] = closes[i - 1] * (i % 2 ? 1.03 : 1.0);
  const r = computeWeightCaution(closes)!;
  assert.ok(r.ma200Gap > 0.6, `gap ${r.ma200Gap}`);
  assert.equal(r.overheat, true);
  assert.ok(r.level !== "none");
  assert.match(r.message!, /200일 평균보다/);
});

test("computeWeightCaution: 고점 부근 변동성 2배는 변동성 급등, 고점에서 멀면 아님", () => {
  const near = calm(300);
  for (let i = 280; i < 300; i += 1) near[i] = near[i - 1] * (i % 2 ? 1.04 : 0.965);
  const r = computeWeightCaution(near)!;
  assert.ok(r.volRatio! > 2);
  assert.equal(r.volSpike, true);

  const far = calm(300);
  for (let i = 250; i < 280; i += 1) far[i] = far[i - 1] * 0.98; // 고점 대비 -45% 근처
  for (let i = 280; i < 300; i += 1) far[i] = far[i - 1] * (i % 2 ? 1.04 : 0.965);
  const r2 = computeWeightCaution(far)!;
  assert.ok(r2.fromHigh < 0.9);
  assert.equal(r2.volSpike, false);
});

// 동점이 없도록 작은 잡음(실제 수급은 매일 다르다)
const noise = (i: number) => Math.sin(i * 1.7) * 50;

function flowDays(n: number, foreign: (i: number) => number, close: (i: number) => number): MarketFlowDay[] {
  return Array.from({ length: n }, (_, i) => ({
    date: `D${String(i).padStart(4, "0")}`,
    close: close(i),
    foreignNet: foreign(i),
  }));
}

test("computeMarketFlowCaution: 데이터 부족이면 null", () => {
  assert.equal(computeMarketFlowCaution(flowDays(MARKET_FLOW_MIN_DAYS - 1, () => 0, () => 100)), null);
});

test("computeMarketFlowCaution: 신고가 부근 + 외국인 1년 최대 순매도면 켜지고 60일 유지", () => {
  const n = MARKET_FLOW_MIN_DAYS + 20;
  // 마지막 30일 대량 순매도, 지수는 계속 상승(신고가)
  const days = flowDays(n, (i) => (i >= n - 30 ? -1000 : noise(i)), (i) => 100 + i * 0.1);
  const r = computeMarketFlowCaution(days)!;
  assert.equal(r.activeToday, true);
  assert.equal(r.active, true);
  assert.equal(r.foreign60Rank, 0);

  // 이후 지수가 고점에서 10% 빠지면 오늘 조건은 꺼지지만 경고는 유지
  const later = flowDays(n + 10, (i) => (i >= n - 30 && i < n ? -1000 : noise(i)), (i) => (i < n ? 100 + i * 0.1 : (100 + n * 0.1) * 0.88));
  const r2 = computeMarketFlowCaution(later)!;
  assert.equal(r2.activeToday, false);
  assert.equal(r2.active, true);
  assert.ok(r2.lastSignalDate);
});

test("computeMarketFlowCaution: 외국인이 사는 중이거나 지수가 고점에서 멀면 꺼짐", () => {
  const n = MARKET_FLOW_MIN_DAYS + 70;
  // 경고 유지 60일 + 합산 60일을 모두 덮도록 130일 순매수
  const buying = computeMarketFlowCaution(flowDays(n, (i) => (i >= n - 130 ? 1000 : noise(i)), (i) => 100 + i * 0.1))!;
  assert.equal(buying.active, false);
  const falling = computeMarketFlowCaution(flowDays(n, (i) => (i >= n - 30 ? -1000 : noise(i)), (i) => (i < n - 100 ? 200 : 150)))!;
  assert.equal(falling.activeToday, false);
});

test("parseInvestorTrend: 네이버 모바일 수급 응답(최신 먼저)을 날짜·주식 수로 바꾼다", async () => {
  const { parseInvestorTrend } = await import("../src/lib/naverInvestorTrend");
  const rows = parseInvestorTrend([
    { bizdate: "20261002", foreignerPureBuyQuant: "-350,942", organPureBuyQuant: "+614,278" },
    { bizdate: "bad" },
  ]);
  assert.deepEqual(rows, [{ date: "2026-10-02", foreignNet: -350942, instNet: 614278 }]);
  assert.deepEqual(parseInvestorTrend({}), []);
});
