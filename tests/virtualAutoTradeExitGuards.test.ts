import test from "node:test";
import assert from "node:assert/strict";
import {
  countConsecutiveStaleGuardDays,
  detectAutoTradeMarketPolicy,
  enforceMinRewardRisk,
  resolveGuardFallbackHardStop,
  resolveProfileStopCapPct,
  resolveProfitLockTrailingStop,
  resolveVolatilityAdjustedStopPct,
} from "../src/services/virtualAutoTradeSelection";

test("countConsecutiveStaleGuardDays: 오늘 포함 연속 스킵 영업일을 센다 (주말 공백 허용)", () => {
  // 금(09-18) → 월(09-21) → 화(09-22) → 오늘 수(09-23)
  assert.equal(
    countConsecutiveStaleGuardDays(["2026-09-18", "2026-09-21", "2026-09-21", "2026-09-22"], "2026-09-23"),
    4
  );
  // 스킵 기록 사이 공백이 4일을 넘으면 끊긴 것으로 본다
  assert.equal(countConsecutiveStaleGuardDays(["2026-09-10", "2026-09-22"], "2026-09-23"), 2);
  assert.equal(countConsecutiveStaleGuardDays([], "2026-09-23"), 1);
});

test("resolveGuardFallbackHardStop: 실시간가 우선, stale-date면 마지막 종가, frozen-close 종가는 불신", () => {
  const realtime = resolveGuardFallbackHardStop({
    freshnessReason: "no-data",
    realtimePrice: 291_500,
    lastHistoryClose: null,
    buyPrice: 344_500,
    catastrophicStopPct: 10,
  });
  assert.equal(realtime.triggered, true);
  assert.equal(realtime.source, "realtime");

  const lastClose = resolveGuardFallbackHardStop({
    freshnessReason: "stale-date",
    realtimePrice: null,
    lastHistoryClose: 300_000,
    buyPrice: 344_500,
    catastrophicStopPct: 10,
  });
  assert.equal(lastClose.triggered, true);
  assert.equal(lastClose.source, "last-close");

  const frozen = resolveGuardFallbackHardStop({
    freshnessReason: "frozen-close",
    realtimePrice: null,
    lastHistoryClose: 300_000,
    buyPrice: 344_500,
    catastrophicStopPct: 10,
  });
  assert.equal(frozen.triggered, false);
  assert.equal(frozen.price, null);

  const withinRange = resolveGuardFallbackHardStop({
    freshnessReason: "no-data",
    realtimePrice: 330_000,
    lastHistoryClose: null,
    buyPrice: 344_500,
    catastrophicStopPct: 10,
  });
  assert.equal(withinRange.triggered, false);
});

test("resolveProfileStopCapPct / resolveVolatilityAdjustedStopPct: ATR 확장이 프로필 손절 의도를 넘지 않는다", () => {
  assert.equal(resolveProfileStopCapPct(2), 5);
  assert.equal(resolveProfileStopCapPct(3), 7.5);
  assert.equal(resolveProfileStopCapPct(4), 10);
  assert.equal(resolveProfileStopCapPct(12), 12);
  // 타이트 손절(2%) + 고변동(ATR 5%) → 예전엔 11%, 이제 5%에서 멈춘다
  assert.equal(
    resolveVolatilityAdjustedStopPct({ baseStopLossPct: 2, atrPct: 5, maxStopPct: resolveProfileStopCapPct(2) }),
    5
  );
  // cap 미지정 시 기존 동작(상한 12%) 유지
  assert.equal(resolveVolatilityAdjustedStopPct({ baseStopLossPct: 3, atrPct: 5 }), 11);
});

test("enforceMinRewardRisk: 익절폭이 손절폭의 1.5배 이상이 되도록 보정한다", () => {
  assert.deepEqual(enforceMinRewardRisk({ takeProfitPct: 13.5, stopLossPct: 10 }), {
    takeProfitPct: 15,
    stopLossPct: 10,
  });
  // 익절 상한(18%)에 막히면 손절을 좁힌다
  assert.deepEqual(enforceMinRewardRisk({ takeProfitPct: 13.5, stopLossPct: 12 }), {
    takeProfitPct: 18,
    stopLossPct: 12,
  });
  assert.deepEqual(enforceMinRewardRisk({ takeProfitPct: 14, stopLossPct: 12, maxTakeProfitPct: 15 }), {
    takeProfitPct: 15,
    stopLossPct: 10,
  });
  // 이미 충분하면 그대로
  assert.deepEqual(enforceMinRewardRisk({ takeProfitPct: 8, stopLossPct: 4 }), {
    takeProfitPct: 8,
    stopLossPct: 4,
  });
});

test("resolveProfitLockTrailingStop: 고점 수익의 일정 비율 아래로 밀리면 청산", () => {
  // 고점 +7%: 아직 미활성
  assert.equal(resolveProfitLockTrailingStop({ buyPrice: 100, peakPrice: 107, currentPrice: 101 }).armed, false);
  // 고점 +10% → 40% 잠금(+4%). 현재 +5%면 유지, +4%면 청산
  assert.equal(resolveProfitLockTrailingStop({ buyPrice: 100, peakPrice: 110, currentPrice: 105 }).breached, false);
  assert.equal(resolveProfitLockTrailingStop({ buyPrice: 100, peakPrice: 110, currentPrice: 104 }).breached, true);
  // 고점 +30% → 65% 잠금(+19.5%)
  const big = resolveProfitLockTrailingStop({ buyPrice: 100, peakPrice: 130, currentPrice: 119 });
  assert.equal(big.lockedGainPct, 19.5);
  assert.equal(big.breached, true);
  // 현재가가 기록된 고점보다 높으면 현재가가 고점
  assert.equal(resolveProfitLockTrailingStop({ buyPrice: 100, peakPrice: 105, currentPrice: 112 }).breached, false);
});

test("detectAutoTradeMarketPolicy: 중립 구간 최소현금 20%", () => {
  const policy = detectAutoTradeMarketPolicy({ overview: null });
  assert.equal(policy.label, "균형");
  assert.equal(policy.minCashReservePct, 20);
});
