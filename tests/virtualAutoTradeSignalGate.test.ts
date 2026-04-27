import test from "node:test";
import assert from "node:assert/strict";
import {
  detectTrendBreakExitSignal,
  evaluateAutoTradeSignalGate,
} from "../src/services/virtualAutoTradeSignalGate";

test("evaluateAutoTradeSignalGate: 세력선 상단 + 거래량/모멘텀 양호면 통과", () => {
  const result = evaluateAutoTradeSignalGate({
    currentPrice: 10500,
    score: 78,
    factors: {
      sma200: 9800,
      sma50: 10100,
      rsi14: 58,
      avwap_support: 75,
      vol_ratio: 1.6,
      macd_cross: "golden",
    },
  });

  assert.equal(result.passed, true);
  assert.equal(result.grade, "A");
  assert.ok(result.trustScore >= 80);
});

test("evaluateAutoTradeSignalGate: 장기 세력선 이탈이면 차단", () => {
  const result = evaluateAutoTradeSignalGate({
    currentPrice: 9400,
    score: 82,
    factors: {
      sma200: 9800,
      sma50: 9700,
      rsi14: 54,
      avwap_support: 68,
      vol_ratio: 1.3,
      macd_cross: "golden",
    },
  });

  assert.equal(result.passed, false);
  assert.ok(result.reasons.some((reason) => reason.includes("sma200")));
});

test("evaluateAutoTradeSignalGate: MACD 데드크로스는 차단", () => {
  const result = evaluateAutoTradeSignalGate({
    currentPrice: 10300,
    score: 74,
    factors: {
      sma200: 9800,
      sma50: 10000,
      rsi14: 61,
      avwap_support: 70,
      vol_ratio: 1.4,
      macd_cross: "dead",
    },
  });

  assert.equal(result.passed, false);
  assert.equal(result.metrics.macdCross, "dead");
});

test("detectTrendBreakExitSignal: sma200 이탈은 즉시 손절 시그널", () => {
  const result = detectTrendBreakExitSignal({
    currentPrice: 9200,
    pnlPct: -1.2,
    factors: {
      sma200: 9800,
      sma50: 9600,
    },
  });

  assert.equal(result.exitAction, "STOP_LOSS");
  assert.equal(result.reason, "trend-break-sma200");
});

test("detectTrendBreakExitSignal: sma50 이탈 + 수익구간은 익절 시그널", () => {
  const result = detectTrendBreakExitSignal({
    currentPrice: 10100,
    pnlPct: 3.8,
    factors: {
      sma200: 9900,
      sma50: 10300,
    },
  });

  assert.equal(result.exitAction, "TAKE_PROFIT");
  assert.equal(result.reason, "trend-break-sma50");
});

test("detectTrendBreakExitSignal: SELL 신호는 손실 구간에서도 즉시 손절 시그널", () => {
  const result = detectTrendBreakExitSignal({
    currentPrice: 9800,
    pnlPct: -2.4,
    signal: "SELL",
    factors: {
      sma200: 9600,
      sma50: 9900,
    },
  });

  assert.equal(result.exitAction, "STOP_LOSS");
  assert.equal(result.reason, "signal-sell");
});

test("evaluateAutoTradeSignalGate: Stable bear-strong 턴이면 차단", () => {
  const result = evaluateAutoTradeSignalGate({
    currentPrice: 10100,
    score: 79,
    factors: {
      sma200: 9800,
      sma50: 9950,
      rsi14: 53,
      avwap_support: 66,
      vol_ratio: 1.2,
      macd_cross: "golden",
      stable_turn: "bear-strong",
      stable_turn_trust: 42,
      stable_above_avg: false,
    },
  });

  assert.equal(result.passed, false);
  assert.ok(result.reasons.some((reason) => reason.includes("Stable 턴")));
});
