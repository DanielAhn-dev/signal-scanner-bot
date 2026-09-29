import test from "node:test";
import assert from "node:assert/strict";
import {
  applyDeposit,
  isDepositDue,
  nextDepositDate,
  normalizeDepositDay,
  normalizeMonthlyDeposit,
  readDepositSettings,
  resolveLastDepositMonthOnSave,
} from "../src/services/monthlyDeposit";

test("금액: 0은 적립 안 함, 1만원 미만·음수·숫자 아님은 거부", () => {
  assert.equal(normalizeMonthlyDeposit(0), 0);
  assert.equal(normalizeMonthlyDeposit(500_000), 500_000);
  assert.equal(normalizeMonthlyDeposit(5_000), null);
  assert.equal(normalizeMonthlyDeposit(-1), null);
  assert.equal(normalizeMonthlyDeposit("abc"), null);
});

test("입금일은 1~28로 맞춘다 (없는 날짜 방지)", () => {
  assert.equal(normalizeDepositDay(31), 28);
  assert.equal(normalizeDepositDay(0), 1);
  assert.equal(normalizeDepositDay(undefined), 1);
  assert.equal(normalizeDepositDay(25), 25);
});

test("입금일이 지난 뒤 그 달 한 번만", () => {
  const s = { monthlyDeposit: 500_000, depositDay: 25, lastDepositMonth: "2026-09" };
  assert.equal(isDepositDue(s, "2026-10-24"), false);
  assert.equal(isDepositDue(s, "2026-10-25"), true);
  assert.equal(isDepositDue(s, "2026-10-27"), true); // 25일이 휴일이면 다음 실행 때
  assert.equal(isDepositDue({ ...s, lastDepositMonth: "2026-10" }, "2026-10-27"), false);
  assert.equal(isDepositDue({ ...s, monthlyDeposit: 0 }, "2026-10-27"), false);
});

test("처음 설정한 달에 입금일이 지났으면 다음 달부터, 아직이면 이번 달부터", () => {
  assert.equal(resolveLastDepositMonthOnSave({ depositDay: 10, previousLastDepositMonth: null, todayKey: "2026-09-29" }), "2026-09");
  assert.equal(resolveLastDepositMonthOnSave({ depositDay: 28, previousLastDepositMonth: null, todayKey: "2026-09-20" }), null);
  // 이번 달 이미 입금했으면 금액을 바꿔도 이번 달 두 번 들어가지 않는다
  assert.equal(resolveLastDepositMonthOnSave({ depositDay: 28, previousLastDepositMonth: "2026-09", todayKey: "2026-09-20" }), "2026-09");
});

test("다음 입금 예정일", () => {
  const s = { monthlyDeposit: 500_000, depositDay: 10, lastDepositMonth: "2026-09" };
  assert.equal(nextDepositDate(s, "2026-09-29"), "2026-10-10");
  assert.equal(nextDepositDate({ ...s, lastDepositMonth: "2026-12" }, "2026-12-15"), "2027-01-10");
  assert.equal(nextDepositDate({ ...s, lastDepositMonth: "2026-08" }, "2026-09-05"), "2026-09-10");
  assert.equal(nextDepositDate({ ...s, lastDepositMonth: "2026-08" }, "2026-09-12"), "2026-09-12"); // 밀린 입금은 다음 실행 때
  assert.equal(nextDepositDate({ ...s, monthlyDeposit: 0 }, "2026-09-29"), null);
});

test("입금: 현금·시드·총 원금에 더하고 내역을 남긴다", () => {
  const next = applyDeposit({
    prefs: { virtual_cash: 120_000, virtual_seed_capital: 1_000_000, virtual_total_deposited: 1_000_000 },
    amount: 500_000,
    todayKey: "2026-10-12",
  });
  assert.equal(next.virtual_cash, 620_000);
  assert.equal(next.virtual_seed_capital, 1_500_000);
  assert.equal(next.virtual_total_deposited, 1_500_000);
  assert.equal(next.virtual_last_deposit_month, "2026-10");
  assert.deepEqual(next.virtual_deposit_log, [{ date: "2026-10-12", amount: 500_000, cashAfter: 620_000 }]);
});

test("총 원금 기록이 없던 계정은 지금 시드를 시작 원금으로 본다", () => {
  const next = applyDeposit({ prefs: { virtual_cash: 0, virtual_seed_capital: 20_000_000 }, amount: 1_000_000, todayKey: "2026-10-01" });
  assert.equal(next.virtual_total_deposited, 21_000_000);
});

test("prefs 읽기: 설정 없으면 적립 안 함", () => {
  assert.deepEqual(readDepositSettings({}), { monthlyDeposit: 0, depositDay: 1, lastDepositMonth: null });
});
