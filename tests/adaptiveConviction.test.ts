import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAdaptiveConvictionRule,
  resolveAdaptiveAdjustment,
  resolveScoreBandLabel,
  describeAdaptiveRuleLines,
  formatAdaptiveRuleSummary,
} from "../src/services/adaptiveConvictionService";
import { resolveConvictionScale } from "../src/services/virtualAutoTradeSizing";
import type { FactorWinRateSummary, FactorWinRateBucket } from "../src/services/decisionLogService";

function bucket(label: string, wins: number, total: number, avgPnl: number): FactorWinRateBucket {
  return {
    label,
    wins,
    total,
    winRatePct: total > 0 ? Number(((wins / total) * 100).toFixed(1)) : null,
    avgPnl,
  };
}

function summaryOf(input: {
  scoreBands?: FactorWinRateBucket[];
  signalTrustGrades?: FactorWinRateBucket[];
}): FactorWinRateSummary {
  return {
    windowDays: 90,
    scoreBands: input.scoreBands ?? [],
    signalTrustGrades: input.signalTrustGrades ?? [],
    strategyProfiles: [],
  };
}

test("adaptive: 점수대 라벨 밴딩이 decisionLog와 동일하다", () => {
  assert.equal(resolveScoreBandLabel(75), "70+");
  assert.equal(resolveScoreBandLabel(70), "70+");
  assert.equal(resolveScoreBandLabel(65), "60-69");
  assert.equal(resolveScoreBandLabel(55), "50-59");
  assert.equal(resolveScoreBandLabel(45), "40-49");
  assert.equal(resolveScoreBandLabel(30), "~39");
  assert.equal(resolveScoreBandLabel(null), "~39");
});

test("adaptive: 표본 8건 미만 버킷은 어떤 조정도 만들지 않는다", () => {
  const rule = buildAdaptiveConvictionRule(
    summaryOf({
      scoreBands: [bucket("70+", 1, 7, -50_000)], // 승률 14%지만 표본 부족
      signalTrustGrades: [bucket("D", 0, 5, -90_000)],
    })
  );
  assert.equal(rule, null);
});

test("adaptive: 승률 60% 이상 버킷은 +0.05 부스트", () => {
  const rule = buildAdaptiveConvictionRule(
    summaryOf({ scoreBands: [bucket("70+", 7, 10, 120_000)] }) // 70%
  );
  assert.ok(rule);
  const adj = resolveAdaptiveAdjustment(rule, { score: 72, trustGrade: "B" });
  assert.equal(adj.delta, 0.05);
  assert.equal(adj.excluded, false);
  assert.equal(adj.reasons.length, 1);
});

test("adaptive: 승률 30~40%는 -0.05, 30% 미만은 -0.1 감산", () => {
  const rule = buildAdaptiveConvictionRule(
    summaryOf({
      scoreBands: [
        bucket("50-59", 3, 9, -10_000), // 33.3% → -0.05
        bucket("40-49", 2, 8, -30_000), // 25% → -0.1 (표본 12 미만이라 제외는 아님)
      ],
    })
  );
  assert.ok(rule);
  assert.equal(resolveAdaptiveAdjustment(rule, { score: 55 }).delta, -0.05);
  const hard = resolveAdaptiveAdjustment(rule, { score: 45 });
  assert.equal(hard.delta, -0.1);
  assert.equal(hard.excluded, false);
});

test("adaptive: 승률 25% 미만 + 평균손익 음수 + 표본 12건 이상이면 신규매수 제외", () => {
  const rule = buildAdaptiveConvictionRule(
    summaryOf({ scoreBands: [bucket("40-49", 2, 12, -45_000)] }) // 16.7%
  );
  assert.ok(rule);
  const adj = resolveAdaptiveAdjustment(rule, { score: 44 });
  assert.equal(adj.excluded, true);
  assert.equal(adj.delta, -0.1);
});

