import test from "node:test";
import assert from "node:assert/strict";
import {
  MIN_RELIABLE_SELLS,
  buildCohortReport,
  kstHour,
  seedBucketLabel,
  sellReturnPct,
  type CohortTrade,
  type CohortUser,
} from "../src/services/cohortAnalysis";

const sell = (chatId: number, pnl: number, cost: number, tradedAt = "2026-10-01T01:00:00Z"): CohortTrade => ({
  chatId, side: "SELL", pnlAmount: pnl, grossAmount: cost + pnl, tradedAt,
});
const user = (chatId: number, seedCapital: number, riskProfile: string | null = null, strategyMode: string | null = null): CohortUser => ({
  chatId, seedCapital, riskProfile, strategyMode,
});
const near = (actual: number | null, expected: number, digits = 5) => {
  assert.ok(actual !== null && Math.abs(actual - expected) < 10 ** -digits, `${actual} ≈ ${expected}`);
};

test("매도 수익률은 매수 원가 대비로 계산하고 원가를 모르면 제외한다", () => {
  near(sellReturnPct({ pnlAmount: 10_000, grossAmount: 110_000 }), 10);
  near(sellReturnPct({ pnlAmount: -5_000, grossAmount: 95_000 }), -5);
  assert.equal(sellReturnPct({ pnlAmount: null, grossAmount: 100_000 }), null);
  assert.equal(sellReturnPct({ pnlAmount: 200_000, grossAmount: 100_000 }), null);
});

test("UTC 시각을 한국시간 시로 바꾼다", () => {
  assert.equal(kstHour("2026-10-01T00:30:00Z"), 9);
  assert.equal(kstHour("2026-10-01T15:00:00Z"), 0);
  assert.equal(kstHour("not-a-date"), null);
});

test("시드를 구간으로 나눈다", () => {
  assert.equal(seedBucketLabel(0), "시드 미설정");
  assert.equal(seedBucketLabel(1_000_000), "300만원 미만");
  assert.equal(seedBucketLabel(5_000_000), "300만~1천만원");
  assert.equal(seedBucketLabel(50_000_000), "3천만원 이상");
});

test("조건별로 묶고 표본이 적으면 참고 불가로 표시한다", () => {
  const report = buildCohortReport({
    windowDays: 90,
    users: [user(1, 1_000_000, "active"), user(2, 20_000_000, "safe")],
    trades: [sell(1, 10_000, 100_000), sell(1, -5_000, 100_000), sell(2, 3_000, 100_000)],
  });
  assert.equal(report.overall.sells, 3);
  assert.deepEqual(report.bySeed.map((g) => g.label), ["300만원 미만", "1천만~3천만원"]);
  assert.equal(report.byRiskProfile.find((g) => g.label === "active")?.sells, 2);
  assert.ok(report.bySeed.every((g) => g.reliable === false));
  assert.deepEqual(report.users.map((u) => u.chatId), [1, 2]);
  near(report.users.find((u) => u.chatId === 1)?.returnOnSeedPct ?? null, 0.5);
});

test("표본이 충분하고 평균이 오차보다 크면 참고 가능으로 표시한다", () => {
  const trades: CohortTrade[] = [];
  for (let i = 0; i < MIN_RELIABLE_SELLS + 5; i += 1) trades.push(sell(1, 5_000 + (i % 3) * 100, 100_000));
  const report = buildCohortReport({ windowDays: 90, users: [user(1, 5_000_000)], trades });
  assert.equal(report.bySeed[0].reliable, true);
  assert.ok((report.bySeed[0].avgReturnPct ?? 0) > 4);
});

test("시간대는 한국시간 시 단위로 모은다", () => {
  const report = buildCohortReport({
    windowDays: 30,
    users: [user(1, 1_000_000)],
    trades: [sell(1, 1_000, 100_000, "2026-10-01T00:10:00Z"), sell(1, -1_000, 100_000, "2026-10-01T06:20:00Z")],
  });
  assert.deepEqual(report.bySellHour.map((g) => g.label), ["09시", "15시"]);
});

test("알 수 없는 사용자의 거래와 매수 거래는 무시한다", () => {
  const report = buildCohortReport({
    windowDays: 30,
    users: [user(1, 1_000_000)],
    trades: [sell(9, 1_000, 100_000), { chatId: 1, side: "BUY", pnlAmount: null, grossAmount: 100_000, tradedAt: "2026-10-01T01:00:00Z" }],
  });
  assert.equal(report.overall.sells, 0);
  assert.deepEqual(report.users, []);
});
