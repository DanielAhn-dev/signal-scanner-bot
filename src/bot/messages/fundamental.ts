import { fmtInt } from "./format";

export type FundamentalSummaryInput = {
  qualityScore: number;
  profileLabel?: string;
  per?: number;
  pbr?: number;
  roe?: number;
  debtRatio?: number;
};

export type FundamentalGrowthHintsInput = {
  salesGrowthLowBase?: boolean;
  opIncomeGrowthLowBase?: boolean;
  opIncomeTurnaround?: boolean;
  netIncomeGrowthLowBase?: boolean;
  netIncomeTurnaround?: boolean;
};

export function formatEokAmount(value?: number): string {
  if (value === undefined) return "-";
  if (Math.abs(value) >= 10000) {
    return `${(value / 10000).toFixed(2)}조원 (${fmtInt(value)}억원)`;
  }
  return `${fmtInt(value)}억원`;
}

export function formatPer(value?: number): string {
  if (value === undefined) return "-";
  if (value < 0) return `적자(${value.toFixed(2)})`;
  return value.toFixed(2);
}

export function formatPctValue(value?: number): string {
  if (value === undefined) return "-";
  return `${value.toFixed(2)}%`;
}

export function formatFundamentalInline(
  input: FundamentalSummaryInput,
  options?: { includeDebtRatio?: boolean; htmlCodeForScore?: boolean }
): string {
  const scoreValue = options?.htmlCodeForScore
    ? `재무건강도(내부) <code>${input.qualityScore}점</code>`
    : `재무건강도(내부) ${input.qualityScore}점`;

  const values = [
    scoreValue,
    ...(input.profileLabel ? [`기준 ${input.profileLabel}`] : []),
    `PER ${formatPer(input.per)}`,
    `PBR ${input.pbr !== undefined ? input.pbr.toFixed(2) : "-"}`,
    `ROE ${formatPctValue(input.roe)}`,
  ];

  if (options?.includeDebtRatio) {
    values.push(
      `부채 ${formatPctValue(input.debtRatio)}`
    );
  }

  return values.join(" · ");
}

export function getFundamentalGrowthHints(
  input: FundamentalGrowthHintsInput
): string[] {
  return [
    input.salesGrowthLowBase ? "매출 성장률은 낮은 기저 영향 가능성" : "",
    input.opIncomeTurnaround ? "영업이익은 턴어라운드 구간" : "",
    input.opIncomeGrowthLowBase ? "영업이익 성장률은 낮은 기저 영향 가능성" : "",
    input.netIncomeTurnaround ? "순이익은 턴어라운드 구간" : "",
    input.netIncomeGrowthLowBase ? "순이익 성장률은 낮은 기저 영향 가능성" : "",
  ].filter(Boolean);
}