import test from "node:test";
import assert from "node:assert/strict";
import {
  STALE_PRICE_GUARD_MS,
  buildHoldingQuoteMaps,
  evaluateQuoteStaleness,
  resolveReviewCash,
} from "../src/services/virtualAutoTradeDailyContext";

const stockHolding = { quantity: 10, buy_price: 50_000, invested_amount: 500_000 };
const sweepHolding = { quantity: 50, buy_price: 40_000, invested_amount: 2_000_000 };

test("resolveReviewCash: 저장된 현금이 있으면 그대로 쓴다", () => {
  const cash = resolveReviewCash({
    storedCash: 1_200_000,
    seedCapital: 10_000_000,
    realizedPnl: 0,
    holdings: [stockHolding],
    simulatedSweepReleaseCash: 0,
  });
  assert.deepEqual(cash, { availableCash: 1_200_000, corrected: false });
});

test("resolveReviewCash: 저장된 현금이 0이면 시드+실현손익−보유투자금으로 보정하고, 스윕 보유분도 투자금에 넣는다", () => {
  const cash = resolveReviewCash({
    storedCash: 0,
    seedCapital: 10_000_000,
    realizedPnl: 100_000,
    holdings: [stockHolding, sweepHolding],
    simulatedSweepReleaseCash: 0,
  });
  // 1,010만 − 50만 − 200만 = 760만 (예전엔 스윕 200만을 빼지 않아 960만으로 잡혔다)
  assert.deepEqual(cash, { availableCash: 7_600_000, corrected: true });
});

test("resolveReviewCash: 수동 학습의 스윕 현금화 예정액은 보정 뒤에도 더해진다", () => {
  const cash = resolveReviewCash({
    storedCash: 0,
    seedCapital: 10_000_000,
    realizedPnl: 0,
    holdings: [stockHolding],
    simulatedSweepReleaseCash: 300_000,
  });
  assert.equal(cash.availableCash, 9_500_000 + 300_000);
});

test("resolveReviewCash: 투자금 기록이 없으면 수량×매수가로 계산한다", () => {
  const cash = resolveReviewCash({
    storedCash: null,
    seedCapital: 1_000_000,
    realizedPnl: 0,
    holdings: [{ quantity: 4, buy_price: 100_000, invested_amount: null }],
    simulatedSweepReleaseCash: 0,
  });
  assert.equal(cash.availableCash, 600_000);
});

test("buildHoldingQuoteMaps: 종가 0인 종목은 종가 맵에서 빼고 나머지 정보는 남긴다", () => {
  const maps = buildHoldingQuoteMaps([
    { code: "005930", name: "삼성전자", close: 70_000, market: "KOSPI", sector_id: "semis", is_sector_leader: true },
    { code: "000660", name: "SK하이닉스", close: 0, market: "KOSPI", sector_id: "semis", is_sector_leader: false },
  ]);
  assert.equal(maps.closeByCode.get("005930"), 70_000);
  assert.equal(maps.closeByCode.has("000660"), false);
  assert.equal(maps.nameByCode.get("000660"), "SK하이닉스");
  assert.equal(maps.isSectorLeaderByCode.get("005930"), true);
  assert.equal(maps.sectorIdByCode.get("000660"), "semis");
});

test("evaluateQuoteStaleness: 보유가 있고 최신화가 3일을 넘으면 멈춘다", () => {
  const now = Date.parse("2026-10-01T06:00:00Z");
  const fresh = [{ updated_at: new Date(now - 60_000).toISOString() }];
  const old = [{ updated_at: new Date(now - STALE_PRICE_GUARD_MS - 86_400_000).toISOString() }];
  assert.deepEqual(evaluateQuoteStaleness({ rows: fresh, hasHoldings: true, now }), { stale: false });
  const stale = evaluateQuoteStaleness({ rows: old, hasHoldings: true, now });
  assert.equal(stale.stale, true);
  assert.equal(stale.stale && stale.staleDays, 4);
  assert.deepEqual(evaluateQuoteStaleness({ rows: old, hasHoldings: false, now }), { stale: false });
  assert.equal(evaluateQuoteStaleness({ rows: [], hasHoldings: true, now }).stale, true);
});
