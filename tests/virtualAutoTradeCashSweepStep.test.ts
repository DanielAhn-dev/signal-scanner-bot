import test from "node:test";
import assert from "node:assert/strict";
import { buildStrategyMemo } from "../src/lib/strategyMemo";
import { CASH_SWEEP_STRATEGY_ID } from "../src/services/virtualAutoTradeCashSweep";
import {
  createCashSweepSteps,
  type CashSweepTradeLog,
  type SweepHolding,
} from "../src/services/virtualAutoTradeCashSweepStep";

// 스윕 매매는 현금(prefs)·포지션·거래기록을 따로 쓴다. DB 트랜잭션이 없으므로
// 중간 단계가 실패해도 "현금 + 포지션" 자산이 어긋나지 않는지를 가짜 DB로 검증한다.

const CHAT_ID = 1;
const SWEEP_MEMO = buildStrategyMemo({ strategyId: CASH_SWEEP_STRATEGY_ID, event: "sweep-buy", note: "t" });

type Write = { table: string; op: "insert" | "update" | "delete"; values?: unknown };

function createHarness(options: {
  prefs: Record<string, unknown>;
  positions?: Record<string, unknown>[];
  stocks?: Record<string, unknown>[];
  failPositionWrite?: boolean;
  failSetPrefsCall?: number; // n번째(1부터) setPrefs 호출을 실패시킨다
  failTradeLog?: boolean;
}) {
  const prefs = { ...options.prefs };
  const writes: Write[] = [];
  const tradeLogs: CashSweepTradeLog[] = [];
  let setPrefsCalls = 0;

  const supabase = {
    from(table: string) {
      let op: Write["op"] | null = null;
      let values: unknown;
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        is: () => builder,
        insert: (v: unknown) => ((op = "insert"), (values = v), builder),
        update: (v: unknown) => ((op = "update"), (values = v), builder),
        delete: () => ((op = "delete"), builder),
        then(resolve: (r: { data: unknown; error: unknown }) => unknown) {
          if (op) {
            if (options.failPositionWrite) return Promise.resolve({ data: null, error: new Error("write failed") }).then(resolve);
            writes.push({ table, op, values });
            return Promise.resolve({ data: null, error: null }).then(resolve);
          }
          const data = table === "stocks" ? options.stocks ?? [] : options.positions ?? [];
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      return builder;
    },
  };

  const steps = createCashSweepSteps({
    getPrefs: async () => ({ ...prefs }),
    setPrefs: async (_chatId, patch) => {
      setPrefsCalls += 1;
      if (setPrefsCalls === options.failSetPrefsCall) return { ok: false };
      Object.assign(prefs, patch);
      return { ok: true };
    },
    appendTradeLog: async (log) => {
      if (options.failTradeLog) throw new Error("trade log failed");
      tradeLogs.push(log);
    },
    overlayIntradayPrices: async () => 0,
  });

  return { steps, supabase, prefs, writes, tradeLogs };
}

const holding: SweepHolding = {
  id: 7,
  code: "069500",
  name: "KODEX 200",
  price: 40_000,
  quantity: 10,
  invested_amount: 380_000,
};

const sellArgs = (supabase: unknown) => ({
  supabase,
  chatId: CHAT_ID,
  holding,
  sellQty: 10,
  event: "sweep-liquidate",
  note: "test",
});

test("sellSweepPosition: 정상 매도는 현금 입금·포지션 삭제·거래기록을 모두 반영한다", async () => {
  const h = createHarness({ prefs: { virtual_cash: 100_000, virtual_realized_pnl: 0 } });
  const { net, pnl } = await h.steps.sellSweepPosition(sellArgs(h.supabase));

  assert.equal(h.prefs.virtual_cash, 100_000 + net);
  assert.equal(h.prefs.virtual_realized_pnl, pnl);
  assert.deepEqual(h.writes.map((w) => w.op), ["delete"]);
  assert.equal(h.tradeLogs.length, 1);
  assert.equal(h.tradeLogs[0].side, "SELL");
});

test("sellSweepPosition: 포지션 삭제가 실패하면 입금한 현금을 되돌리고 예외를 던진다 (자산 이중 계상 방지)", async () => {
  const h = createHarness({
    prefs: { virtual_cash: 100_000, virtual_realized_pnl: 5_000 },
    failPositionWrite: true,
  });
  await assert.rejects(h.steps.sellSweepPosition(sellArgs(h.supabase)));

  assert.equal(h.prefs.virtual_cash, 100_000);
  assert.equal(h.prefs.virtual_realized_pnl, 5_000);
  assert.equal(h.tradeLogs.length, 0);
});

test("sellSweepPosition: 현금 반영이 실패하면 포지션을 건드리지 않고 예외를 던진다", async () => {
  const h = createHarness({ prefs: { virtual_cash: 100_000 }, failSetPrefsCall: 1 });
  await assert.rejects(h.steps.sellSweepPosition(sellArgs(h.supabase)));

  assert.equal(h.prefs.virtual_cash, 100_000);
  assert.equal(h.writes.length, 0);
  assert.equal(h.tradeLogs.length, 0);
});

test("sellSweepPosition: 거래기록만 실패하면 자산(현금·포지션)은 반영된 채 정상 반환한다", async () => {
  const h = createHarness({ prefs: { virtual_cash: 100_000 }, failTradeLog: true });
  const { net } = await h.steps.sellSweepPosition(sellArgs(h.supabase));

  assert.equal(h.prefs.virtual_cash, 100_000 + net);
  assert.deepEqual(h.writes.map((w) => w.op), ["delete"]);
});

test("sellSweepPosition: 부분 매도는 포지션 수량·원금을 줄인다", async () => {
  const h = createHarness({ prefs: { virtual_cash: 0 } });
  await h.steps.sellSweepPosition({ ...sellArgs(h.supabase), sellQty: 4 });

  assert.equal(h.writes[0].op, "update");
  assert.deepEqual(h.writes[0].values, { quantity: 6, invested_amount: 380_000 - 152_000 });
});

const buyScenario = {
  prefs: { virtual_cash: 5_000_000, virtual_seed_capital: 20_000_000 },
  stocks: [{ code: "069500", name: "KODEX 200", close: 40_000 }],
};

test("runCashSweepStep: 유휴현금으로 지수 ETF를 사면 현금이 빠지고 포지션이 생긴다", async () => {
  const h = createHarness(buyScenario);
  const { notes } = await h.steps.runCashSweepStep({ supabase: h.supabase, chatId: CHAT_ID, dryRun: false });

  // 시드 2천만의 10%(200만)를 남기고 유휴 300만 → 75주
  assert.equal(h.prefs.virtual_cash, 2_000_000);
  assert.deepEqual(h.writes.map((w) => w.op), ["insert"]);
  assert.equal((h.writes[0].values as Record<string, unknown>).quantity, 75);
  assert.equal(h.tradeLogs[0].side, "BUY");
  assert.equal(notes.length, 1);
});

test("runCashSweepStep: 포지션 생성이 실패하면 차감한 현금을 되돌린다 (돈이 사라지지 않음)", async () => {
  const h = createHarness({ ...buyScenario, failPositionWrite: true });
  const { notes } = await h.steps.runCashSweepStep({ supabase: h.supabase, chatId: CHAT_ID, dryRun: false });

  assert.equal(h.prefs.virtual_cash, 5_000_000);
  assert.equal(h.tradeLogs.length, 0);
  assert.deepEqual(notes, []); // 스윕 실패는 자동매매 본 로직을 막지 않도록 삼킨다
});

test("runCashSweepStep: 기존 스윕 보유분이 있으면 추가매수로 수량·평단을 갱신한다", async () => {
  const h = createHarness({
    ...buyScenario,
    positions: [{ id: 3, code: "069500", quantity: 10, invested_amount: 380_000, memo: SWEEP_MEMO }],
  });
  await h.steps.runCashSweepStep({ supabase: h.supabase, chatId: CHAT_ID, dryRun: false });

  assert.equal(h.writes[0].op, "update");
  assert.deepEqual(h.writes[0].values, { quantity: 85, invested_amount: 3_380_000, buy_price: 39764.7059 });
});

test("runCashSweepStep: dryRun은 아무것도 쓰지 않는다", async () => {
  const h = createHarness(buyScenario);
  const { notes } = await h.steps.runCashSweepStep({ supabase: h.supabase, chatId: CHAT_ID, dryRun: true });

  assert.equal(h.prefs.virtual_cash, 5_000_000);
  assert.equal(h.writes.length, 0);
  assert.match(notes[0], /테스트/);
});

test("fetchCashSweepPositionValue: 스윕 전략 메모가 붙은 보유분만 평가한다", async () => {
  const h = createHarness({
    prefs: {},
    stocks: [{ code: "069500", name: "KODEX 200", close: 40_000 }],
    positions: [
      { id: 1, code: "069500", quantity: 10, memo: SWEEP_MEMO },
      { id: 2, code: "069500", quantity: 99, memo: buildStrategyMemo({ strategyId: "other", event: "buy" }) },
    ],
  });
  assert.equal(await h.steps.fetchCashSweepPositionValue(h.supabase, CHAT_ID), 400_000);
});
