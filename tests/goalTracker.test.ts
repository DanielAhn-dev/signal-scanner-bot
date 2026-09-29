import test from "node:test";
import assert from "node:assert/strict";
import {
  assessMonth,
  buildGoalTrackerView,
  chainedReturn,
  monthlyRate,
  monthsToReach,
  monthToDateReturn,
  monthsUntil,
  planValueAt,
  requiredMonthlyContribution,
  requiredSeed,
  sanitizeGoalSettings,
  type GoalSettings,
} from "../src/services/goalTracker";

const settings: GoalSettings = {
  startDate: "2026-09-29",
  startEquity: 20_000_000,
  planAnnualPct: 8,
  targetMonthlyProfit: 1_000_000,
  monthlyContribution: 0,
};

test("requiredSeed: 인출률 기준 — 월 50만원 × 12 ÷ 4% = 1.5억", () => {
  assert.ok(Math.abs(monthlyRate(8) - 0.006434) < 1e-5);
  assert.equal(requiredSeed(500_000, 4), 150_000_000);
  assert.equal(requiredSeed(1_000_000, 8), 150_000_000);
});

test("planValueAt·monthsToReach: 12개월 뒤 8%, 2천만→1.56억은 입금 없으면 약 27년", () => {
  assert.ok(Math.abs(planValueAt(settings, 12) - 21_600_000) < 1);
  const n = monthsToReach({ fromEquity: 20_000_000, target: requiredSeed(1_000_000, 7.7), planAnnualPct: 8, monthlyContribution: 0 });
  assert.ok(n != null && n > 300 && n < 340, String(n));
  const withContrib = monthsToReach({ fromEquity: 20_000_000, target: requiredSeed(1_000_000, 7.7), planAnnualPct: 8, monthlyContribution: 1_000_000 });
  assert.ok(withContrib != null && withContrib < 110, String(withContrib));
});

test("chainedReturn·monthToDateReturn: 입금으로 시드가 바뀐 날은 수익에서 뺀다", () => {
  const history = [
    { date: "2026-09-30", seed: 20_000_000, total: 20_000_000 },
    { date: "2026-10-05", seed: 20_000_000, total: 21_000_000 }, // +5%
    { date: "2026-10-06", seed: 30_000_000, total: 31_000_000 }, // 1천만 입금 — 무시
    { date: "2026-10-07", seed: 30_000_000, total: 31_310_000 }, // +1%
  ];
  const r = monthToDateReturn(history, "2026-10-07");
  assert.ok(r != null && Math.abs(r - (1.05 * 1.01 - 1)) < 1e-9);
  assert.equal(chainedReturn([history[0]]), null);
});

test("assessMonth: 마이너스 달도 과거 분포로 흔한 달인지 구분", () => {
  assert.equal(assessMonth(1.2)?.level, "good");
  assert.equal(assessMonth(-1.0)?.level, "normal");
  assert.equal(assessMonth(-3.0)?.level, "weak");
  assert.equal(assessMonth(-9.0)?.level, "rare");
  assert.equal(assessMonth(null), null);
});

test("sanitizeGoalSettings: 범위를 벗어난 값은 잘라내고 빈 값은 유지", () => {
  const s = sanitizeGoalSettings({ planAnnualPct: 40, targetMonthlyProfit: "" as any, monthlyContribution: -5 }, settings);
  assert.equal(s.planAnnualPct, 15);
  assert.equal(s.targetMonthlyProfit, 1_000_000);
  assert.equal(s.monthlyContribution, 0);
});

test("buildGoalTrackerView: 진행률·계획선·이번 달 기대 수익", () => {
  const v = buildGoalTrackerView({
    file: { settings, history: [{ date: "2026-09-30", seed: 20_000_000, total: 20_000_000 }, { date: "2026-10-15", seed: 20_000_000, total: 20_400_000 }] },
    now: { date: "2026-10-15", seed: 20_000_000, total: 20_400_000, cash: 1_000_000, holdings: 19_400_000 },
    realized: { swing: 150_000, sweep: 20_000, sells: 3, wins: 2 },
  });
  // 월 100만원 × 12 ÷ 4% = 3억 → 2,040만 / 3억 = 6.8%
  assert.ok(Math.abs(v.target.progressPct - 6.8) < 1e-9, String(v.target.progressPct));
  assert.equal(v.thisMonth.expectedProfit, Math.round(20_000_000 * monthlyRate(8)));
  assert.ok(v.thisMonth.returnPct != null && Math.abs(v.thisMonth.returnPct - 2) < 1e-9);
  assert.ok(v.plan.gapPct > 1);
});

