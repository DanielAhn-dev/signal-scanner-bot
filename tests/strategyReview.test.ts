import test from "node:test";
import assert from "node:assert/strict";
import { reviewStrategies, MIN_REVIEW_TRADING_DAYS, type StrategyResult, type StrategyName } from "../src/services/strategyForwardTest";

const r = (name: StrategyName, totalReturnPct: number, maxDrawdownPct: number): StrategyResult => ({
  name,
  label: name,
  totalReturnPct,
  maxDrawdownPct,
  periods: 1,
});

test("reviewStrategies: 8주 전에는 판정하지 않는다", () => {
  const out = reviewStrategies({ results: [r("gate-monthly", 50, -1)], measuredDays: MIN_REVIEW_TRADING_DAYS - 1 });
  assert.equal(out.status, "too-early");
  assert.deepEqual(out.candidates, []);
});

test("reviewStrategies: 봇·KODEX 200·CD를 모두 앞서고 낙폭이 봇 이하면 승격 후보", () => {
  const out = reviewStrategies({
    measuredDays: 45,
    results: [
      r("bot-account", 3, -8),
      r("kodex200-hold", 4, -12),
      r("cd-only", 0.4, 0),
      r("gate-monthly", 6, -7), // 후보
      r("momentum-top5", 9, -15), // 수익은 높지만 낙폭이 봇보다 나쁨 → 탈락
      r("index-core", 3.5, -5), // 봇·CD는 앞서지만 KODEX 200에 못 미침 → 탈락
    ],
  });
  assert.equal(out.status, "propose");
  assert.deepEqual(out.candidates, ["gate-monthly"]);
});

test("reviewStrategies: 봇이 KODEX 200과 CD 모두에 못 미치면 경고", () => {
  const out = reviewStrategies({
    measuredDays: 45,
    results: [r("bot-account", -2, -9), r("kodex200-hold", 1, -10), r("cd-only", 0.4, 0)],
  });
  assert.equal(out.status, "warn-bot");
});

test("reviewStrategies: 봇 계좌 데이터가 없으면 판정하지 않는다", () => {
  const out = reviewStrategies({ measuredDays: 45, results: [r("kodex200-hold", 1, -10), r("cd-only", 0.4, 0)] });
  assert.equal(out.status, "no-bot-data");
});
