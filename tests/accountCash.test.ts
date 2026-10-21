import { test } from "node:test";
import assert from "node:assert/strict";
import { accountCashRows, guideCashKey, sanitizeCashChecks, setAccountCash } from "../src/lib/accountCash";
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
  const rows = accountCashRows(after.settings, set.checks, ["토스|일반", "NH|CMA"]);
  assert.deepEqual(rows.find((r) => r.key === "토스|일반"), { key: "토스|일반", amount: 660_170, checkedAt: "2026-10-21", sinceCheck: 160_170 });
  assert.deepEqual(rows.find((r) => r.key === "NH|CMA"), { key: "NH|CMA", amount: 0, checkedAt: null, sinceCheck: null });
});

test("확인 기록 정리·키 변환", () => {
  assert.deepEqual(sanitizeCashChecks({ "a|b": { amount: 1.4, at: "2026-10-21" }, bad: { amount: 1, at: "2026-10-21" }, "c|d": { amount: 1, at: "어제" } }), { "a|b": { amount: 1, at: "2026-10-21" } });
  assert.equal(guideCashKey(null, " 인컴계좌(일반) "), "|인컴계좌(일반)");
});