test("requiredMonthlyContribution: planValueAt으로 되돌리면 정확히 필요 시드", () => {
  const need = requiredSeed(500_000, 4);
  const c = requiredMonthlyContribution({ fromEquity: 20_000_000, target: need, planAnnualPct: 8, months: 24 });
  const back = planValueAt({ ...settings, startEquity: 20_000_000, monthlyContribution: c }, 24);
  assert.ok(Math.abs(back - need) < 1, String(back - need));
  assert.equal(requiredMonthlyContribution({ fromEquity: need, target: need, planAnnualPct: 8, months: 12 }), 0);
  assert.equal(monthsUntil("2026-09-29", "2028-09"), 24);
});

test("buildGoalTrackerView: 1차 단계·목표 시점 필요 입금, 도달하면 2차", () => {
  const base = {
    file: { settings: { ...settings, targetMonthlyProfit: 500_000, targetDate: "2028-03" }, history: [] },
    realized: { swing: 0, sweep: 0, sells: 0, wins: 0 },
  };
  const v = buildGoalTrackerView({ ...base, now: { date: "2026-09-29", seed: 20_000_000, total: 20_000_000, cash: 0, holdings: 0 } });
  assert.equal(v.phase.stage, 1);
  assert.deepEqual(v.schedule.map((r) => r.months), [12, 18, 24, 36, 60]);
  assert.equal(v.schedule.find((r) => r.isTarget)?.month, "2028-03");
  assert.ok(v.schedule[0].contribution > v.schedule[4].contribution);
  const v2 = buildGoalTrackerView({ ...base, now: { date: "2026-09-29", seed: 150_000_000, total: 150_000_000, cash: 0, holdings: 0 } });
  assert.equal(v2.phase.stage, 2);
  assert.equal(v2.schedule.length, 0);
});

test("sanitizeGoalSettings: 목표 시점은 YYYY-MM만, 빈 문자열은 해제", () => {
  assert.equal(sanitizeGoalSettings({ targetDate: "2028-09" }, settings).targetDate, "2028-09");
  assert.equal(sanitizeGoalSettings({ targetDate: "내년" }, { ...settings, targetDate: "2028-09" }).targetDate, "2028-09");
  assert.equal(sanitizeGoalSettings({ targetDate: "" }, { ...settings, targetDate: "2028-09" }).targetDate, undefined);
});

test("buildGoalTrackerView: 월 자동 입금을 설정한 계정은 그 금액이 계획의 월 입금, 없으면 목표 트래커 값(거치식)", () => {
  const base = {
    file: { settings, history: [{ date: "2026-09-30", seed: 20_000_000, total: 20_000_000 }] },
    realized: { swing: 0, sweep: 0, sells: 0, wins: 0 },
  };
  const now = { date: "2026-10-15", seed: 20_000_000, total: 20_000_000, cash: 20_000_000, holdings: 0 };
  const lumpSum = buildGoalTrackerView({ ...base, now: { ...now, monthlyDeposit: null } });
  assert.equal(lumpSum.contributionLinked, false);
  assert.equal(lumpSum.settings.monthlyContribution, settings.monthlyContribution);
  const saving = buildGoalTrackerView({ ...base, now: { ...now, monthlyDeposit: 300_000 } });
  assert.equal(saving.contributionLinked, true);
  assert.equal(saving.settings.monthlyContribution, 300_000);
  assert.ok((saving.target.monthsToReach ?? Infinity) < (lumpSum.target.monthsToReach ?? Infinity) || settings.monthlyContribution >= 300_000);
});
