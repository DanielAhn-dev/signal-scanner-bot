import { test } from "node:test";
import assert from "node:assert/strict";
import { accountCashRows, addAccountCash, guideCashKey, sanitizeCashActivity, sanitizeCashChecks, setAccountCash } from "../src/lib/accountCash";
import { applyReceiptToCash, applyTradeToCash, DEFAULT_INCOME_GUIDE_SETTINGS, readCashUpdatedAt } from "../src/lib/incomeGuide";
import { loadGuideFile, saveGuideFile } from "../src/services/incomeGuideStore";

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

test("cashUpdatedAt은 파일을 저장했다 불러와도 남고, 그 날짜 이전 체결은 예수금을 또 깎지 않는다", async () => {
  // 메모리 저장소로 대체한 Storage — loadGuideFile/saveGuideFile이 쓰는 download/upload만 흉내 낸다
  const store = new Map<string, string>();
  const supabase = {
    storage: {
      from: () => ({
        download: async (path: string) => (store.has(path) ? { data: { text: async () => store.get(path)! }, error: null } : { data: null, error: { message: "not found" } }),
        upload: async (path: string, body: string) => { store.set(path, body); return { error: null }; },
      }),
    },
  };
  const key = "|인컴계좌(일반)";
  const set = setAccountCash({ ...DEFAULT_INCOME_GUIDE_SETTINGS, cashByAccount: { [key]: 3_538_148 } }, {}, key, 2_222_790, "2026-10-26")!;
  assert.equal(await saveGuideFile(supabase, 1, { settings: set.settings, history: [], cashChecks: set.checks, cashActivity: set.activity } as any), null);

  const loaded = await loadGuideFile(supabase, 1);
  assert.equal(loaded?.settings.cashUpdatedAt, "2026-10-26");
  // 지난 날짜(10/20) 매수는 이미 잔액에 들어 있다고 보고 건드리지 않는다. 오늘 체결은 반영한다
  assert.equal(applyTradeToCash(loaded!.settings, { accountKey: key, side: "BUY", netAmount: 15_762, tradeDate: "2026-10-20" }), null);
  assert.equal(applyTradeToCash(loaded!.settings, { accountKey: key, side: "BUY", netAmount: 32_605, tradeDate: "2026-10-26" })?.after, 2_190_185);

  // 다시 저장해도 지워지지 않는다(예전에는 불러올 때 버려져 다음 저장에서 파일에서도 사라졌다)
  await saveGuideFile(supabase, 1, loaded!);
  assert.equal((await loadGuideFile(supabase, 1))?.settings.cashUpdatedAt, "2026-10-26");

  assert.equal(readCashUpdatedAt("2026-10-26"), "2026-10-26");
  assert.equal(readCashUpdatedAt("어제"), undefined);
  assert.equal(readCashUpdatedAt(undefined), undefined);
});
