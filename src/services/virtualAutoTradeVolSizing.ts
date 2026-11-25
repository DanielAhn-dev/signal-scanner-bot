/**
 * 봇 신규 매수 '담을 크기' — 지수보다 유난히 흔들리는 종목은 기준 금액보다 적게 담는다 (2026-11-23, 관문 B-4).
 *
 * 근거: C66(H56) — 변동성 역수 비중이 균등 비중보다 1년 하위 5% 수익을 −36.3% → −33.0%로 개선했고 중앙값 손해 없음
 * (src/lib/positionSizing.ts, scripts/research/validate_inverse_vol_sizing.py). 수익 추구가 아니라 꼬리 축소다.
 *
 * 위쪽만 깎는다: 변동성이 작은 종목을 기준액보다 더 사지는 않는다(기존 사이징의 한도·위험예산이 그대로 상한).
 * 너무 큰 종목도 '의미 있는 최소 크기'까지는 담는다 — 매수를 막는 규칙이 아니라 크기 규칙이다.
 */
import { SIZING_MAX_MULTIPLE, SIZING_REFERENCE_VOL_RATIO } from "../lib/positionSizing";

/** 변동성 비교 기준 지수(KODEX 200). 일봉은 매일 수집한다. */
export const VOL_SIZING_INDEX_CODE = "069500";

/**
 * 이 종목 변동성 ÷ 지수 변동성(volRatio)에 따른 매수 금액 상한. 적용할 게 없으면 null.
 * baseBudget: 기존 사이징의 종목당 기준 금액, floor: 기존 사이징의 '의미 있는 최소 크기'.
 */
export function volatilityBudgetCap(input: {
  baseBudget: number;
  floor: number;
  stockVol60: number | null | undefined;
  indexVol60: number | null | undefined;
}): { cap: number; volRatio: number; multiple: number } | null {
  const { baseBudget, floor, stockVol60, indexVol60 } = input;
  if (!(baseBudget > 0) || !(stockVol60 && stockVol60 > 0) || !(indexVol60 && indexVol60 > 0)) return null;
  const volRatio = stockVol60 / indexVol60;
  const multiple = Math.min(SIZING_MAX_MULTIPLE, SIZING_REFERENCE_VOL_RATIO / volRatio);
  const cap = Math.max(Math.max(0, floor), Math.floor(baseBudget * multiple));
  return { cap, volRatio, multiple };
}
