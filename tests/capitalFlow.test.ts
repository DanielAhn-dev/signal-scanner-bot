import test from "node:test";
import assert from "node:assert/strict";
import { chainedReturn, isCapitalFlow } from "../src/services/goalTracker";
import { simulateBotAccount } from "../src/services/strategyForwardTest";

test("isCapitalFlow: 주간 시드 재계산(새 시드 = 이전 시드 + 누적 확정 손익)은 입출금이 아니다", () => {
  const prev = { date: "2026-10-02", seed: 20_000_000, total: 20_600_000, realized: 500_000 };
  const rebased = { date: "2026-10-05", seed: 20_500_000, total: 20_800_000, realized: 0 };
  assert.equal(isCapitalFlow(prev, rebased), false);
  const deposit = { date: "2026-10-05", seed: 30_000_000, total: 30_700_000, realized: 500_000 };
  assert.equal(isCapitalFlow(prev, deposit), true);
  // 누적 손익 기록이 없는 옛 기록은 시드 변경을 입출금으로 본다(예전 동작)
  assert.equal(isCapitalFlow({ date: "a", seed: 1, total: 1 }, { date: "b", seed: 2, total: 2 }), true);
});

test("chainedReturn·simulateBotAccount: 재계산일 수익은 세고, 입금일 수익만 뺀다", () => {
  const points = [
    { date: "2026-10-01", seed: 20_000_000, total: 20_000_000, realized: 0 },
    { date: "2026-10-02", seed: 20_000_000, total: 20_400_000, realized: 400_000 }, // +2%
    { date: "2026-10-05", seed: 20_400_000, total: 20_604_000, realized: 0 }, // 재계산일 +1%
    { date: "2026-10-06", seed: 30_400_000, total: 30_604_000, realized: 0 }, // 1천만 입금 — 제외
  ];
  const r = chainedReturn(points);
  assert.ok(r != null && Math.abs(r - (1.02 * 1.01 - 1)) < 1e-9, String(r));
  const bot = simulateBotAccount({ startDate: "2026-10-01", points });
  assert.ok(bot && Math.abs(bot.totalReturnPct - (1.02 * 1.01 - 1) * 100) < 1e-6);
});
