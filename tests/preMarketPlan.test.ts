import test from "node:test";
import assert from "node:assert/strict";
import { derivePreMarketAdaptiveProfile } from "../src/bot/commands/preMarketPlanAdaptive";

test("derivePreMarketAdaptiveProfile: 최근 손익 부진이면 보수강화로 전환한다", () => {
  const profile = derivePreMarketAdaptiveProfile({
    seedCapital: 20_000_000,
    metrics: {
      windowDays: 14,
      realizedPnl: -250_000,
      sellCount: 3,
      winningSellCount: 1,
      winRate: 33.3,
      buyActions: 2,
      skipActions: 4,
      topSkipReasons: [{ reason: "no-candidates", count: 3 }],
    },
  });

  assert.equal(profile.stance, "defensive");
  assert.equal(profile.scoreAdjustment, 2);
  assert.equal(profile.maxOrders, 1);
});

test("derivePreMarketAdaptiveProfile: 최근 성과 우위면 확장 모드로 전환한다", () => {
  const profile = derivePreMarketAdaptiveProfile({
    seedCapital: 20_000_000,
    metrics: {
      windowDays: 14,
      realizedPnl: 420_000,
      sellCount: 4,
      winningSellCount: 3,
      winRate: 75,
      buyActions: 4,
      skipActions: 2,
      topSkipReasons: [{ reason: "cash-reserve-floor", count: 1 }],
    },
  });

  assert.equal(profile.stance, "press-winner");
  assert.equal(profile.scoreAdjustment, -2);
  assert.equal(profile.maxOrders, 3);
});

test("derivePreMarketAdaptiveProfile: 후보 부족이 반복되면 점수 기준을 소폭 완화한다", () => {
  const profile = derivePreMarketAdaptiveProfile({
    seedCapital: 10_000_000,
    metrics: {
      windowDays: 14,
      realizedPnl: 0,
      sellCount: 0,
      winningSellCount: 0,
      winRate: null,
      buyActions: 1,
      skipActions: 8,
      topSkipReasons: [{ reason: "no-candidates", count: 6 }],
    },
  });

  assert.equal(profile.stance, "opportunity");
  assert.equal(profile.scoreAdjustment, -1);
  assert.equal(profile.maxOrders, 2);
});