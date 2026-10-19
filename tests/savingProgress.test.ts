import test from "node:test";
import assert from "node:assert/strict";
import {
  accountKind,
  distributionTaxSaved,
  doneMonths,
  extraUnitsPct,
  isTotalReturnEtf,
  monthGrid,
  pensionCredit,
  streak,
} from "../src/lib/savingProgress";

test("계좌 종류: ISA·연금·IRP·퇴직을 구분하고 나머지는 일반", () => {
  assert.equal(accountKind("미래 / ISA"), "isa");
  assert.equal(accountKind("삼성 / 연금저축"), "pension");
  assert.equal(accountKind("키움 / IRP"), "pension");
  assert.equal(accountKind("인컴계좌(일반)"), "general");
  assert.equal(accountKind(null), "general");
});

test("TR형 이름: 200TR·토탈리턴은 TR, TRUSTON 같은 이름은 아님", () => {
  assert.ok(isTotalReturnEtf("KODEX 200TR"));
  assert.ok(isTotalReturnEtf("KIWOOM 200TR"));
  assert.ok(isTotalReturnEtf("ACE 토탈리턴"));
  assert.ok(!isTotalReturnEtf("KODEX 200"));
  assert.ok(!isTotalReturnEtf("TRUSTON 주주가치액티브"));
});

test("넣은 달: 체크인(0원 제외)과 실계좌 순매수 달을 합친다", () => {
  const d = doneMonths({ deposits: [["2026-08", 500_000], ["2026-09", 0]], buyMonths: ["2026-10"] });
  assert.deepEqual([...d].sort(), ["2026-08", "2026-10"]);
});

test("연속: 이번 달을 아직 안 넣었으면 지난달까지 연속을 끊지 않고 '남음'으로 둔다", () => {
  const done = new Set(["2026-07", "2026-08", "2026-09"]);
  assert.deepEqual(streak(done, "2026-10"), { count: 3, pendingThisMonth: true });
  done.add("2026-10");
  assert.deepEqual(streak(done, "2026-10"), { count: 4, pendingThisMonth: false });
  // 한 달 빠지면 그 뒤부터 다시 센다
  assert.deepEqual(streak(new Set(["2026-06", "2026-08", "2026-09"]), "2026-10"), { count: 2, pendingThisMonth: true });
  // 해를 넘어가도 이어진다
  assert.equal(streak(new Set(["2025-12", "2026-01"]), "2026-01").count, 2);
  assert.equal(streak(new Set(), "2026-10").count, 0);
});

test("달력: 첫 기록 전은 '기록 없음', 그 뒤 빠진 달만 '쉰 달', 이번 달은 '남음', 앞으로는 비움", () => {
  const grid = monthGrid(new Set(["2026-08", "2026-10"]), "2026-11", 2);
  assert.equal(grid.length, 2);
  assert.equal(grid[0].year, 2025);
  const y26 = Object.fromEntries(grid[1].months.map((c) => [c.ym, c.state]));
  assert.equal(y26["2026-07"], "before");
  assert.equal(y26["2026-08"], "done");
  assert.equal(y26["2026-09"], "missed");
  assert.equal(y26["2026-10"], "done");
  assert.equal(y26["2026-11"], "pending");
  assert.equal(y26["2026-12"], "future");
  assert.ok(grid[0].months.every((c) => c.state === "before"));
});

test("연금 세액공제: 900만원 한도, 13.2%·16.5%", () => {
  assert.deepEqual(pensionCredit(9_000_000), { base: 9_000_000, low: 1_188_000, high: 1_485_000 });
  assert.deepEqual(pensionCredit(12_000_000), { base: 9_000_000, low: 1_188_000, high: 1_485_000 });
  assert.equal(pensionCredit(6_000_000).low, 792_000);
  assert.equal(pensionCredit(-1).base, 0);
});

test("분배금 세금 덜 내는 돈: 일반 계좌 TR은 같은 지수 분배율로, ISA·연금은 그 종목 분배율로, 일반 계좌 일반형은 0", () => {
  const out = distributionTaxSaved(
    [
      { value: 10_000_000, accountKind: "general", isTR: true, yieldPct: 0 },
      { value: 10_000_000, accountKind: "general", isTR: false, yieldPct: 2 },
      { value: 5_000_000, accountKind: "isa", isTR: false, yieldPct: 4 },
      { value: 5_000_000, accountKind: "pension", isTR: true, yieldPct: 0 },
    ],
    2,
  );
  assert.equal(out.tr, Math.round(10_000_000 * 0.02 * 0.154));
  assert.equal(out.isa, Math.round(5_000_000 * 0.04 * 0.154));
  assert.equal(out.pension, Math.round(5_000_000 * 0.02 * 0.154));
  assert.deepEqual(distributionTaxSaved([{ value: 1_000_000, accountKind: "general", isTR: true, yieldPct: 0 }], null), { tr: 0, isa: 0, pension: 0 });
});

test("고점 대비 하락이면 같은 돈으로 더 많은 수량: −20%면 25% 더, 하락 아니면 0", () => {
  assert.ok(Math.abs(extraUnitsPct(-20) - 25) < 1e-9);
  assert.ok(Math.abs(extraUnitsPct(-21.6) - 27.55) < 0.01);
  assert.equal(extraUnitsPct(0), 0);
  assert.equal(extraUnitsPct(3), 0);
});
