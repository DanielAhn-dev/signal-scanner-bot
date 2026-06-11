/**
 * 적응형 확신도 서비스 (Phase 5)
 *
 * 최근 90일 팩터 승률(getFactorWinRateSummary)을 사이징 확신도 계수에 연결한다.
 * - 승률 높은 패턴(점수대·신호등급) → 확신도 가산 (비중 확대)
 * - 승률 낮은 패턴 → 확신도 감산 (비중 축소)
 * - 표본이 충분한데도 승률·손익이 모두 나쁜 패턴 → 신규 매수 제외
 *
 * 전문 트레이딩이 아니므로 단순 임계값 규칙만 사용하고,
 * 표본이 부족한 버킷은 절대 조정하지 않는다 (과적합 방지).
 */

// decisionLogService는 모듈 로드 시 supabase 클라이언트를 만들므로
// (env 없는 테스트에서도 순수 규칙 함수를 쓸 수 있게) 값은 지연 import한다.
import type { FactorWinRateBucket, FactorWinRateSummary } from "./decisionLogService";

/** 버킷당 이 표본 미만이면 어떤 조정도 하지 않음 */
const MIN_SAMPLE_FOR_ADJUST = 8;
/** 신규 매수 제외는 더 많은 표본을 요구 */
const MIN_SAMPLE_FOR_EXCLUDE = 12;
/** 승률 60% 이상 → +0.05 */
const BOOST_WIN_RATE_PCT = 60;
const BOOST_DELTA = 0.05;
/** 승률 40% 미만 → -0.05 */
const CUT_WIN_RATE_PCT = 40;
const CUT_DELTA = -0.05;
/** 승률 30% 미만 → -0.1 */
const HARD_CUT_WIN_RATE_PCT = 30;
const HARD_CUT_DELTA = -0.1;
/** 승률 25% 미만 + 평균손익 음수 + 표본 12건 이상 → 신규 매수 제외 */
const EXCLUDE_WIN_RATE_PCT = 25;
/** 점수대+등급 합산 델타 한도 */
const DELTA_FLOOR = -0.15;
const DELTA_CEIL = 0.1;

const CACHE_TTL_MS = 30 * 60 * 1000;
const WINDOW_DAYS = 90;

export type AdaptiveBucketDecision = {
  label: string;
  delta: number;
  excluded: boolean;
  winRatePct: number;
  total: number;
  avgPnl: number | null;
};

export type AdaptiveConvictionRule = {
  windowDays: number;
  scoreBands: Record<string, AdaptiveBucketDecision>;
  trustGrades: Record<string, AdaptiveBucketDecision>;
};

export type AdaptiveAdjustment = {
  delta: number;
  excluded: boolean;
  reasons: string[];
};

function isAdaptiveConvictionDisabled(): boolean {
  return String(process.env.ADAPTIVE_CONVICTION_DISABLED ?? "false").toLowerCase() === "true";
}

/** decisionLogService의 점수대 라벨과 동일한 밴딩 */
export function resolveScoreBandLabel(score: unknown): string {
  const n = Number(score);
  if (!Number.isFinite(n)) return "~39";
  if (n >= 70) return "70+";
  if (n >= 60) return "60-69";
  if (n >= 50) return "50-59";
  if (n >= 40) return "40-49";
  return "~39";
}

function decideBucket(bucket: FactorWinRateBucket): AdaptiveBucketDecision | null {
  if (bucket.total < MIN_SAMPLE_FOR_ADJUST || bucket.winRatePct == null) return null;

  const winRate = bucket.winRatePct;
  const excluded =
    bucket.total >= MIN_SAMPLE_FOR_EXCLUDE &&
    winRate < EXCLUDE_WIN_RATE_PCT &&
    bucket.avgPnl != null &&
    bucket.avgPnl < 0;

  let delta = 0;
  if (winRate >= BOOST_WIN_RATE_PCT) delta = BOOST_DELTA;
  else if (winRate < HARD_CUT_WIN_RATE_PCT) delta = HARD_CUT_DELTA;
  else if (winRate < CUT_WIN_RATE_PCT) delta = CUT_DELTA;

  if (delta === 0 && !excluded) return null;

  return {
    label: bucket.label,
    delta,
    excluded,
    winRatePct: winRate,
    total: bucket.total,
    avgPnl: bucket.avgPnl,
  };
}

/**
 * 팩터 승률 요약 → 적응형 확신도 규칙. 조정할 버킷이 하나도 없으면 null.
 * 순수 함수 (테스트·주간 리포트에서 재사용).
 */
