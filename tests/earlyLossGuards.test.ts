import test from "node:test";
import assert from "node:assert/strict";
import { intradayGainFromQuote, isIntradayChase } from "../src/services/chaseEntrySignal";
import {
  evaluateQuarterLossGuard,
  QUARTER_STOCK_LOSS_LIMIT_PCT,
  resolveKstQuarterStart,
} from "../src/services/virtualAutoTradeQuarterLossGuard";
import { resolveAutoTradeSkipReasonCode } from "../src/services/virtualAutoTradeObservability";

test("당일 추격: 전일 대비 +8% 이상이면 막고, 그 아래·모르는 경우는 막지 않는다", () => {
  // 전일 10,000 → 10,800 (+8.0%)
  const at8 = intradayGainFromQuote(10_800, 800);
  assert.ok(at8 != null && Math.abs(at8 - 0.08) < 1e-12);
  assert.equal(isIntradayChase(at8), true);
  assert.equal(isIntradayChase(intradayGainFromQuote(10_790, 790)), false);
  assert.equal(isIntradayChase(intradayGainFromQuote(9_000, -1_000)), false);
  assert.equal(intradayGainFromQuote(10_000, Number.NaN), null);
  assert.equal(intradayGainFromQuote(0, 0), null);
  assert.equal(intradayGainFromQuote(100, 100), null);
  assert.equal(isIntradayChase(null), false);
});

test("분기 시작: KST 기준 달력 분기", () => {
  // 2026-10-13 10:00 KST
  assert.deepEqual(resolveKstQuarterStart(new Date("2026-10-13T01:00:00Z")), {
    startIso: "2026-09-30T15:00:00.000Z",
    startDate: "2026-10-01",
  });
  // UTC로는 9/30이지만 KST로는 10/1 00:30 → 4분기
  assert.equal(resolveKstQuarterStart(new Date("2026-09-30T15:30:00Z")).startDate, "2026-10-01");
  // KST 9/30 23:59 → 3분기
  assert.equal(resolveKstQuarterStart(new Date("2026-09-30T14:59:00Z")).startDate, "2026-07-01");
  assert.equal(resolveKstQuarterStart(new Date("2026-02-15T00:00:00Z")).startDate, "2026-01-01");
});

test("분기 손실 한도: 확정+평가 손익이 개별주 몫의 −15%에 닿으면 막는다", () => {
  const base = { seedCapital: 10_000_000, capPct: 10, quarterStart: "2026-10-01" };
  // 몫 100만원, −15만원 = −15% → 막음
  const hit = evaluateQuarterLossGuard({ ...base, realizedPnl: -100_000, unrealizedPnl: -50_000 });
  assert.equal(hit.sleeveAmount, 1_000_000);
  assert.equal(hit.pnlPct, QUARTER_STOCK_LOSS_LIMIT_PCT);
  assert.equal(hit.blocked, true);
  // 평가손익이 회복되면 다시 열린다
  assert.equal(evaluateQuarterLossGuard({ ...base, realizedPnl: -100_000, unrealizedPnl: -49_000 }).blocked, false);
  // 실험 계좌(몫 100%)는 시드 전체 기준
  const experiment = evaluateQuarterLossGuard({ ...base, capPct: 100, realizedPnl: -150_000, unrealizedPnl: 0 });
  assert.equal(experiment.pnlPct, -1.5);
  assert.equal(experiment.blocked, false);
  // 시드가 없으면 판단하지 않는다
  assert.equal(evaluateQuarterLossGuard({ ...base, seedCapital: 0, realizedPnl: -1, unrealizedPnl: 0 }).blocked, false);
});

test("관측 집계: 새 보류 사유를 분류한다", () => {
  assert.equal(resolveAutoTradeSkipReasonCode("intraday-chase"), "intraday_chase");
  assert.equal(resolveAutoTradeSkipReasonCode("add-on-intraday-chase"), "intraday_chase");
  assert.equal(resolveAutoTradeSkipReasonCode("rebalance-intraday-chase"), "intraday_chase");
  assert.equal(resolveAutoTradeSkipReasonCode("quarter-stock-loss-limit"), "quarter_stock_loss_limit");
  assert.equal(
    resolveAutoTradeSkipReasonCode("개별주 신규·추가 매수 중단: 이번 분기(2026-10-01~) 개별주 손익 -150,000원"),
    "quarter_stock_loss_limit"
  );
});