test("adaptive: 평균손익이 양수면 승률이 낮아도 제외하지 않는다 (감산만)", () => {
  const rule = buildAdaptiveConvictionRule(
    summaryOf({ scoreBands: [bucket("40-49", 2, 12, 80_000)] }) // 16.7%지만 avgPnl > 0
  );
  assert.ok(rule);
  const adj = resolveAdaptiveAdjustment(rule, { score: 44 });
  assert.equal(adj.excluded, false);
  assert.equal(adj.delta, -0.1);
});

test("adaptive: 점수대 + 등급 델타가 합산되고 [-0.15, +0.1]로 클램프된다", () => {
  const rule = buildAdaptiveConvictionRule(
    summaryOf({
      scoreBands: [bucket("40-49", 2, 10, -20_000)], // 20% → -0.1
      signalTrustGrades: [bucket("C", 3, 10, -15_000)], // 30% → -0.05... 30%는 hard cut 경계: winRate < 30 false → -0.05
    })
  );
  assert.ok(rule);
  const adj = resolveAdaptiveAdjustment(rule, { score: 45, trustGrade: "C" });
  assert.equal(adj.delta, -0.15); // -0.1 + -0.05 = -0.15 (플로어와 일치)
  assert.equal(adj.reasons.length, 2);
});

test("adaptive: 부스트 합산은 +0.1 천장으로 클램프된다", () => {
  const rule = buildAdaptiveConvictionRule(
    summaryOf({
      scoreBands: [bucket("70+", 8, 10, 100_000)], // 80% → +0.05
      signalTrustGrades: [bucket("A", 9, 12, 150_000)], // 75% → +0.05
    })
  );
  assert.ok(rule);
  const adj = resolveAdaptiveAdjustment(rule, { score: 72, trustGrade: "A" });
  assert.equal(adj.delta, 0.1);
});

test("adaptive: 규칙 null이면 무조정", () => {
  const adj = resolveAdaptiveAdjustment(null, { score: 70, trustGrade: "A" });
  assert.deepEqual(adj, { delta: 0, excluded: false, reasons: [] });
  assert.equal(buildAdaptiveConvictionRule(null), null);
  assert.equal(formatAdaptiveRuleSummary(null), null);
});

test("adaptive: 등급 키는 대소문자·공백을 정규화해 매칭한다", () => {
  const rule = buildAdaptiveConvictionRule(
    summaryOf({ signalTrustGrades: [bucket(" a ", 7, 10, 50_000)] })
  );
  assert.ok(rule);
  assert.equal(resolveAdaptiveAdjustment(rule, { trustGrade: "A" }).delta, 0.05);
  assert.equal(resolveAdaptiveAdjustment(rule, { trustGrade: "a" }).delta, 0.05);
});

test("adaptive: describe/format 라인에 승률과 표본 수가 들어간다", () => {
  const rule = buildAdaptiveConvictionRule(
    summaryOf({ scoreBands: [bucket("40-49", 2, 12, -45_000)] })
  );
  const lines = describeAdaptiveRuleLines(rule);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /점수대 40-49 신규매수 제외 \(승률 17%, 12건\)/);
  const summaryLine = formatAdaptiveRuleSummary(rule);
  assert.ok(summaryLine);
  assert.match(summaryLine!, /최근 90일/);
});

test("conviction: adaptiveDelta가 기본 확신도에 합산되고 0.7~1.3으로 클램프된다", () => {
  // 점수 72 → 1.2, 등급 A +0.05 = 1.25, adaptive +0.05 → 1.3
  assert.equal(
    resolveConvictionScale({ score: 72, trustGrade: "A", adaptiveDelta: 0.05 }),
    1.3
  );
  // 1.25 + 0.1 = 1.35 → 천장 1.3
  assert.equal(
    resolveConvictionScale({ score: 72, trustGrade: "A", adaptiveDelta: 0.1 }),
    1.3
  );
  // 점수 45 → 0.85, adaptive -0.15 = 0.7 (플로어 유지)
  assert.equal(resolveConvictionScale({ score: 45, adaptiveDelta: -0.15 }), 0.7);
  // 미지정이면 기존과 동일
  assert.equal(
    resolveConvictionScale({ score: 72, trustGrade: "A" }),
    resolveConvictionScale({ score: 72, trustGrade: "A", adaptiveDelta: null })
  );
});
