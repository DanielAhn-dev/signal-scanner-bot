import test from "node:test";
import assert from "node:assert/strict";
import { computeDistributionStats, type DistRow } from "../src/lib/distributionStats";
import { buildIncomeCheck, type IncomeCheckInput } from "../src/lib/incomeProductCheck";

const rowsOf = (start: string, values: number[]): DistRow[] =>
  values.map((v, i) => ({ record_date: new Date(Date.parse(start) + i * 30.44 * 86_400_000).toISOString().slice(0, 10), per_share: v }));
const TODAY = "2026-10-26";
const stats = (code: string, start: string, values: number[]) => computeDistributionStats(code, rowsOf(start, values), TODAY);

const base = (o: Partial<IncomeCheckInput> & Pick<IncomeCheckInput, "code" | "name">): IncomeCheckInput => ({
  value: 10_000_000, price: 10_000, family: o.code, yieldPct: 10, yieldSource: "history", stats: null, price3mPct: -10, ...o,
});

// 안정(KODEX 미국배당타겟형): 28회 평탄
const STEADY = Array.from({ length: 28 }, (_, i) => 100 + (i % 3) * 3);
// 하락 중(SOL 200타겟형): 250 → 170
const FALLING = [250, 217, 223, 150, 168, 170];
// 급증(밸류업형): 13회 105 → 590 → 465
const SURGE = [105, 210, 125, 190, 310, 400, 340, 390, 420, 590, 580, 540, 465];

test("이력 6회 미만이거나 이력이 없으면 판단 보류", () => {
  const rows = buildIncomeCheck([
    base({ code: "A", name: "신규", stats: stats("A", "2026-07-31", [153, 167, 175]) }),
    base({ code: "B", name: "이력없음", stats: null }),
  ]);
  assert.deepEqual(rows.map((r) => r.verdict), ["wait", "wait"]);
  assert.ok(rows.find((r) => r.code === "A")!.reasons[0].includes("3회"));
});

test("분배가 줄고 있거나 1년 새 급증했으면 주의", () => {
  const rows = buildIncomeCheck([
    base({ code: "F", name: "하락", stats: stats("F", "2026-04-30", FALLING) }),
    base({ code: "S", name: "급증", stats: stats("S", "2025-10-15", SURGE) }),
  ]);
  const by = Object.fromEntries(rows.map((r) => [r.code, r]));
  assert.equal(by.F.verdict, "caution");
  assert.ok(by.F.reasons.some((r) => r.includes("줄었습니다")));
  assert.equal(by.S.verdict, "caution");
  assert.ok(by.S.reasons.some((r) => r.includes("배가 됐습니다")));
});

test("안정적이고 같은 계열 비중이 낮으면 담을 후보, 계열이 이미 크면 유지", () => {
  const steady = stats("U", "2024-06-28", STEADY);
  const solo = buildIncomeCheck([
    base({ code: "U", name: "미국배당", stats: steady, value: 3_000_000 }),
    base({ code: "K", name: "코스피200위클리", stats: steady, value: 7_000_000 }),
  ]);
  assert.equal(solo.find((r) => r.code === "U")!.verdict, "add");
  assert.equal(solo.find((r) => r.code === "K")!.verdict, "keep"); // 70%라 쏠림
  assert.ok(solo.find((r) => r.code === "K")!.reasons[0].includes("쏠립니다"));
  // 같은 계열 두 상품은 합쳐서 본다
  const fam = buildIncomeCheck([
    base({ code: "K1", name: "A", family: "kospi-weekly", stats: steady, value: 3_000_000 }),
    base({ code: "K2", name: "B", family: "kospi-weekly", stats: steady, value: 3_000_000 }),
    base({ code: "U", name: "C", stats: steady, value: 4_000_000 }),
  ]);
  assert.equal(fam.find((r) => r.code === "K1")!.familySharePct, 60);
  assert.equal(fam[0].code, "U");
});

test("3개월 총수익은 가격수익률에 최근 3개월 분배금을 더한다", () => {
  const st = stats("U", "2024-06-28", STEADY)!;
  const r = buildIncomeCheck([base({ code: "U", name: "미국배당", stats: st, price: 10_100, price3mPct: -3.21 })])[0];
  const start = 10_100 / (1 - 0.0321);
  assert.ok(Math.abs(r.total3mPct! - (-3.21 + (st.sum3m / start) * 100)) < 0.001);
  assert.ok(r.total3mPct! > -3.21);
});

test("리포트 문장: 후보·주의·보류를 나눠 적고, 점검 행이 없으면 아무것도 쓰지 않는다", async () => {
  const { incomeCheckLines } = await import("../src/lib/incomeProductCheck");
  assert.deepEqual(incomeCheckLines([]), []);
  const rows = buildIncomeCheck([
    base({ code: "U", name: "미국배당", stats: stats("U", "2024-06-28", STEADY), value: 2_000_000 }),
    base({ code: "F", name: "하락", stats: stats("F", "2026-04-30", FALLING), value: 3_000_000 }),
    base({ code: "N", name: "이력없음", stats: null, value: 1_000_000 }),
  ]);
  const lines = incomeCheckLines(rows);
  assert.ok(lines[0].includes("미국배당"));
  assert.ok(lines.some((l) => l.startsWith("주의 — 하락")));
  assert.ok(lines.some((l) => l.includes("보류한 상품 1개")));
});
