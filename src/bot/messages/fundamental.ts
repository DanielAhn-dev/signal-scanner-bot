import { fmtInt } from "./format";

export type FundamentalSummaryInput = {
  qualityScore: number;
  per?: number;
  pbr?: number;
  roe?: number;
  debtRatio?: number;
};

export function formatEokAmount(value?: number): string {
  if (value === undefined) return "-";
  if (Math.abs(value) >= 10000) {
    return `${(value / 10000).toFixed(2)}조원 (${fmtInt(value)}억원)`;
  }
  return `${fmtInt(value)}억원`;
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
    `PER ${input.per !== undefined ? input.per.toFixed(2) : "-"}`,
    `PBR ${input.pbr !== undefined ? input.pbr.toFixed(2) : "-"}`,
    `ROE ${input.roe !== undefined ? `${input.roe.toFixed(2)}%` : "-"}`,
  ];

  if (options?.includeDebtRatio) {
    values.push(
      `부채 ${
        input.debtRatio !== undefined ? `${input.debtRatio.toFixed(2)}%` : "-"
      }`
    );
  }

  return values.join(" · ");
}