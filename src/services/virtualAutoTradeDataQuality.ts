/** 자동매매 진입 전 데이터 품질 판정 (순수 함수 — 점수·수급 지연, 부분 적재를 보수적으로 반영) */

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export type AutoTradeDataQuality = {
  qualityScore: number;
  band: "high" | "medium" | "low";
  limitScale: number;
  minScoreBoost: number;
  blockNewBuys: boolean;
  note: string;
  investorStaleBusinessDays: number | null;
};

/**
 * 매수 제외 필터(실적 관문·순매도·과열·추격)의 조회가 실패했을 때의 판정.
 * 이 필터들은 검증된 손실 회피 규칙인데, 조회 실패를 "해당 종목 없음"으로 넘기면 DB 장애가 난 바로 그 날
 * 규칙이 조용히 꺼진 채 매수한다. 실패한 필터가 하나라도 있으면 그날 신규 매수를 보류한다.
 */
export function assessGuardLoadFailures(failedLabels: string[]): { blockNewBuys: boolean; note: string } {
  const labels = [...new Set(failedLabels.map((l) => l.trim()).filter(Boolean))];
  if (labels.length === 0) return { blockNewBuys: false, note: "" };
  return {
    blockNewBuys: true,
    note: `매수 제외 필터 조회 실패(${labels.join(", ")}) — 규칙을 적용하지 못해 신규 매수 보류`,
  };
}

export function assessAutoTradeDataQuality(input: {
  scoreStaleBusinessDays: number;
  investorStaleBusinessDays: number | null;
  /** 날짜는 최신이지만 행 수가 급감한(일부만 적재된) 테이블 이름 */
  partialLoadLabels?: string[];
}): AutoTradeDataQuality {
  const scoreLag = Math.max(0, Math.floor(toNumber(input.scoreStaleBusinessDays, 0)));
  const invLag =
    input.investorStaleBusinessDays == null
      ? null
      : Math.max(0, Math.floor(toNumber(input.investorStaleBusinessDays, 0)));

  let qualityScore = 100;
  qualityScore -= scoreLag * 12;
  if (invLag == null) {
    qualityScore -= 40;
  } else {
    qualityScore -= invLag * 8;
  }
  qualityScore = clamp(qualityScore, 0, 100);

  const partial = input.partialLoadLabels ?? [];
  if (partial.length > 0) {
    return {
      qualityScore: Math.min(qualityScore, 30),
      band: "low",
      limitScale: 0.0,
      minScoreBoost: 8,
      blockNewBuys: true,
      note: `일부만 적재된 데이터(${partial.join(", ")})로 신규 매수 차단`,
      investorStaleBusinessDays: invLag,
    };
  }

  if (scoreLag >= 2 || invLag == null || invLag >= 6) {
    return {
      qualityScore,
      band: "low",
      limitScale: 0.0,
      minScoreBoost: 8,
      blockNewBuys: true,
      note:
        invLag == null
          ? "수급 기준일 확인 불가로 신규 매수 차단"
          : `수급 기준일 지연(${invLag}영업일)으로 신규 매수 차단`,
      investorStaleBusinessDays: invLag,
    };
  }

  if (scoreLag >= 1 || (invLag != null && invLag >= 3)) {
    return {
      qualityScore,
      band: "medium",
      limitScale: 0.6,
      minScoreBoost: 4,
      blockNewBuys: false,
      note:
        invLag != null && invLag >= 3
          ? `수급 지연(${invLag}영업일)으로 진입 수 축소(60%) + 최소점수 +4 보수화`
          : "점수 기준일 1영업일 지연으로 진입 수 축소(60%) + 최소점수 +4 보수화",
      investorStaleBusinessDays: invLag,
    };
  }

  return {
    qualityScore,
    band: "high",
    limitScale: 1,
    minScoreBoost: 0,
    blockNewBuys: false,
    note: invLag == null ? "데이터 품질 판단 제한" : "데이터 품질 양호",
    investorStaleBusinessDays: invLag,
  };
}
