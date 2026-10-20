import { test } from "node:test";
import assert from "node:assert/strict";
import {
  accountMonthlyContribution,
  applyAccountKinds,
  guessAccountKind,
  labelWithKind,
  listGuideAccounts,
  resolveGuideAccount,
  sanitizeAccountGuideMap,
  sanitizeAccountTargets,
  scopeSettingsToAccount,
} from "../src/lib/guideAccountScope";
import { DEFAULT_INCOME_GUIDE_SETTINGS, buildIncomeGuideView, isTaxAdvantagedAccount, type IncomeGuideSettings } from "../src/lib/incomeGuide";

const base: IncomeGuideSettings = {
  ...DEFAULT_INCOME_GUIDE_SETTINGS,
  monthlyContribution: 1_000_000,
  cashBalance: 300_000,
  cashByAccount: { "미래|내 일반": 500_000, "키움|아내": 200_000 },
};

test("계좌 하나로 좁히면 예수금은 그 계좌 것만, 계좌 미지정 예전 값은 뺀다", () => {
  const s = scopeSettingsToAccount(base, {}, "키움|아내", "미래|내 일반");
  assert.deepEqual(s.cashByAccount, { "키움|아내": 200_000 });
  assert.equal(s.cashBalance, undefined);
  // 아무 계좌에도 적지 않은 공통 월 입금은 가장 큰 계좌에만
  assert.equal(s.monthlyContribution, undefined);
  assert.equal(scopeSettingsToAccount(base, {}, "미래|내 일반", "미래|내 일반").monthlyContribution, 1_000_000);
});

test("한 계좌라도 월 입금을 적으면 공통 값은 어느 계좌에도 붙지 않는다", () => {
  const accounts = { "키움|아내": { monthlyContribution: 300_000 } };
  assert.deepEqual(accountMonthlyContribution(base, accounts, "키움|아내", "미래|내 일반"), { amount: 300_000, source: "account" });
  assert.deepEqual(accountMonthlyContribution(base, accounts, "미래|내 일반", "미래|내 일반"), { amount: 0, source: "none" });
});

test("계좌 목표는 공통 설정을 덮어쓰고, 공통 설정을 나중에 고쳐도 섞이지 않는다", () => {
  const targets = sanitizeAccountTargets({ customTargets: { income: 60 }, overseasPct: 0, monthlyNeed: 300_000 }, base);
  assert.equal(targets.customTargets?.income, 60);
  assert.equal(targets.overseasPct, 0);
  assert.equal(targets.satelliteCapPct, base.satelliteCapPct); // 통째로 저장
  const later = { ...base, satelliteCapPct: 30 };
  const s = scopeSettingsToAccount(later, { "키움|아내": { targets } }, "키움|아내", null);
  assert.equal(s.satelliteCapPct, base.satelliteCapPct);
  assert.equal(s.overseasPct, 0);
});

test("저장 파일의 계좌 맵에서 잘못된 키·값은 버린다", () => {
  const m = sanitizeAccountGuideMap({ nokey: { kind: "isa" }, "a|b": { kind: "bad", monthlyContribution: -1 }, "c|d": { kind: "irp", history: [] } }, base);
  assert.deepEqual(Object.keys(m), ["c|d"]);
  assert.equal(m["c|d"].kind, "irp");
});

test("계좌 종류: 이름 추정과 고른 종류가 절세 판정에 반영된다", () => {
  assert.equal(guessAccountKind("미래 / 연금저축"), "pension");
  assert.equal(guessAccountKind("키움 / ISA 중개형"), "isa");
  assert.equal(guessAccountKind("한투 / 내 통장"), "general");
  // 이름에 드러나지 않는 ISA
  const isa = labelWithKind("한투 / 절세", "isa");
  assert.equal(isa, "한투 / 절세 (ISA)");
  assert.equal(isTaxAdvantagedAccount(isa), true);
  // 이름에 '연금'이 있어도 일반으로 고르면 절세가 아니다
  const general = labelWithKind("미래 / 연금 모으기", "general");
  assert.equal(isTaxAdvantagedAccount(general), false);
  // 이미 이름과 같은 종류면 붙이지 않는다
  assert.equal(labelWithKind("키움 / ISA", "isa"), "키움 / ISA");
});

test("계좌 고르기: 큰 순, 모르는 키는 가장 큰 계좌, __all은 합산", () => {
  const holdings = applyAccountKinds(
    [
      { accountKey: "a|x", accountLabel: "a / x", quantity: 10, price: 1000 },
      { accountKey: "b|y", accountLabel: "b / y", quantity: 10, price: 5000 },
    ],
    { "a|x": { kind: "isa" } },
  );
  const list = listGuideAccounts(holdings, { "a|x": { kind: "isa", targets: {} } }, { "a|x": 100_000 });
  assert.deepEqual(list.map((a) => a.key), ["a|x", "b|y"]); // 예수금 포함 110,000 > 50,000
  assert.equal(list[0].kind, "isa");
  assert.equal(list[0].kindChosen, true);
  assert.equal(list[0].ownTargets, true);
  assert.equal(list[1].kind, "general");
  assert.equal(resolveGuideAccount("b|y", list), "b|y");
  assert.equal(resolveGuideAccount("auto", list), "a|x");
  assert.equal(resolveGuideAccount("__all", list), null);
});

test("계좌별 보기 비중은 그 계좌 보유만으로 100%가 된다", () => {
  const holdings = [
    { code: "069500", name: "KODEX 200", quantity: 100, price: 40_000, avgPrice: 35_000, accountKey: "a|x", accountLabel: "a / x" },
    { code: "441640", name: "KODEX 미국배당커버드콜액티브", quantity: 100, price: 12_000, avgPrice: 12_000, accountKey: "b|y", accountLabel: "b / y" },
  ];
  const settings = scopeSettingsToAccount({ ...base, cashByAccount: { "a|x": 900_000, "b|y": 200_000 } }, {}, "b|y", "a|x");
  const view = buildIncomeGuideView({ holdings: holdings.filter((h) => h.accountKey === "b|y"), settings, today: "2026-10-20" });
  assert.equal(view.accounts.length, 1);
  const income = view.groups.find((g) => g.group === "income")!;
  const cash = view.groups.find((g) => g.group === "cash")!;
  // 보유 120만 + 이 계좌 예수금 20만
  assert.equal(view.total, 1_400_000);
  assert.ok(Math.abs(income.actualPct + cash.actualPct - 100) < 0.01);
});
