import { test } from "node:test";
import assert from "node:assert/strict";
import { accountCashRows, addAccountCash, guideCashKey, sanitizeCashActivity, sanitizeCashChecks, setAccountCash } from "../src/lib/accountCash";
import { applyReceiptToCash, DEFAULT_INCOME_GUIDE_SETTINGS } from "../src/lib/incomeGuide";

const base = { ...DEFAULT_INCOME_GUIDE_SETTINGS, cashByAccount: { "토스|일반": 300_000 } };

test("실제 잔액으로 맞추면 값·확인 기록·cashUpdatedAt이 같이 바뀌고 다른 계좌는 그대로", () => {
  const r = setAccountCash(base, {}, "|인컴계좌(일반)", 677_016, "2026-10-21")!;
  assert.deepEqual(r.settings.cashByAccount, { "토스|일반": 300_000, "|인컴계좌(일반)": 677_016 });
  assert.equal(r.settings.cashUpdatedAt, "2026-10-21");
  assert.deepEqual(r.checks["|인컴계좌(일반)"], { amount: 677_016, at: "2026-10-21" });
});

test("0이면 칸을 비우고 확인 기록은 0으로 남긴다, 잘못된 키·음수는 거절", () => {
  const r = setAccountCash(base, {}, "토스|일반", 0, "2026-10-21")!;
  assert.equal(r.settings.cashByAccount, undefined);
  assert.deepEqual(r.checks["토스|일반"], { amount: 0, at: "2026-10-21" });
  assert.equal(setAccountCash(base, {}, "키없음", 1, "2026-10-21"), null);
  assert.equal(setAccountCash(base, {}, "토스|일반", -1, "2026-10-21"), null);
});

test("적은 뒤 분배금 기록으로 늘어난 몫이 sinceCheck에 나온다", () => {
  const set = setAccountCash(base, {}, "토스|일반", 500_000, "2026-10-21")!;
  const after = applyReceiptToCash(set.settings, "토스|일반", 160_170)!;
  const rows = accountCashRows(after.settings, set.checks, ["토스|일반", "NH|CMA"], set.activity);
  assert.deepEqual(rows.find((r) => r.key === "토스|일반"), { key: "토스|일반", amount: 660_170, checkedAt: "2026-10-21", sinceCheck: 160_170, activity: [{ kind: "correction", before: 300_000, after: 500_000, delta: 200_000, at: "2026-10-21" }] });
  assert.deepEqual(rows.find((r) => r.key === "NH|CMA"), { key: "NH|CMA", amount: 0, checkedAt: null, sinceCheck: null, activity: [] });
});

test("계좌별 입금은 해당 계좌 잔액에만 더하고 보정·입금 이력을 구분한다", () => {
  const corrected = setAccountCash(base, {}, "토스|일반", 350_000, "2026-10-21")!;
  const deposited = addAccountCash(corrected.settings, corrected.activity, "토스|일반", 5_000, "2026-10-22")!;
  const rows = accountCashRows(deposited.settings, corrected.checks, ["토스|일반", "NH|CMA"], deposited.activity);
  assert.equal(rows.find((r) => r.key === "토스|일반")?.amount, 355_000);
  assert.equal(rows.find((r) => r.key === "NH|CMA")?.amount, 0);
  assert.deepEqual(rows.find((r) => r.key === "토스|일반")?.activity, [
    { kind: "correction", before: 300_000, after: 350_000, delta: 50_000, at: "2026-10-21" },
    { kind: "deposit", before: 350_000, after: 355_000, delta: 5_000, at: "2026-10-22" },
  ]);
  assert.equal(rows.find((r) => r.key === "토스|일반")?.sinceCheck, 5_000);
});

test("입금액 검증과 이력 데이터 정리", () => {
  assert.equal(addAccountCash(base, {}, "토스|일반", 0, "2026-10-21"), null);
  assert.equal(addAccountCash({ ...base, cashByAccount: { "토스|일반": 1e9 } }, {}, "토스|일반", 1, "2026-10-21"), null);
  assert.deepEqual(sanitizeCashActivity({
    "토스|일반": [
      { kind: "deposit", before: 10, after: 15, delta: 5, at: "2026-10-21" },
      { kind: "deposit", before: 10, after: 15, delta: -5, at: "2026-10-21" },
      { kind: "other", before: 10, after: 15, delta: 5, at: "2026-10-21" },
    ],
  }), { "토스|일반": [{ kind: "deposit", before: 10, after: 15, delta: 5, at: "2026-10-21" }] });
});

test("확인 기록 정리·키 변환", () => {
  assert.deepEqual(sanitizeCashChecks({ "a|b": { amount: 1.4, at: "2026-10-21" }, bad: { amount: 1, at: "2026-10-21" }, "c|d": { amount: 1, at: "어제" } }), { "a|b": { amount: 1, at: "2026-10-21" } });
  assert.equal(guideCashKey(null, " 인컴계좌(일반) "), "|인컴계좌(일반)");
});
