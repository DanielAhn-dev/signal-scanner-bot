import test from "node:test";
import assert from "node:assert/strict";
import { monthSummary, projectNextMonth, receiptNet, sanitizeReceipt, sanitizeReceipts, type DistributionReceipt } from "../src/lib/distributionReceipts";

const R = (patch: Partial<DistributionReceipt>): DistributionReceipt => ({
  id: "x", month: "2026-10", code: "498400", name: "KODEX 200타겟위클리커버드콜", quantity: 600, perShare: 160, net: null, createdAt: "2026-10-15T00:00:00Z", ...patch,
});
let n = 0;
const mk = () => `id${++n}`;

test("sanitizeReceipt: 검증 — 달·코드·수량·주당 필수, 세후는 선택이지만 세전보다 클 수 없다", () => {
  const ok = sanitizeReceipt({ month: "2026-10", code: "498400", name: "K", quantity: "610", perShare: "161", net: "" }, "t", mk);
  assert.ok(typeof ok !== "string");
  assert.equal((ok as DistributionReceipt).net, null);
  assert.equal(typeof sanitizeReceipt({ month: "2026-13", code: "498400", quantity: 1, perShare: 1 }, "t", mk), "string");
  assert.equal(typeof sanitizeReceipt({ month: "2026-10", code: "498400", quantity: 1.5, perShare: 1 }, "t", mk), "string");
  assert.match(sanitizeReceipt({ month: "2026-10", code: "498400", quantity: 10, perShare: 100, net: 1200 }, "t", mk) as string, /세전/);
  assert.equal(sanitizeReceipts([{ month: "x" }, R({})]).length, 1);
});

test("monthSummary·receiptNet: 세후를 안 적으면 15.4%를 떼고 '추정'으로 센다", () => {
  const rs = [R({ net: 91_234 }), R({ code: "0105E0", quantity: 700, perShare: 55, net: null }), R({ month: "2026-09", net: 50_000 })];
  const s = monthSummary(rs, "2026-10");
  assert.equal(s.items.length, 2);
  assert.equal(s.net, 91_234 + Math.round(38_500 * 0.846));
  assert.equal(s.estimatedCount, 1);
  assert.equal(receiptNet(rs[0]), 91_234);
});

test("projectNextMonth: 최근 주당 × 지금 수량 × 실제 세후 비율, 기록 없는 종목은 추정, 오래된 기록은 안 씀", () => {
  const receipts = [
    // 600주 × 160원 = 96,000원 세전, 실제 입금 91,200원(커버드콜이라 세금이 적다) → 비율 0.95
    R({ net: 91_200 }),
    R({ code: "161510", month: "2026-06", quantity: 100, perShare: 300, net: 25_380 }), // 4달 전 → 쓰지 않음
  ];
  const p = projectNextMonth({
    receipts,
    holdings: [
      { code: "498400", name: "KODEX 200타겟위클리커버드콜", quantity: 720 },
      { code: "161510", name: "PLUS 고배당주", quantity: 100 },
      { code: "278530", name: "KODEX 200TR", quantity: 50 },
    ],
    estimateMonthlyNet: (code) => (code === "161510" ? 5_000 : 0),
    today: "2026-10-16",
  });
  const k = p.rows.find((r) => r.code === "498400")!;
  assert.equal(k.source, "receipt");
  assert.equal(k.net, Math.round(160 * 720 * 0.95));
  assert.equal(k.addedShares, 120);
  assert.equal(p.rows.find((r) => r.code === "161510")!.source, "estimate");
  assert.ok(!p.rows.some((r) => r.code === "278530"), "분배금 없는 TR은 빠진다");
  assert.equal(p.total, k.net + 5_000);
  assert.equal(p.receiptCodes, 1);
});

test("projectNextMonth: 분기마다 받는 종목은 기록 간격(3달)으로 나눈다", () => {
  const receipts = [
    R({ code: "161510", month: "2026-07", quantity: 100, perShare: 300, net: null }),
    R({ code: "161510", month: "2026-10", quantity: 100, perShare: 300, net: null }),
  ];
  const p = projectNextMonth({ receipts, holdings: [{ code: "161510", name: "PLUS 고배당주", quantity: 100 }], estimateMonthlyNet: () => 0, today: "2026-10-20" });
  assert.equal(p.rows[0].intervalMonths, 3);
  assert.equal(p.rows[0].net, Math.round((300 * 100 * 0.846) / 3));
});
