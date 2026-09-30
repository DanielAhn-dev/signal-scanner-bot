import test from "node:test";
import assert from "node:assert/strict";
import { createAutoTradeBuyStep, type NewPositionRow } from "../src/services/virtualAutoTradeBuyStep";

// 매수는 포지션이 써졌으면 성립한다 — 현금은 실행 끝에 "시드 + 실현손익 − 보유 투자금"으로 재계산된다.
// 거래기록·로트 실패로 예외가 나면 호출측이 가용현금을 줄이지 못해 같은 실행의 다음 매수가 없는 현금을 쓴다.

type UpsertResult = { data: unknown; error: unknown };

function fakeSupabase(results: UpsertResult[]) {
  const upserts: Record<string, unknown>[] = [];
  return {
    upserts,
    client: {
      from: () => {
        const builder = {
          upsert: (values: Record<string, unknown>) => {
            upserts.push(values);
            return builder;
          },
          select: () => builder,
          maybeSingle: () => Promise.resolve(results.shift() ?? { data: null, error: null }),
        };
        return builder;
      },
    },
  };
}

function createBuyHarness(options: { failTradeLog?: boolean; failLots?: boolean } = {}) {
  const calls = { tradeLogs: 0, ensure: [] as number[], append: [] as Array<number | null | undefined> };
  const step = createAutoTradeBuyStep({
    appendTradeLog: async () => {
      if (options.failTradeLog) throw new Error("trade log failed");
      calls.tradeLogs += 1;
      return 77;
    },
    lots: {
      ensureTradeLotsForHolding: async (input) => {
        if (options.failLots) throw new Error("lots failed");
        calls.ensure.push(input.watchlistId ?? 0);
        return [];
      },
      appendTradeLotsForHolding: async (input) => {
        if (options.failLots) throw new Error("lots failed");
        calls.append.push(input.sourceTradeId);
      },
    },
  });
  return { ...step, calls };
}

const position: NewPositionRow = { id: 5, created_at: "2026-09-30T00:00:00Z", buy_date: "2026-09-30" };
const buyInput = (supabase: unknown, lot: Parameters<ReturnType<typeof createBuyHarness>["recordBuyAfterPosition"]>[0]["lot"]) => ({
  supabase,
  chatId: 1,
  code: "005930",
  price: 70_000,
  quantity: 3,
  investedAmount: 210_000,
  memo: "strategy=core.autotrade.v1;event=monday-buy",
  lot,
});

test("insertNewPosition: 새 포지션이면 id·생성일을 돌려준다", async () => {
  const db = fakeSupabase([{ data: { id: 5, created_at: "c", buy_date: "b" }, error: null }]);
  const step = createBuyHarness();
  assert.deepEqual(await step.insertNewPosition(db.client, { code: "005930" }), { id: 5, created_at: "c", buy_date: "b" });
});

test("insertNewPosition: 같은 종목이 이미 있으면(겹친 실행) null — 매수를 기록하지 않게 한다", async () => {
  const db = fakeSupabase([{ data: null, error: null }]);
  const step = createBuyHarness();
  assert.equal(await step.insertNewPosition(db.client, { code: "005930" }), null);
});

test("insertNewPosition: 진입 맥락 컬럼이 없는 예전 스키마면 그 컬럼을 빼고 다시 시도한다", async () => {
  const db = fakeSupabase([
    { data: null, error: { code: "42703", message: 'column "target_horizon" does not exist' } },
    { data: { id: 6 }, error: null },
  ]);
  const step = createBuyHarness();
  const row = await step.insertNewPosition(db.client, { code: "005930", target_horizon: "SWING", planned_review_at: "x" });

  assert.equal(row?.id, 6);
  assert.deepEqual(db.upserts[1], { code: "005930" });
});

test("insertNewPosition: 그 밖의 쓰기 오류는 예외로 알린다", async () => {
  const db = fakeSupabase([{ data: null, error: new Error("boom") }]);
  const step = createBuyHarness();
  await assert.rejects(step.insertNewPosition(db.client, { code: "005930" }), /boom/);
});

test("recordBuyAfterPosition: 새 포지션은 거래기록을 남기고 로트를 보유분 기준으로 맞춘다", async () => {
  const step = createBuyHarness();
  const tradeId = await step.recordBuyAfterPosition(buyInput({}, { kind: "new", position }));

  assert.equal(tradeId, 77);
  assert.equal(step.calls.tradeLogs, 1);
  assert.deepEqual(step.calls.ensure, [5]);
});

test("recordBuyAfterPosition: 추가매수는 이번 매수분 로트를 거래기록 ID와 함께 덧붙인다", async () => {
  const step = createBuyHarness();
  await step.recordBuyAfterPosition(buyInput({}, { kind: "add-on", holdingId: 5, note: "autotrade-add-on-buy" }));

  assert.deepEqual(step.calls.append, [77]);
});

test("recordBuyAfterPosition: 거래기록이 실패해도 예외 없이 로트까지 진행한다", async () => {
  const step = createBuyHarness({ failTradeLog: true });
  const tradeId = await step.recordBuyAfterPosition(buyInput({}, { kind: "add-on", holdingId: 5, note: "n" }));

  assert.equal(tradeId, null);
  assert.deepEqual(step.calls.append, [null]);
});

test("recordBuyAfterPosition: 로트 저장이 실패해도 예외 없이 거래기록 ID를 돌려준다", async () => {
  const step = createBuyHarness({ failLots: true });
  assert.equal(await step.recordBuyAfterPosition(buyInput({}, { kind: "new", position })), 77);
});
