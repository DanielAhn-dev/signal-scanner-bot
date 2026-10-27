import test from "node:test";
import assert from "node:assert/strict";
import { annualDistribution, incomeTargetPlan, splitAmount, FINANCIAL_INCOME_LIMIT } from "../src/lib/incomeTarget";

const MAN = 10_000;
// 누적 1·3·6·9·14·20·31·43 | 59·76·116·166·266 (만원)
const FIXED = [
  ["쿠팡 와우", 1], ["KT 인터넷", 2], ["어린이보험", 3], ["둘째 어린이보험", 3], ["통신비", 5], ["암보험", 6], ["실손보험", 11], ["피아노 학원", 12],
  ["태권도 학원", 16], ["대출금", 17], ["용돈", 40], ["대성학원", 50], ["손주 돌봄비", 100],
].map(([label, m]) => ({ label: label as string, amount: (m as number) * MAN }));
/** 세후 월 56만원이 되는 일반 계좌 연 분배금(세전) */
const GROSS_FOR_56 = (56 * MAN * 12) / (1 - 0.154);

test("세후 월 56만원이면 8번까지 덮고 9번까지는 3만원이 모자란다", () => {
  const plan = incomeTargetPlan({ fixed: FIXED, targetLabel: "대성학원", taxProfile: "worker", generalGrossAnnual: GROSS_FOR_56, yieldPct: 10 });
  assert.equal(plan.ladder.passedCount, 8);
  assert.equal(plan.next?.label, "태권도 학원");
  assert.equal(Math.round(plan.next!.gapMonthly), 3 * MAN);
  // 월 3만원 = 연 36만원 ÷ 0.846 ÷ 10% ≈ 426만원
  assert.ok(Math.abs(plan.next!.extraCapital - 4_255_319) < 2_000);
});

test("직장가입자 2천만원 선: 세후 월 141만원이 한도라 12번(166만원)은 한도를 넘는다", () => {
  const plan = incomeTargetPlan({ fixed: FIXED, targetLabel: "대성학원", taxProfile: "worker", generalGrossAnnual: GROSS_FOR_56, yieldPct: 10 });
  // 여유 선 90% = 1,800만원 → 세후 월 약 126.9만원
  assert.ok(Math.abs(plan.maxMonthly - 1_269_000) < 2_000);
  assert.equal(plan.target?.label, "대성학원");
  assert.equal(plan.target?.withinLimit, false);
  const eleven = incomeTargetPlan({ fixed: FIXED, targetLabel: "용돈", taxProfile: "worker", generalGrossAnnual: GROSS_FOR_56, yieldPct: 10 });
  assert.equal(eleven.target?.withinLimit, true);
});

test("지역가입자 1천만원 선: 56만원이면 이미 선의 80%를 넘는다", () => {
  const plan = incomeTargetPlan({ fixed: FIXED, targetLabel: null, taxProfile: "regional", generalGrossAnnual: GROSS_FOR_56, yieldPct: 10 });
  assert.equal(FINANCIAL_INCOME_LIMIT.regional, 10_000_000);
  assert.equal(plan.status, "near");
  assert.equal(plan.target, null);
  // 9번(59만원)은 여유 선(세후 월 약 63.5만원) 안
  assert.equal(plan.next?.withinLimit, true);
  assert.equal(incomeTargetPlan({ fixed: FIXED, targetLabel: null, taxProfile: "regional", generalGrossAnnual: 10_500_000, yieldPct: 10 }).status, "over");
});

test("일반 계좌에 더 담을 수 있는 원금은 선까지 남은 분배금 ÷ 분배율", () => {
  const plan = incomeTargetPlan({ fixed: FIXED, targetLabel: null, taxProfile: "worker", generalGrossAnnual: 8_000_000, yieldPct: 10 });
  assert.equal(plan.roomCapital, 100_000_000); // (1,800만 − 800만) ÷ 10%
  assert.equal(incomeTargetPlan({ fixed: FIXED, targetLabel: null, taxProfile: "worker", generalGrossAnnual: 19_000_000, yieldPct: 10 }).roomCapital, 0);
});

test("목표 이름이 사다리에 없으면 목표 없음, 분배율 0이면 필요 원금 0", () => {
  const plan = incomeTargetPlan({ fixed: FIXED, targetLabel: "없는 칸", taxProfile: "worker", generalGrossAnnual: 0, yieldPct: 0 });
  assert.equal(plan.target, null);
  assert.equal(plan.next?.extraCapital, 0);
  assert.equal(plan.status, "ok");
});

test("연 분배금 — TR형과 분배율 없는 보유는 지급이 없어 뺀다", () => {
  const d = annualDistribution([
    { value: 100_000_000, accountKind: "general", isTR: false, yieldPct: 10 },
    { value: 50_000_000, accountKind: "general", isTR: true, yieldPct: 2 },
    { value: 20_000_000, accountKind: "isa", isTR: false, yieldPct: 5 },
    { value: 30_000_000, accountKind: "pension", isTR: false, yieldPct: 0 },
  ]);
  assert.deepEqual(d, { general: 10_000_000, isa: 1_000_000, pension: 0 });
});

const row = (code: string, verdict: string, value: number, familySharePct: number) => ({ code, name: code, verdict, value, familySharePct });

test("더 담을 금액 나누기 — 담을 후보에게 균등하게, 후보가 아닌 상품은 제외", () => {
  const r = splitAmount([row("A", "add", 30_000_000, 30), row("B", "add", 30_000_000, 30), row("C", "caution", 40_000_000, 40)], 6_000_000);
  // 계열 비중이 같아 상한을 나눠 써도 여유가 있다 → 300만씩
  assert.deepEqual(r.parts.map((p) => p.amount), [3_000_000, 3_000_000]);
  assert.equal(r.leftover, 0);
});

test("더 담을 금액 나누기 — 담은 뒤 같은 계열이 40%를 넘지 않게 자르고 남은 몫을 알려 준다", () => {
  // 총 1억, A 계열 35%. 3,000만 더 담으면 총 1.3억의 40% = 5,200만 → A는 1,700만까지만
  const r = splitAmount([row("A", "add", 35_000_000, 35), row("B", "caution", 65_000_000, 65)], 30_000_000);
  assert.equal(r.parts.length, 1);
  assert.equal(r.parts[0].amount, 17_000_000);
  assert.equal(r.leftover, 13_000_000);
});

test("더 담을 금액 나누기 — 후보가 없으면 전부 못 나눈 몫", () => {
  const r = splitAmount([row("A", "caution", 50_000_000, 50), row("B", "wait", 50_000_000, 50)], 5_000_000);
  assert.deepEqual(r, { parts: [], leftover: 5_000_000 });
  assert.deepEqual(splitAmount([], 1_000_000), { parts: [], leftover: 1_000_000 });
});
