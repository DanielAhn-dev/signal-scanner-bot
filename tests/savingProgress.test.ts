import test from "node:test";
import assert from "node:assert/strict";
import {
  accountKind,
  costLadder,
  distributionTaxSaved,
  doneMonths,
  dropMonths,
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

test("고정비 사다리: 작은 것부터 쌓고, 같은 이름은 합치고, 0원·환급은 뺀다", () => {
  // 원금 3,000만 × 4% ÷ 12 = 월 10만
  const r = costLadder({
    fixed: [
      { label: "관리비", amount: 250_000 },
      { label: "휴대폰", amount: 50_000 },
      { label: "휴대폰", amount: 30_000 },
      { label: "영상·음악", amount: 0 },
      { label: "", amount: 10_000 },
      { label: "보험", amount: 150_000 },
    ],
    principal: 30_000_000,
    withdrawalPct: 4,
    addedThisMonth: 0,
  });
  assert.equal(Math.round(r.monthly), 100_000);
  assert.deepEqual(r.rungs.map((x) => [x.label, x.cumulative]), [["휴대폰", 80_000], ["보험", 230_000], ["관리비", 480_000]]);
  assert.equal(r.passedCount, 1);
  assert.equal(r.next?.label, "보험");
  assert.equal(Math.round(r.next!.pct), 43); // 10만 / 누적 23만
  assert.equal(r.newlyPassed, null);
});

test("고정비 사다리: 이번 달 넣은 돈으로 새로 넘은 칸만 알려 준다", () => {
  const fixed = [{ label: "휴대폰", amount: 80_000 }, { label: "보험", amount: 150_000 }];
  // 이번 달 전 원금 2,000만(월 6.7만) → 지금 3,000만(월 10만): 휴대폰을 이번 달에 넘음
  const a = costLadder({ fixed, principal: 30_000_000, withdrawalPct: 4, addedThisMonth: 10_000_000 });
  assert.equal(a.newlyPassed?.label, "휴대폰");
  // 이미 지난달에 넘었으면 다시 알리지 않는다
  const b = costLadder({ fixed, principal: 30_000_000, withdrawalPct: 4, addedThisMonth: 1_000_000 });
  assert.equal(b.newlyPassed, null);
});

test("고정비 사다리: 다 넘으면 next 없음, 원금 0이면 0칸", () => {
  const fixed = [{ label: "휴대폰", amount: 50_000 }];
  assert.equal(costLadder({ fixed, principal: 100_000_000, withdrawalPct: 4, addedThisMonth: 0 }).next, null);
  const z = costLadder({ fixed, principal: 0, withdrawalPct: 4, addedThisMonth: 0 });
  assert.equal(z.passedCount, 0);
  assert.equal(z.next?.pct, 0);
  assert.deepEqual(costLadder({ fixed: [], principal: 1e8, withdrawalPct: 4, addedThisMonth: 0 }).rungs, []);
});

test("빠진 달: 최근 고점 대비 −10% 이하인 날이 있던 달만, 고점 창이 차기 전은 판정 안 함", () => {
  const days: Array<{ date: string; close: number }> = [];
  const push = (ym: string, n: number, close: number) => { for (let d = 1; d <= n; d += 1) days.push({ date: `${ym}-${String(d).padStart(2, "0")}`, close }); };
  push("2026-01", 3, 100);
  push("2026-02", 3, 95); // −5%
  push("2026-03", 3, 89); // −11%
  push("2026-04", 3, 99);
  const r = dropMonths(days, -10, 7); // 7거래일 창이라 3월 1일부터 1월 고점까지 본다
  assert.deepEqual(r.months, ["2026-03"]);
  assert.equal(r.since, "2026-03");
  assert.deepEqual(dropMonths(days.slice(0, 2), -10, 3), { months: [], since: null });
});
