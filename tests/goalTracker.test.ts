import test from "node:test";
import assert from "node:assert/strict";
import {
  assessMonth,
  basisLine,
  formatGoalLine,
  buildGoalTrackerView,
  chainedReturn,
  compoundingCrossover,
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

test("compoundingCrossover: 100만 + 월 50만, 연 10%면 약 7.2년 뒤 월 수익이 월 입금을 넘는다", () => {
  const c = compoundingCrossover({ equity: 1_000_000, planAnnualPct: 10, monthlyContribution: 500_000 });
  assert.ok(c);
  assert.equal(Math.round(c!.months! / 12 * 10) / 10, 7.2);
  assert.ok(c!.ratioPct < 2);
  // 이미 넘은 계좌는 0개월, 입금이 없으면 null
  assert.equal(compoundingCrossover({ equity: 100_000_000, planAnnualPct: 10, monthlyContribution: 500_000 })!.months, 0);
  assert.equal(compoundingCrossover({ equity: 20_000_000, planAnnualPct: 8, monthlyContribution: 0 }), null);
});

test("buildGoalTrackerView: trail은 시작일 이후 월별 마지막 기록만, 오늘 기록은 빼고 날짜순", () => {
  const v = buildGoalTrackerView({
    file: {
      settings,
      history: [
        { date: "2026-10-31", seed: 1, total: 21_000_000 },
        { date: "2026-09-01", seed: 1, total: 19_000_000 }, // 시작일 전
        { date: "2026-10-02", seed: 1, total: 20_100_000 },
        { date: "2026-09-30", seed: 1, total: 20_000_000 },
        { date: "2026-11-10", seed: 1, total: 21_500_000 }, // 오늘 — equity로 따로 그린다
      ],
    },
    now: { date: "2026-11-10", seed: 1, total: 21_500_000, cash: 0, holdings: 21_500_000 },
    realized: { swing: 0, sweep: 0, sells: 0, wins: 0 },
  });
  assert.deepEqual(v.trail, [
    { date: "2026-09-30", total: 20_000_000 },
    { date: "2026-10-31", total: 21_000_000 },
  ]);
});

test("목표 계산 기준: 목표는 [실제] 내 계좌·구성 과거 이력, 계획선 대비·이번 달은 [가상] 그대로", () => {
  const file = { settings: { ...settings, monthlyContribution: 1_000_000 }, history: [{ date: "2026-09-30", seed: 20_000_000, total: 20_000_000 }] };
  const now = { date: "2026-10-15", seed: 20_000_000, total: 20_400_000, cash: 0, holdings: 20_400_000, mix: [
    { index: "kospi200" as const, weight: 0.5, product: null, account: null },
    { index: "sp500" as const, weight: 0.5, product: null, account: null },
  ] };
  const realized = { swing: 0, sweep: 0, sells: 0, wins: 0 };
  const v = buildGoalTrackerView({ file, now, realized, real: { total: 60_000_000, principal: 50_000_000 } });
  assert.equal(v.basis.assetSource, "real");
  assert.equal(v.equity, 60_000_000);
  assert.ok(Math.abs(v.target.progressPct - 20) < 1e-9); // 6천만 / 3억
  assert.equal(v.basis.rateSource, "history");
  assert.equal(v.basis.rates?.label, "코스피200 50 · S&P500 50");
  assert.equal(v.basis.ratePct, v.basis.rates!.typicalPct);
  assert.equal(v.target.monthsToReach, monthsToReach({ fromEquity: 60_000_000, target: 300_000_000, planAnnualPct: v.basis.ratePct, monthlyContribution: 1_000_000 }));
  // 운 나쁘면 더 늦고, 가정 수익률(8%)로 본 도달도 따로
  assert.ok(v.basis.etaLowMonth! >= v.target.etaMonth!);
  assert.ok(v.basis.etaAssumedMonth != null);
  assert.ok(v.schedule.every((r) => r.contributionLow != null && r.contributionLow >= r.contribution));
  assert.equal(v.progress.principal, 50_000_000);
  // 계획선 대비·이번 달 기대 수익은 [가상] 봇 계좌
  assert.equal(v.basis.virtualEquity, 20_400_000);
  assert.ok(Math.abs(v.plan.gapPct - ((20_400_000 / v.plan.planValue - 1) * 100)) < 0.01);
  assert.equal(v.thisMonth.expectedProfit, Math.round(20_000_000 * monthlyRate(8)));
});

test("목표 계산 기준: 실계좌 기록이 없으면 가상 계좌, 구성이 없으면 코스피200 100% 이력", () => {
  const v = buildGoalTrackerView({
    file: { settings, history: [] },
    now: { date: "2026-10-15", seed: 20_000_000, total: 20_000_000, cash: 0, holdings: 0 },
    realized: { swing: 0, sweep: 0, sells: 0, wins: 0 },
  });
  assert.equal(v.basis.assetSource, "virtual");
  assert.equal(v.equity, 20_000_000);
  assert.equal(v.basis.rates?.label, "코스피200 100");
  assert.match(basisLine(v), /^\[가상\] 계좌 · 내 구성\(코스피200 100\) 2002-10~ 이력 보통 연 [\d.]+%·운 나쁨 [\d.]+%$/);
  assert.match(formatGoalLine(v), /예상 도달 .+ · \[가상\] 계좌 · 내 구성/);
});

test("monthsToReach: 넣는 돈을 해마다 늘리면 더 빨리 닿는다(13번째 달부터)", () => {
  const base = { fromEquity: 0, target: 100_000_000, planAnnualPct: 6, monthlyContribution: 1_000_000 };
  const flat = monthsToReach(base)!;
  const raised = monthsToReach({ ...base, raisePct: 0.05 })!;
  assert.ok(raised < flat);
  // 첫 해는 같다
  assert.equal(monthsToReach({ ...base, target: 5_000_000 }), monthsToReach({ ...base, target: 5_000_000, raisePct: 0.5 }));
});
