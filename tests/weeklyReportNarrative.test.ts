import assert from "node:assert/strict";
import test from "node:test";
import { buildTopicClosingSummary } from "../src/services/weeklyReportNarrative";

test("buildTopicClosingSummary: flow 결론은 복수 문장으로 수급 축과 액션을 함께 준다", () => {
  const summary = buildTopicClosingSummary({
    topic: "flow",
    curr: { buyCount: 3, sellCount: 1, tradeCount: 4, realizedPnl: 120000, winRate: 75 },
    prev: { buyCount: 2, sellCount: 2, tradeCount: 4, realizedPnl: 80000, winRate: 50 },
    totalUnrealized: 0,
    totalUnrealizedPct: 0,
    watchItems: [],
    sectors: [
      { name: "코스피 200 TOP 10", score: 84, change_rate: 2.8, metrics: { flow_foreign_5d: 1800000000, flow_inst_5d: 700000000 } },
      { name: "전기전자", score: 81, change_rate: 2.1, metrics: { flow_foreign_5d: 900000000, flow_inst_5d: 300000000 } },
      { name: "운송장비·부품", score: 76, change_rate: 1.4, metrics: { flow_foreign_5d: -250000000, flow_inst_5d: 500000000 } },
    ],
    market: {} as any,
  });

  assert.match(summary, /코스피 200 TOP 10|전기전자|운송장비·부품/);
  assert.ok(summary.split(".").filter((line) => line.trim().length > 0).length >= 2);
});

test("buildTopicClosingSummary: sector 결론은 리더 섹터와 실행 포인트를 함께 준다", () => {
  const summary = buildTopicClosingSummary({
    topic: "sector",
    curr: { buyCount: 1, sellCount: 1, tradeCount: 2, realizedPnl: 50000, winRate: 50 },
    prev: { buyCount: 1, sellCount: 2, tradeCount: 3, realizedPnl: 30000, winRate: 33.3 },
    totalUnrealized: 0,
    totalUnrealizedPct: 0,
    watchItems: [],
    sectors: [
      { name: "코스피 200 비중상한 20%", score: 92, change_rate: 3.2, metrics: { flow_foreign_5d: 1200000000, flow_inst_5d: 600000000 } },
      { name: "코스닥 150 헬스케어", score: 83, change_rate: 2.4, metrics: { flow_foreign_5d: 300000000, flow_inst_5d: 200000000 } },
      { name: "코스닥 150 정보기술", score: 80, change_rate: 1.8, metrics: { flow_foreign_5d: 250000000, flow_inst_5d: 100000000 } },
    ],
    market: {} as any,
  });

  assert.match(summary, /코스피 200 비중상한 20%|코스닥 150 헬스케어|코스닥 150 정보기술/);
  assert.ok(summary.split(".").filter((line) => line.trim().length > 0).length >= 2);
});