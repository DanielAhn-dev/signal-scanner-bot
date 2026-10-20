import test from "node:test";
import assert from "node:assert/strict";
import { estimateReinvest, monthSummary, projectNextMonth, receiptNet, sanitizeReceipt, sanitizeReceipts, type DistributionReceipt } from "../src/lib/distributionReceipts";

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

test("estimateReinvest: 예수금이 분배금만큼 늘지 않은 몫을 매수에 쓰인 것으로 본다", () => {
  // 600주 × 160원 × 0.846 = 81,216원
  const receipts = [R({ net: 300_000 })];
  const history = [
    { date: "2026-09-02", total: 50_000_000, cash: 900_000, groups: [] },
    { date: "2026-09-30", total: 52_000_000, cash: 1_000_000, groups: [] },
    { date: "2026-10-01", total: 52_000_000, cash: 1_000_000, groups: [] },
  ];
  const base = { receipts, history, today: "2026-10-19" };
  const ok = estimateReinvest({ ...base, cashNow: 1_020_000, cashUpdatedAt: "2026-10-18" });
  assert.deepEqual(ok, { status: "ok", month: "2026-10", received: 300_000, deposit: 0, depositUnknown: false, baselineDate: "2026-09-30", cashThen: 1_000_000, cashNow: 1_020_000, bought: 280_000, reinvested: 280_000, kept: 20_000, baselineApprox: false });
  // 예수금이 분배금보다 더 늘면 전부 현금, 줄었으면 전부 매수 — 받은 분배금 범위를 넘지 않는다
  const kept = estimateReinvest({ ...base, cashNow: 2_000_000, cashUpdatedAt: "2026-10-18" });
  assert.equal(kept?.status === "ok" && kept.reinvested, 0);
  const spent = estimateReinvest({ ...base, cashNow: 100_000, cashUpdatedAt: "2026-10-18" });
  assert.equal(spent?.status === "ok" && spent.reinvested, 300_000);
});

test("estimateReinvest: 분배금을 적은 뒤 예수금을 안 고쳤으면 판단하지 않는다", () => {
  const history = [{ date: "2026-09-30", total: 1, cash: 0, groups: [] }];
  const receipts = [R({ net: 300_000, createdAt: "2026-10-15T00:00:00Z" })];
  for (const cashUpdatedAt of [null, "2026-09-29", "2026-10-14"]) {
    assert.equal(estimateReinvest({ receipts, history, cashNow: 0, cashUpdatedAt, today: "2026-10-19" })?.status, "stale-cash");
  }
  // 같은 날 고친 것은 반영으로 본다(KST — 10/15 23시 UTC는 10/16 KST)
  assert.equal(estimateReinvest({ receipts, history, cashNow: 0, cashUpdatedAt: "2026-10-15", today: "2026-10-19" })?.status, "ok");
  const late = [R({ net: 300_000, createdAt: "2026-10-15T16:00:00Z" })];
  assert.equal(estimateReinvest({ receipts: late, history, cashNow: 0, cashUpdatedAt: "2026-10-15", today: "2026-10-19" })?.status, "stale-cash");
});

test("estimateReinvest: 받은 기록이 없으면 null, 지난달 기록이 없으면 no-baseline, 예전 기록은 현금 비중으로 되짚는다", () => {
  assert.equal(estimateReinvest({ receipts: [R({ month: "2026-09" })], history: [], cashNow: 0, cashUpdatedAt: "2026-10-18", today: "2026-10-19" }), null);
  assert.equal(estimateReinvest({ receipts: [R({})], history: [{ date: "2026-10-01", total: 1, cash: 0, groups: [] }], cashNow: 0, cashUpdatedAt: "2026-10-18", today: "2026-10-19" })?.status, "no-baseline");
  const approx = estimateReinvest({
    receipts: [R({ net: 100_000 })],
    history: [{ date: "2026-09-30", total: 40_000_000, groups: [{ group: "cash", actualPct: 2.5 }] }],
    cashNow: 1_050_000, cashUpdatedAt: "2026-10-18", today: "2026-10-19",
  });
  assert.ok(approx?.status === "ok");
  assert.equal(approx.cashThen, 1_000_000);
  assert.equal(approx.kept, 50_000);
  assert.equal(approx.baselineApprox, true);
});

test("estimateReinvest: 체크인한 월입금은 들어온 돈에 더하고, 산 금액은 들어온 비율대로 분배금 몫을 나눈다", () => {
  const history = [{ date: "2026-09-30", total: 1, cash: 1_000_000, groups: [] }];
  const base = { receipts: [R({ net: 300_000 })], history, cashUpdatedAt: "2026-10-18", today: "2026-10-19" };
  // 분배금 30만 + 월입금 90만 = 120만 들어옴, 예수금 +12만 → 108만 매수, 분배금 몫 108만 × 30/120 = 27만
  const r = estimateReinvest({ ...base, cashNow: 1_120_000, deposit: 900_000 });
  assert.ok(r?.status === "ok");
  assert.equal(r.bought, 1_080_000);
  assert.equal(r.reinvested, 270_000);
  assert.equal(r.kept, 30_000);
  // 월입금을 빼먹으면(0) 그 입금이 '남은 현금'으로 잡혀 재투자가 0으로 보인다 — 체크인이 필요한 이유
  const missing = estimateReinvest({ ...base, cashNow: 1_900_000, deposit: 0 });
  assert.equal(missing?.status === "ok" && missing.reinvested, 0);
  // 읽지 못하면 0으로 계산하고 표시한다
  const unknown = estimateReinvest({ ...base, cashNow: 1_000_000, deposit: null });
  assert.equal(unknown?.status === "ok" && unknown.depositUnknown, true);
});

test("estimateReinvest: 적을 때 예수금에 바로 더한 기록(cashApplied)은 예수금을 다시 고치지 않아도 반영으로 본다", () => {
  const history = [{ date: "2026-09-30", total: 1, cash: 100_000, groups: [] }];
  const applied = [R({ net: 300_000, createdAt: "2026-10-15T00:00:00Z", cashApplied: 300_000 })];
  const ok = estimateReinvest({ receipts: applied, history, cashNow: 400_000, cashUpdatedAt: "2026-09-29", today: "2026-10-19" });
  assert.equal(ok?.status, "ok");
  assert.equal(ok?.status === "ok" && ok.reinvested, 0);
  // 하나라도 예수금과 무관한 기록이 섞이면 예전처럼 예수금 저장을 기다린다
  const mixed = [...applied, R({ id: "y", code: "069500", net: 50_000, createdAt: "2026-10-15T00:00:00Z" })];
  assert.equal(estimateReinvest({ receipts: mixed, history, cashNow: 400_000, cashUpdatedAt: "2026-09-29", today: "2026-10-19" })?.status, "stale-cash");
  // 예수금을 한 번도 적지 않았으면 판단하지 않는다
  assert.equal(estimateReinvest({ receipts: applied, history, cashNow: 400_000, cashUpdatedAt: null, today: "2026-10-19" })?.status, "stale-cash");
  // 저장·읽기에서 cashApplied가 남는다
  assert.equal(sanitizeReceipts(applied)[0].cashApplied, 300_000);
  assert.equal(sanitizeReceipts([R({})])[0].cashApplied, undefined);
});
