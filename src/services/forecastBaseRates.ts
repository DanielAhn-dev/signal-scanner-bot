// 자동 생성: 2026-09-28 점검 스크립트 (네이버 수정주가 일봉, 코어+확장 214종목, 2016-01-20~2026-08-27, 5거래일 간격 표본)
// 조건별 "이후 20거래일 수익률" 분포. 예측 모델이 아니라 과거 기저율이다.
// 10년 검증에서 어떤 점수·등급도 이 분포를 의미 있게 바꾸지 못했다(구간별 중앙값 차이 1%p 안팎).
// 현재 상장 종목만 대상이라 생존편향으로 실제보다 약간 좋게 나올 수 있다.

export type ForecastBaseRate = {
  /** 하위 10% 20일 수익률(%) — 나쁜 경우 */
  p10: number;
  /** 중앙값 20일 수익률(%) */
  median: number;
  /** 상위 25% 20일 수익률(%) */
  p75: number;
  /** 20일 뒤 상승 마감 비율(%) */
  upProb: number;
  n: number;
};

export const FORECAST_BASE_RATE_PERIOD = "2016-01~2026-08";
export const FORECAST_HORIZON_DAYS = 20;

export const FORECAST_BASE_RATES: Record<string, ForecastBaseRate> = {
  "all": { p10: -12.9, median: 0.3, p75: 8.0, upProb: 50.7, n: 88449 },
  "entry:A": { p10: -11.7, median: 0.0, p75: 6.9, upProb: 49.4, n: 32504 },
  "entry:B": { p10: -13.4, median: 0.1, p75: 7.9, upProb: 50.2, n: 35269 },
  "entry:C": { p10: -14.2, median: 1.1, p75: 10.1, upProb: 53.6, n: 20676 },
  "mom:0-49": { p10: -12.4, median: 0.7, p75: 8.1, upProb: 52.9, n: 28910 },
  "mom:50-69": { p10: -12.5, median: 0.1, p75: 7.5, upProb: 50.0, n: 23448 },
  "mom:70-89": { p10: -13.4, median: 0.0, p75: 8.3, upProb: 49.6, n: 29041 },
  "mom:90-100": { p10: -14.5, median: -0.5, p75: 8.6, upProb: 48.1, n: 7050 },
};

export function momentumBucketKey(momentumScore: number | null | undefined): string {
  const m = Number(momentumScore);
  if (!Number.isFinite(m)) return "all";
  if (m >= 90) return "mom:90-100";
  if (m >= 70) return "mom:70-89";
  if (m >= 50) return "mom:50-69";
  return "mom:0-49";
}

export function entryGradeBucketKey(entryGrade: string | null | undefined): string {
  const g = String(entryGrade ?? "").trim().toUpperCase();
  return g === "A" || g === "B" || g === "C" ? `entry:${g}` : "all";
}

export function lookupForecastBaseRate(key: string): ForecastBaseRate {
  return FORECAST_BASE_RATES[key] ?? FORECAST_BASE_RATES.all;
}

export const FORECAST_BASE_RATE_NOTE =
  "과거 10년 비슷한 조건 종목들의 20거래일 뒤 수익 분포 (예측 아님 — 어떤 점수·등급도 이 분포를 의미 있게 바꾸지 못함)";

function signed(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

/** DailyCandidateForecast 의 base/upside/drawdown/confidence 필드를 분포 문구로 만든다. */
export function describeForecastDistribution(item: {
  expectedBasePct: number;
  expectedUpsidePct: number;
  expectedDrawdownPct: number;
  confidencePct: number;
}): string {
  return `과거 20일: 하위10% ${signed(-item.expectedDrawdownPct)} · 중앙 ${signed(item.expectedBasePct)} · 상위25% ${signed(item.expectedUpsidePct)} · 상승확률 ${item.confidencePct.toFixed(0)}%`;
}