export function buildAdaptiveConvictionRule(
  summary: FactorWinRateSummary | null
): AdaptiveConvictionRule | null {
  if (!summary) return null;

  const scoreBands: Record<string, AdaptiveBucketDecision> = {};
  for (const bucket of summary.scoreBands) {
    const decision = decideBucket(bucket);
    if (decision) scoreBands[bucket.label] = decision;
  }

  const trustGrades: Record<string, AdaptiveBucketDecision> = {};
  for (const bucket of summary.signalTrustGrades) {
    const decision = decideBucket(bucket);
    if (decision) trustGrades[bucket.label.trim().toUpperCase()] = decision;
  }

  if (Object.keys(scoreBands).length === 0 && Object.keys(trustGrades).length === 0) {
    return null;
  }
  return { windowDays: summary.windowDays, scoreBands, trustGrades };
}

function describeDecision(prefix: string, decision: AdaptiveBucketDecision): string {
  const action = decision.excluded
    ? "신규매수 제외"
    : `${decision.delta > 0 ? "+" : ""}${decision.delta.toFixed(2)}`;
  return `${prefix} ${decision.label} ${action} (승률 ${decision.winRatePct.toFixed(0)}%, ${decision.total}건)`;
}

/**
 * 후보의 점수·신뢰등급에 규칙을 적용해 확신도 델타와 제외 여부를 돌려준다.
 * 제외는 신규 진입(월요매수·리밸런싱 매수)에만 쓰고, 추매는 델타만 적용한다.
 */
export function resolveAdaptiveAdjustment(
  rule: AdaptiveConvictionRule | null,
  input: { score?: number | null; trustGrade?: string | null }
): AdaptiveAdjustment {
  if (!rule) return { delta: 0, excluded: false, reasons: [] };

  const reasons: string[] = [];
  let delta = 0;
  let excluded = false;

  const band = rule.scoreBands[resolveScoreBandLabel(input.score)];
  if (band) {
    delta += band.delta;
    excluded = excluded || band.excluded;
    reasons.push(describeDecision("점수대", band));
  }

  const gradeKey = String(input.trustGrade ?? "").trim().toUpperCase();
  const grade = gradeKey ? rule.trustGrades[gradeKey] : undefined;
  if (grade) {
    delta += grade.delta;
    excluded = excluded || grade.excluded;
    reasons.push(describeDecision("등급", grade));
  }

  delta = Math.min(DELTA_CEIL, Math.max(DELTA_FLOOR, Number(delta.toFixed(2))));
  return { delta, excluded, reasons };
}

/** 규칙 전체를 사람이 읽는 라인 목록으로 (주간 리포트·실행 노트용) */
export function describeAdaptiveRuleLines(rule: AdaptiveConvictionRule | null): string[] {
  if (!rule) return [];
  const lines: string[] = [];
  for (const decision of Object.values(rule.scoreBands)) {
    lines.push(describeDecision("점수대", decision));
  }
  for (const decision of Object.values(rule.trustGrades)) {
    lines.push(describeDecision("등급", decision));
  }
  return lines;
}

/** 자동매매 실행 노트용 한 줄 요약 */
export function formatAdaptiveRuleSummary(rule: AdaptiveConvictionRule | null): string | null {
  const lines = describeAdaptiveRuleLines(rule);
  if (!rule || lines.length === 0) return null;
  return `적응형 확신도(최근 ${rule.windowDays}일 승률 기반): ${lines.join(" · ")}`;
}

type CacheEntry = { rule: AdaptiveConvictionRule | null; at: number };
const ruleCache = new Map<number, CacheEntry>();

/** 테스트용 캐시 초기화 */
export function clearAdaptiveConvictionCache(): void {
  ruleCache.clear();
}

/**
 * 계정별 적응형 규칙 조회 (30분 캐시).
 * 조회 실패·표본 부족·ADAPTIVE_CONVICTION_DISABLED=true면 null (조정 없음으로 동작).
 */
export async function getAdaptiveConvictionRule(
  chatId: number
): Promise<AdaptiveConvictionRule | null> {
  if (isAdaptiveConvictionDisabled()) return null;

  const cached = ruleCache.get(chatId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.rule;

  const summary = await import("./decisionLogService.js")
    .then((mod) => mod.getFactorWinRateSummary(chatId, WINDOW_DAYS))
    .catch(() => null);
  const rule = buildAdaptiveConvictionRule(summary);
  ruleCache.set(chatId, { rule, at: Date.now() });
  return rule;
}
