import test from "node:test";
import assert from "node:assert/strict";
import {
  ageAt,
  buildGoalTrackerView,
  buildLifePlan,
  formatGoalLine,
  lifeVerdict,
  monthAtAge,
  readLifeProfile,
  requiredSeed,
  sanitizeLifeInput,
  type GoalSettings,
} from "../src/services/goalTracker";

test("ageAt: 만 나이는 생일이 든 달에 한 살 오른다", () => {
  assert.equal(ageAt("1985-11", "2026-10-07"), 40);
  assert.equal(ageAt("1985-11", "2026-11-01"), 41);
  assert.equal(ageAt("1985-10", "2026-10-07"), 41);
  assert.equal(monthAtAge("1985-11", 60), "2045-11");
});

test("readLifeProfile: 출생 연월이 없거나 틀리면 null, 은퇴 나이는 기본 60·범위 고정", () => {
  assert.equal(readLifeProfile({}), null);
  assert.equal(readLifeProfile({ life_birth_month: "1985-13" }), null);
  assert.deepEqual(readLifeProfile({ life_birth_month: "1985-11" }), { birthMonth: "1985-11", retireAge: 60 });
  assert.deepEqual(readLifeProfile({ life_birth_month: "1985-11", life_retire_age: 99 }), { birthMonth: "1985-11", retireAge: 75 });
});

test("sanitizeLifeInput: 빈 값은 삭제, 미래·범위 밖은 거부", () => {
  assert.deepEqual(sanitizeLifeInput({ birthMonth: "" }, "2026-10-07"), { ok: true, value: null });
  assert.equal(sanitizeLifeInput({ birthMonth: "2027-01", retireAge: 60 }, "2026-10-07").ok, false);
  assert.equal(sanitizeLifeInput({ birthMonth: "1985-11", retireAge: 30 }, "2026-10-07").ok, false);
  assert.deepEqual(sanitizeLifeInput({ birthMonth: "1985-11", retireAge: "65" }, "2026-10-07"), {
    ok: true,
    value: { birthMonth: "1985-11", retireAge: 65 },
  });
});

const base = {
  today: "2026-10-07",
  equity: 20_660_000,
  requiredSeed: requiredSeed(3_000_000, 4), // 9억
  planAnnualPct: 8,
  monthlyContribution: 0,
  withdrawalPct: 4,
};

test("buildLifePlan: 40세가 60세 은퇴 — 은퇴가 늦을수록 매달 모을 금액이 줄고, 지금대로면 늦음", () => {
  const l = buildLifePlan({ ...base, life: { birthMonth: "1985-11", retireAge: 60 }, etaMonth: "2075-11" });
  assert.equal(l.currentAge, 40);
  assert.equal(l.retireMonth, "2045-11");
  assert.equal(l.status, "beyond-life"); // 2075-11이면 90세 → 기대수명 뒤
  assert.equal(l.etaAge, 90);
  // 19년 1개월(229개월), 연 8% → 9억에서 지금 자산 성장분을 뺀 몫을 매달 모은다: 약 156만원
  assert.ok(l.contributionForTarget > 1_500_000 && l.contributionForTarget < 1_620_000, String(l.contributionForTarget));
  assert.equal(l.contributionGap, l.contributionForTarget);
  const by = Object.fromEntries(l.options.map((o) => [o.retireAge, o.contribution]));
  assert.ok(by[55] > by[60] && by[60] > by[65], JSON.stringify(by));
  assert.deepEqual(l.options.map((o) => o.retireAge), [55, 60, 65]);
  assert.equal(l.options.find((o) => o.isChosen)?.retireAge, 60);
  assert.equal(l.stage, "40s");
  assert.match(lifeVerdict(l), /60세\(2045-11\)에 맞추려면 매달 .*만원을 모으면 됩니다/);
});

test("buildLifePlan: 같은 목표라도 20대는 필요 월 적립이 훨씬 작다", () => {
  const young = buildLifePlan({ ...base, life: { birthMonth: "2000-01", retireAge: 60 }, etaMonth: null });
  const mid = buildLifePlan({ ...base, life: { birthMonth: "1985-11", retireAge: 60 }, etaMonth: null });
  assert.equal(young.stage, "20s");
  assert.ok(young.contributionForTarget * 3 < mid.contributionForTarget);
});

test("buildLifePlan: 은퇴 전에 닿으면 on-track, 지난 은퇴 나이는 비교표에서 빠진다", () => {
  const l = buildLifePlan({ ...base, life: { birthMonth: "1968-03", retireAge: 62 }, monthlyContribution: 50_000_000, etaMonth: "2028-01" });
  assert.equal(l.currentAge, 58);
  assert.equal(l.status, "on-track");
  assert.deepEqual(l.options.map((o) => o.retireAge), [60, 62, 65]);
  assert.equal(l.contributionGap < 0, true);
});

test("buildLifePlan: 이미 은퇴 나이면 retired", () => {
  const l = buildLifePlan({ ...base, life: { birthMonth: "1960-01", retireAge: 60 }, etaMonth: null });
  assert.equal(l.status, "retired");
  assert.equal(l.monthsToRetire, 0);
  assert.equal(l.contributionForTarget, 0);
});

const settings: GoalSettings = {
  startDate: "2026-09-29",
  startEquity: 19_680_000,
  planAnnualPct: 8,
  withdrawalPct: 4,
  targetMonthlyProfit: 3_000_000,
  monthlyContribution: 0,
};
const now = { date: "2026-10-07", seed: 19_680_000, total: 20_660_000, cash: 1_000_000, holdings: 19_660_000 };
const realized = { swing: 0, sweep: 0, sells: 0, wins: 0 };

test("buildGoalTrackerView: 나이가 없으면 life null, 있으면 은퇴 시점이 목표 행", () => {
  const plain = buildGoalTrackerView({ file: { settings, history: [] }, now, realized });
  assert.equal(plain.life, null);
  assert.equal(plain.schedule.some((r) => r.isTarget), false);

  const v = buildGoalTrackerView({ file: { settings, history: [] }, now: { ...now, life: { birthMonth: "1985-11", retireAge: 60 } }, realized });
  assert.ok(v.life);
  const row = v.schedule.find((r) => r.isRetire);
  assert.equal(row?.month, "2045-11");
  assert.equal(row?.isTarget, true);
  assert.equal(row?.contribution, v.life!.contributionForTarget);
  assert.match(formatGoalLine(v), /\[나이\] 만 40세/);
});

test("buildGoalTrackerView: 목표 시점을 따로 정했으면 은퇴 행은 목표가 아니다", () => {
  const v = buildGoalTrackerView({
    file: { settings: { ...settings, targetDate: "2036-10" }, history: [] },
    now: { ...now, life: { birthMonth: "1985-11", retireAge: 60 } },
    realized,
  });
  assert.equal(v.schedule.find((r) => r.isRetire)?.isTarget, false);
  assert.equal(v.schedule.find((r) => r.month === "2036-10")?.isTarget, true);
});
