import test from "node:test";
import assert from "node:assert/strict";
import { reviewStrategies, noiseBandPct, MIN_REVIEW_TRADING_DAYS, type StrategyResult, type StrategyName } from "../src/services/strategyForwardTest";

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

test("noiseBandPct: 2σ√n주 (추적오차 연 30%) — 40거래일 약 23.5%p, 기간이 길수록 넓어진다", () => {
  assert.ok(Math.abs(noiseBandPct(40) - 23.53) < 0.05);
  assert.ok(noiseBandPct(250) > noiseBandPct(120));
});

test("reviewStrategies: 봇·KODEX 200·CD를 모두 잡음 범위 이상 앞서고 낙폭이 봇 이하면 승격 후보", () => {
  // 45거래일 잡음 범위 ≈ 25.0%p
  const out = reviewStrategies({
    measuredDays: 45,
    results: [
      r("bot-account", 3, -8),
      r("kodex200-hold", 4, -12),
      r("cd-only", 0.4, 0),
      r("gate-monthly", 32, -7), // 후보
      r("momentum-top5", 40, -15), // 수익은 높지만 낙폭이 봇보다 나쁨 → 탈락
      r("index-core", 3.5, -5), // 봇·CD는 앞서지만 KODEX 200에 못 미침 → 탈락
      r("score-top5", 10, -6), // 앞섰지만 잡음 범위 안 → 참고만
    ],
  });
  assert.equal(out.status, "propose");
  assert.deepEqual(out.candidates, ["gate-monthly"]);
  assert.ok(out.lines.some((l) => l.includes("score-top5") && l.includes("잡음 범위")));
});

test("reviewStrategies: 잡음 범위 안에서만 앞선 전략은 후보가 아니다", () => {
  const out = reviewStrategies({
    measuredDays: 45,
    results: [r("bot-account", 3, -8), r("kodex200-hold", 4, -12), r("cd-only", 0.4, 0), r("gate-monthly", 20, -7)],
  });
  assert.equal(out.status, "hold");
  assert.deepEqual(out.candidates, []);
});

test("reviewStrategies: 봇이 KODEX 200과 CD 모두에 잡음 범위 이상 못 미치면 경고", () => {
  const out = reviewStrategies({
    measuredDays: 45,
    results: [r("bot-account", -30, -35), r("kodex200-hold", 1, -10), r("cd-only", 0.4, 0)],
  });
  assert.equal(out.status, "warn-bot");
});

test("reviewStrategies: 봇이 잡음 범위 안에서 뒤지면 경고 대신 참고", () => {
  const out = reviewStrategies({
    measuredDays: 45,
    results: [r("bot-account", -2, -9), r("kodex200-hold", 1, -10), r("cd-only", 0.4, 0)],
  });
  assert.equal(out.status, "hold");
  assert.ok(out.lines.some((l) => l.startsWith("참고: 봇")));
});

test("reviewStrategies: 봇 계좌 데이터가 없으면 판정하지 않는다", () => {
  const out = reviewStrategies({ measuredDays: 45, results: [r("kodex200-hold", 1, -10), r("cd-only", 0.4, 0)] });
  assert.equal(out.status, "no-bot-data");
});
