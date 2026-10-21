import test from "node:test";
import assert from "node:assert/strict";
import { createVirtualLotService } from "../src/services/virtualLotService";

// eq·gt·order·insert·update만 흉내 내는 메모리 DB — 필터는 실제로 적용한다
type Row = Record<string, any>;
function fakeDb(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = { ...seed };
  let nextId = 1000;
  function from(table: string) {
    tables[table] ??= [];
    const filters: Array<(r: Row) => boolean> = [];
    let op: { kind: "select" } | { kind: "update"; patch: Row } = { kind: "select" };
    const run = () => {
      const rows = tables[table].filter((r) => filters.every((f) => f(r)));
      if (op.kind === "update") {
        const patch = op.patch;
        rows.forEach((r) => Object.assign(r, patch));
        return { data: null, error: null };
      }
      return { data: rows.map((r) => ({ ...r })), error: null };
    };
    const builder: any = {
      select: () => builder,
      eq: (col: string, v: unknown) => (filters.push((r) => r[col] === v), builder),
      gt: (col: string, v: number) => (filters.push((r) => Number(r[col]) > v), builder),
      order: () => builder,
      update: (patch: Row) => ((op = { kind: "update", patch }), builder),
      insert: async (row: Row | Row[]) => {
        for (const r of Array.isArray(row) ? row : [row]) tables[table].push({ id: nextId++, ...r });
        return { error: null };
      },
      then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
        try {
          resolve(run());
        } catch (e) {
          reject(e);
        }
      },
    };
    return builder;
  }
  return { db: { from } as any, tables };
}

const CHAT = 7;
const CODE = "069500"; // KODEX 200 — 봇(행 1)과 실계좌(행 2)가 같은 종목을 들고 있다
const BOT_POSITION = 1;
const REAL_POSITION = 2;

function seedLots(): Row[] {
  return [
    // 실계좌 로트가 더 오래됐다 — chat+code로 찾으면 이것부터 소진된다
    { id: 10, chat_id: CHAT, code: CODE, position_id: REAL_POSITION, acquired_price: 30_000, acquired_quantity: 50, remaining_quantity: 50, acquired_at: "2026-01-02T00:00:00Z" },
    { id: 11, chat_id: CHAT, code: CODE, position_id: BOT_POSITION, acquired_price: 40_000, acquired_quantity: 10, remaining_quantity: 10, acquired_at: "2026-09-01T00:00:00Z" },
    // 보유 행이 지워져 SET NULL 된 옛 로트 — 어느 계좌 것인지 몰라 쓰지 않는다
    { id: 12, chat_id: CHAT, code: CODE, position_id: null, acquired_price: 20_000, acquired_quantity: 5, remaining_quantity: 5, acquired_at: "2025-05-01T00:00:00Z" },
  ];
}

test("봇 매도 원가는 봇 보유 행의 로트로만 계산한다(실계좌·옛 로트 제외)", async () => {
  const { db } = fakeDb({ virtual_trade_lots: seedLots() });
  const lots = createVirtualLotService(db);
  const preview = await lots.previewFifoSale({ chatId: CHAT, positionId: BOT_POSITION, code: CODE, quantity: 10 });
  assert.deepEqual(preview.allocations.map((a) => a.lotId), [11]);
  assert.equal(preview.totalCost, 400_000);
});

test("봇 로트가 모자라면 실계좌 로트로 메우지 않고 실패한다", async () => {
  const { db } = fakeDb({ virtual_trade_lots: seedLots() });
  const lots = createVirtualLotService(db);
  await assert.rejects(
    lots.previewFifoSale({ chatId: CHAT, positionId: BOT_POSITION, code: CODE, quantity: 11 }),
    /insufficient/
  );
});

test("replace는 그 보유 행의 로트만 닫고 다시 만든다", async () => {
  const { db, tables } = fakeDb({ virtual_trade_lots: seedLots() });
  const lots = createVirtualLotService(db);
  await lots.replaceTradeLotsForHolding({ chatId: CHAT, watchlistId: BOT_POSITION, code: CODE, quantity: 8, investedAmount: 320_000 });
  const byId = new Map(tables.virtual_trade_lots.map((r) => [r.id, r]));
  assert.equal(byId.get(10)!.remaining_quantity, 50, "실계좌 로트는 그대로");
  assert.equal(byId.get(12)!.remaining_quantity, 5, "옛 로트도 건드리지 않는다");
  assert.equal(byId.get(11)!.remaining_quantity, 0);
  const fresh = tables.virtual_trade_lots.filter((r) => r.position_id === BOT_POSITION && r.remaining_quantity > 0);
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].remaining_quantity, 8);
  assert.equal(fresh[0].acquired_price, 40_000);
});

test("전량 매도 후 정리(quantity 0)도 그 보유 행 로트만 닫는다", async () => {
  const { db, tables } = fakeDb({ virtual_trade_lots: seedLots() });
  const lots = createVirtualLotService(db);
  await lots.replaceTradeLotsForHolding({ chatId: CHAT, watchlistId: BOT_POSITION, code: CODE, quantity: 0, investedAmount: 0 });
  const open = tables.virtual_trade_lots.filter((r) => r.remaining_quantity > 0).map((r) => r.id).sort();
  assert.deepEqual(open, [10, 12]);
});

test("ensure는 실계좌에 로트가 있어도 봇 행에 로트가 없으면 봇 행 로트를 만든다", async () => {
  const { db, tables } = fakeDb({ virtual_trade_lots: seedLots().filter((r) => r.id !== 11) });
  const lots = createVirtualLotService(db);
  const out = await lots.ensureTradeLotsForHolding({ chatId: CHAT, watchlistId: BOT_POSITION, code: CODE, quantity: 10, investedAmount: 400_000 });
  assert.equal(out.length, 1);
  assert.equal(out[0].acquired_price, 40_000);
  assert.equal(tables.virtual_trade_lots.find((r) => r.id === 10)!.remaining_quantity, 50);
});

test("보유 행 id 없이 로트를 고치거나 고르려 하면 거부한다(종목 전체를 건드리지 않게)", async () => {
  const { db, tables } = fakeDb({ virtual_trade_lots: seedLots() });
  const lots = createVirtualLotService(db);
  await assert.rejects(lots.replaceTradeLotsForHolding({ chatId: CHAT, watchlistId: null, code: CODE, quantity: 0 }), /position id/);
  await assert.rejects(lots.previewFifoSale({ chatId: CHAT, positionId: null, code: CODE, quantity: 1 }), /position id/);
  await assert.rejects(lots.ensureTradeLotsForHolding({ chatId: CHAT, code: CODE, quantity: 1, buyPrice: 1 }), /position id/);
  assert.equal(tables.virtual_trade_lots.filter((r) => r.remaining_quantity > 0).length, 3);
});
