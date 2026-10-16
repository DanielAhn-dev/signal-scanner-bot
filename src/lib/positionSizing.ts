/**
 * 개별주 '담을 크기' — 흔들림(최근 60거래일 변동성)이 큰 종목일수록 적게 담는다. 매매를 막지 않는 참고 안내다.
 *
 * 근거: scripts/research/validate_inverse_vol_sizing.py (가설 장부 H56 → C66, 기준은 결과 보기 전 고정).
 * 시총 상위 200 무작위 5종목 바구니 19,797개(2015-04~2025-07 분기 진입, 1년 보유)에서 변동성 역수 비중이 균등 비중보다
 * 1년 하위 5% 수익을 −36.3% → −33.0%(+3.3%p) 개선했고 중앙값도 손해가 없었다. 지수를 이기는 방법은 아니다
 * (같은 시점 KODEX 200 1년 평균 +20.1%, 바구니 +6.0%).
 *
 * 계산: 종목당 기준액 = 총평가액 × 개별주 한도 ÷ 5종목(검증 바구니 크기).
 * 담을 최대 = 기준액 × (기준 배수 ÷ 이 종목 배수), 기준액의 2배를 넘지 않는다.
 * 배수 = 종목 60일 변동성 ÷ 같은 창 KODEX 200 변동성 — 시장 전체가 출렁일 때 금액이 같이 줄지 않고 "이 종목이 유독 큰가"만 본다.
 * 상한 2배는 검증에 없던 안전장치다(변동이 아주 작은 종목이 한도를 혼자 다 쓰지 않게).
 */

/** 검증 바구니 종목 수 */
export const SIZING_BASKET_STOCKS = 5;
/** 시총 상위 200 종목 60일 변동성 ÷ KODEX 200 변동성의 중앙값 — 스크립트 출력(분기 42개, 범위 1.59~4.19) */
export const SIZING_REFERENCE_VOL_RATIO = 2.51;
/** 기준액 대비 최대 배수(검증 밖 안전장치) */
export const SIZING_MAX_MULTIPLE = 2;
/** 계산에 쓰는 일간 수익률 수 */
export const SIZING_VOL_WINDOW = 60;

export const SIZING_EVIDENCE = {
  code: "C66",
  period: "2015~2025",
  generatedAt: "2026-10-16",
  baskets: 19797,
  tail5Equal: -36.3,
  tail5Sized: -33.0,
  indexAvg1y: 20.1,
  basketAvg1y: 6.0,
} as const;

/** closes: 오래된 것부터 최신까지 일별 종가. 최근 60개 일간 로그수익률의 표준편차, 부족하면 null */
export function dailyVolatility(closes: number[], window = SIZING_VOL_WINDOW): number | null {
  const c = closes.slice(-(window + 1));
  if (c.length < window + 1 || c.some((v) => !Number.isFinite(v) || v <= 0)) return null;
  const r = c.slice(1).map((v, k) => Math.log(v / c[k]));
  const mean = r.reduce((s, v) => s + v, 0) / r.length;
  const sd = Math.sqrt(r.reduce((s, v) => s + (v - mean) ** 2, 0) / r.length);
  return sd > 0 ? sd : null;
}

export type SizingLevel = "small" | "normal" | "large";

export type StockSizing = {
  /** 이 종목 변동성 ÷ 지수 변동성 */
  volRatio: number;
  /** 시총 상위 200 보통 종목과 비교한 흔들림 */
  level: SizingLevel;
  baseAmount: number;
  maxAmount: number;
  /** 지금(또는 입력한 매수 뒤) 금액 − 최대. 양수면 초과 */
  overAmount: number;
};

export function sizingLevel(volRatio: number): SizingLevel {
  const rel = volRatio / SIZING_REFERENCE_VOL_RATIO;
  return rel > 1.25 ? "large" : rel < 0.8 ? "small" : "normal";
}

export function stockSizing(input: {
  /** 실계좌 보유 총평가액(개별주 한도의 분모와 같게) */
  totalValue: number;
  /** 개별주 묶음 한도 % (위성 한도) */
  satelliteMaxPct: number;
  volRatio: number | null | undefined;
  /** 이 종목에 담긴(담길) 금액 */
  positionValue: number;
}): StockSizing | null {
  const { totalValue, satelliteMaxPct, volRatio, positionValue } = input;
  if (!(totalValue > 0) || !(satelliteMaxPct > 0) || volRatio == null || !(volRatio > 0)) return null;
  const baseAmount = (totalValue * satelliteMaxPct) / 100 / SIZING_BASKET_STOCKS;
  const multiple = Math.min(SIZING_MAX_MULTIPLE, SIZING_REFERENCE_VOL_RATIO / volRatio);
  const maxAmount = Math.round(baseAmount * multiple);
  return {
    volRatio,
    level: sizingLevel(volRatio),
    baseAmount: Math.round(baseAmount),
    maxAmount,
    overAmount: Math.round(Math.max(0, positionValue) - maxAmount),
  };
}
