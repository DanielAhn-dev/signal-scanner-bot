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
