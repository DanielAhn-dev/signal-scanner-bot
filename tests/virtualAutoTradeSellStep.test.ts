import test from "node:test";
import assert from "node:assert/strict";
import { createAutoTradeSellStep, type HoldingRow } from "../src/services/virtualAutoTradeSellStep";
import { createHarness } from "./helpers/cashSweepHarness";

// 종목 매도는 실현손익(prefs)·포지션·거래기록·FIFO 로트를 따로 쓴다. 현금은 실행 끝에
// "시드 + 실현손익 − 보유 투자금"으로 다시 계산되므로, 포지션과 실현손익이 함께 움직여야 원장이 맞는다.

const CHAT_ID = 1;

function createSellHarness(options: {
  realizedPnl?: number;
  failPositionWrite?: boolean;
  failSetPrefsCall?: number;
  failTradeLog?: boolean;
  failApplyFifo?: boolean;
  duplicate?: boolean;
}) {
  const h = createHarness({
    prefs: { virtual_cash: 0, virtual_realized_pnl: options.realizedPnl ?? 0 },
    failPositionWrite: options.failPositionWrite,
    failSetPrefsCall: options.failSetPrefsCall,
    failTradeLog: options.failTradeLog,
  });
  const calls = { applyFifo: [] as Array<{ tradeId?: number | null }>, replaceLots: 0, actionLogs: [] as string[] };
  const { executeAutoTradeSell } = createAutoTradeSellStep({
    getPrefs: h.deps.getPrefs,
    setPrefs: h.deps.setPrefs,
    appendTradeLog: async (log) => {
      await h.deps.appendTradeLog(log);
      return 42;
    },
    tryRegisterOperation: async () => !options.duplicate,
    writeActionLog: async (log) => {
      calls.actionLogs.push(String(log.reason));
    },
    appendVirtualDecisionLog: async () => ({ ok: true }),
    lots: {
      ensureTradeLotsForHolding: async () => [],
      previewFifoSale: async (input) => ({ allocations: [], totalCost: input.quantity * 50_000 }),
      replaceTradeLotsForHolding: async () => {
        calls.replaceLots += 1;
        return [];
      },
      applyFifoSale: async (input) => {
        if (options.failApplyFifo) throw new Error("lot failed");
        calls.applyFifo.push({ tradeId: input.tradeId });
      },
    },
  });
  return { ...h, calls, executeAutoTradeSell };
}

const holding: HoldingRow = {
  id: 9,
  code: "005930",
  buy_price: 50_000,
  quantity: 10,
  invested_amount: 500_000,
  memo: null,
};

const sellInput = (supabase: unknown, overrides: { sellQty?: number; dryRun?: boolean } = {}) => ({
  supabase,
  runId: 1,
  chatId: CHAT_ID,
  holding,
  close: 60_000,
  buyPrice: 50_000,
  feeRate: 0,
  taxRate: 0,
  sellQty: overrides.sellQty ?? 10,
  reason: "take-profit-final" as const,
  profileLabel: "스윙",
  strategyProfile: "SWING",
  takeProfitTranchesDone: 0,
  nextTakeProfitTranchesDone: 0,
  dryRun: overrides.dryRun ?? false,
});

test("executeAutoTradeSell: 전량 매도는 포지션 삭제와 함께 실현손익을 직접 반영한다", async () => {
  const h = createSellHarness({ realizedPnl: 1_000 });
  const result = await h.executeAutoTradeSell(sellInput(h.supabase));

  assert.equal(result.sold, true);
  assert.ok(result.realizedPnlDelta > 0);
  assert.equal(h.prefs.virtual_realized_pnl, 1_000 + Math.round(result.realizedPnlDelta));
  assert.deepEqual(h.writes.map((w) => w.op), ["delete"]);
  assert.equal(h.tradeLogs.length, 1);
  assert.deepEqual(h.calls.applyFifo, [{ tradeId: 42 }]);
});

test("executeAutoTradeSell: 부분 매도는 남은 수량·원금으로 포지션을 갱신한다", async () => {
  const h = createSellHarness({});
  const result = await h.executeAutoTradeSell(sellInput(h.supabase, { sellQty: 4 }));

  assert.equal(result.partial, true);
  const values = h.writes[0].values as Record<string, unknown>;
  assert.equal(h.writes[0].op, "update");
  assert.equal(values.quantity, 6);
  assert.equal(values.invested_amount, 300_000);
});

test("executeAutoTradeSell: 포지션 삭제가 실패하면 실현손익을 되돌리고 예외를 던진다", async () => {
  const h = createSellHarness({ realizedPnl: 1_000, failPositionWrite: true });
  await assert.rejects(h.executeAutoTradeSell(sellInput(h.supabase)));

  assert.equal(h.prefs.virtual_realized_pnl, 1_000);
  assert.equal(h.tradeLogs.length, 0);
});

test("executeAutoTradeSell: 실현손익 저장이 실패하면 포지션을 건드리지 않는다", async () => {
  const h = createSellHarness({ realizedPnl: 1_000, failSetPrefsCall: 1 });
  await assert.rejects(h.executeAutoTradeSell(sellInput(h.supabase)));

  assert.equal(h.writes.length, 0);
  assert.equal(h.prefs.virtual_realized_pnl, 1_000);
});

test("executeAutoTradeSell: 거래기록만 실패해도 매도는 성립하고 손익이 남는다 (예전엔 예외로 끝나 손익이 빠졌다)", async () => {
  const h = createSellHarness({ failTradeLog: true });
  const result = await h.executeAutoTradeSell(sellInput(h.supabase));

  assert.equal(result.sold, true);
  assert.equal(h.prefs.virtual_realized_pnl, Math.round(result.realizedPnlDelta));
  assert.deepEqual(h.calls.applyFifo, [{ tradeId: null }]);
});

test("executeAutoTradeSell: FIFO 로트 반영이 실패하면 로트를 다시 만들고 매도는 성립시킨다", async () => {
  const h = createSellHarness({ failApplyFifo: true });
  const result = await h.executeAutoTradeSell(sellInput(h.supabase));

  assert.equal(result.sold, true);
  assert.equal(h.calls.replaceLots, 1);
  assert.ok(Number(h.prefs.virtual_realized_pnl) > 0);
});

test("executeAutoTradeSell: dryRun은 매도안만 돌려주고 실현손익·포지션을 건드리지 않는다", async () => {
  const h = createSellHarness({ realizedPnl: 1_000 });
  const result = await h.executeAutoTradeSell(sellInput(h.supabase, { dryRun: true }));

  assert.equal(result.sold, true);
  assert.equal(h.prefs.virtual_realized_pnl, 1_000);
  assert.equal(h.writes.length, 0);
  assert.equal(h.tradeLogs.length, 0);
});

test("executeAutoTradeSell: 중복 실행이면 아무것도 바꾸지 않는다", async () => {
  const h = createSellHarness({ duplicate: true });
  const result = await h.executeAutoTradeSell(sellInput(h.supabase));

  assert.equal(result.sold, false);
  assert.equal(h.writes.length, 0);
  assert.deepEqual(h.calls.actionLogs, ["duplicate-execution"]);
});
