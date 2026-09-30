import test from "node:test";
import assert from "node:assert/strict";
import { AUTO_TRADE_STRATEGY_ID, buildStrategyMemo } from "../src/lib/strategyMemo";
import { INDEX_HOLD_STRATEGY_ID, LEGACY_INDEX_LEVERAGE_STRATEGY_ID } from "../src/services/indexHoldStrategy";
import { createIndexHoldSteps, type IndexHoldRow } from "../src/services/virtualAutoTradeIndexHoldStep";
import { createHarness } from "./helpers/cashSweepHarness";

const CHAT_ID = 1;
const memoOf = (strategyId: string) => buildStrategyMemo({ strategyId, event: "buy" });

function createIndexHarness(options: Parameters<typeof createHarness>[0] & { failStockBotSell?: boolean }) {
  const h = createHarness(options);
  const stockBotSells: Array<{ code: string; qty: number }> = [];
  const actionLogs: unknown[] = [];
  const steps = createIndexHoldSteps({
    getPrefs: h.deps.getPrefs,
    overlayIntradayPrices: h.deps.overlayIntradayPrices,
    fetchHoldings: async () => ({ data: (options.positions ?? []) as IndexHoldRow[], error: null }),
    sellStockBotHolding: async (input) => {
      if (options.failStockBotSell) throw new Error("sell failed");
      stockBotSells.push({ code: input.holding.code, qty: input.qty });
      return { sold: true, note: "sold" };
    },
    sellSweepPosition: h.steps.sellSweepPosition,
    commitEtfTrade: h.steps.commitEtfTrade,
    writeActionLog: async (log) => {
      actionLogs.push(log);
    },
  });
  const run = () => steps.runIndexHoldForUser({ supabase: h.supabase, setting: { chat_id: CHAT_ID }, runId: 1, dryRun: false });
  const release = () => steps.releaseIndexModeHoldings({ supabase: h.supabase, chatId: CHAT_ID, dryRun: false });
  return { ...h, stockBotSells, actionLogs, run, release };
}

const kodex200 = { code: "069500", name: "KODEX 200", close: 40_000 };

test("runIndexHoldForUser: 현금으로 KODEX 200을 사면 현금·포지션·거래기록·실행기록이 모두 반영된다", async () => {
  const h = createIndexHarness({ prefs: { virtual_cash: 1_000_000 }, stocks: [kodex200] });
  const summary = await h.run();

  // 100만 / 1.005 / 4만 → 24주, 매수액 96만 + 수수료 144원
  assert.equal(summary.buys, 1);
  assert.equal(h.prefs.virtual_cash, 1_000_000 - 960_000 - 144);
  assert.deepEqual(h.writes.map((w) => w.op), ["insert"]);
  assert.equal((h.writes[0].values as Record<string, unknown>).invested_amount, 960_144);
  assert.equal(h.tradeLogs.length, 1);
  assert.equal(h.actionLogs.length, 1);
});

test("runIndexHoldForUser: 포지션 생성이 실패하면 현금을 되돌리고 오류로 센다", async () => {
  const h = createIndexHarness({ prefs: { virtual_cash: 1_000_000 }, stocks: [kodex200], failPositionWrite: true });
  const summary = await h.run();

  assert.equal(summary.buys, 0);
  assert.equal(summary.errors, 1);
  assert.equal(h.prefs.virtual_cash, 1_000_000);
  assert.equal(h.tradeLogs.length, 0);
  assert.equal(h.actionLogs.length, 0);
});

test("runIndexHoldForUser: 거래기록만 실패해도 현금은 차감된다 (예전엔 포지션만 생기고 현금이 그대로여서 돈이 불어났다)", async () => {
  const h = createIndexHarness({ prefs: { virtual_cash: 1_000_000 }, stocks: [kodex200], failTradeLog: true });
  const summary = await h.run();

  assert.equal(summary.buys, 1);
  assert.equal(h.prefs.virtual_cash, 1_000_000 - 960_000 - 144);
  assert.deepEqual(h.writes.map((w) => w.op), ["insert"]);
});

test("runIndexHoldForUser: 예전 레버리지 ETF는 팔고 그 대금으로 KODEX 200을 산다", async () => {
  const h = createIndexHarness({
    prefs: { virtual_cash: 0 },
    stocks: [kodex200, { code: "122630", name: "KODEX 레버리지", close: 20_000 }],
    positions: [
      { id: 5, code: "122630", buy_price: 20_000, quantity: 50, invested_amount: 1_000_000, memo: memoOf(LEGACY_INDEX_LEVERAGE_STRATEGY_ID) },
    ],
  });
  const summary = await h.run();

  assert.equal(summary.sells, 1);
  assert.equal(summary.buys, 1);
  assert.deepEqual(h.writes.map((w) => w.op), ["delete", "insert"]);
  assert.deepEqual(h.tradeLogs.map((log) => log.side), ["SELL", "BUY"]);
});

test("runIndexHoldForUser: 종목 봇 보유분은 일반 매도 경로로 정리한다", async () => {
  const h = createIndexHarness({
    prefs: { virtual_cash: 0 },
    stocks: [kodex200, { code: "005930", name: "삼성전자", close: 70_000 }],
    positions: [{ id: 9, code: "005930", buy_price: 60_000, quantity: 3, invested_amount: 180_000, memo: memoOf(AUTO_TRADE_STRATEGY_ID) }],
  });
  const summary = await h.run();

  assert.deepEqual(h.stockBotSells, [{ code: "005930", qty: 3 }]);
  assert.equal(summary.sells, 1);
});

test("releaseIndexModeHoldings: 한 종목이 실패해도 나머지를 처리하고, 실패를 성공으로 알리지 않는다", async () => {
  const h = createIndexHarness({
    prefs: { virtual_cash: 0 },
    stocks: [kodex200, { code: "122630", name: "KODEX 레버리지", close: 20_000 }],
    positions: [
      { id: 5, code: "122630", quantity: 50, invested_amount: 1_000_000, memo: memoOf(LEGACY_INDEX_LEVERAGE_STRATEGY_ID) },
      { id: 6, code: "069500", quantity: 10, invested_amount: 400_000, memo: memoOf(INDEX_HOLD_STRATEGY_ID) },
    ],
    failPositionWrite: true,
  });
  const { notes } = await h.release();

  assert.equal(notes.length, 2);
  assert.match(notes[0], /KODEX 레버리지 매도 실패/);
  assert.match(notes[1], /KODEX 200 스윕으로 넘기기 실패/);
  assert.equal(h.prefs.virtual_cash, 0);
});

test("releaseIndexModeHoldings: 정상이면 레버리지는 팔고 KODEX 200은 스윕으로 넘긴다", async () => {
  const h = createIndexHarness({
    prefs: { virtual_cash: 0 },
    stocks: [kodex200, { code: "122630", name: "KODEX 레버리지", close: 20_000 }],
    positions: [
      { id: 5, code: "122630", quantity: 50, invested_amount: 1_000_000, memo: memoOf(LEGACY_INDEX_LEVERAGE_STRATEGY_ID) },
      { id: 6, code: "069500", quantity: 10, invested_amount: 400_000, memo: memoOf(INDEX_HOLD_STRATEGY_ID) },
    ],
  });
  const { notes } = await h.release();

  assert.deepEqual(h.writes.map((w) => w.op), ["delete", "update"]);
  assert.match(notes[1], /유휴현금 스윕으로 넘김/);
  assert.ok(Number(h.prefs.virtual_cash) > 0);
});
