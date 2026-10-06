/**
 * 유휴현금 스윕(cash sweep).
 *
 * 자동매매가 실거래 후보를 못 찾아 현금이 그대로 방치되는 구간(방어장·성과게이트 보수모드 등)에서,
 * 시드 대비 항상 남겨두는 최소 현금(FLAT_RESERVE_PCT)을 넘는 유휴현금을 ETF로 옮겨 둔다.
 * 실거래 매수에 현금이 필요해지면 스윕 포지션에서 자금을 돌려준다.
 *
 * 어디에 둘지 = 항상 지수 ETF(KODEX 200). 금리 ETF는 지수 ETF 가격이 없을 때만 대신 쓴다.
 *   2026-09-29 검증(100만+월 50만 적립 10년·2천만 거치 5/10년, 모든 월말 시작점, 다음 날 체결·배당·CD 세후):
 *     하위 10% 최종금액 — 코스피 1996~ 적립 보유 7,237만 vs 50일선 5,887만 / KODEX200 2002~ 7,768만 vs 6,610만,
 *     거치 10년 보유 2,943만 vs 2,119만 / 3,509만 vs 2,633만. 최악의 경우도 보유가 같거나 앞섰다.
 *     50일선이 앞선 건 도중 낙폭뿐(원금 대비 최저 82~91% vs 57~74%). 예전의 "50일선 30년 연 11.8%"는 신호 당일 종가
 *     체결을 가정한 값이었다. 그래서 50일선에 따라 지수↔금리를 오가던 규칙(099bfd0)을 뺐다.
 *   예전엔 항상 CD금리 ETF였다 — 봇 자금 대부분(2026-09 기준 약 95%)이 연 2~3%에 묶여 있었다.
 *
 * 시장 레짐별 현금 하한(minCashReservePct)과는 별개의 고정 비율을 쓴다 — 레짐 로직에 얽히면
 * 방어모드 진입/해제 시마다 스윕 매수·매도가 반복돼 수수료만 나가는 휘핑쏘가 생기기 때문.
 */

/** 스윕 매매에 쓰는 전략 ID. AUTO_TRADE_STRATEGY_ID와 달라서 성과게이트·승률 통계에서 자동 제외된다. */
export const CASH_SWEEP_STRATEGY_ID = "cash-sweep.v1";

/** 금리형 스윕 ETF (우선순위 순, 유니버스에 종가가 채워진 첫 번째 종목 사용) */
export const RATE_SWEEP_CODES = [
  "459580", // KODEX CD금리액티브(합성)
  "357870", // TIGER CD금리투자KIS(합성)
  "423160", // KODEX KOFR금리액티브(합성)
];

/** 지수형 스윕 ETF (우선순위 순) */
export const INDEX_SWEEP_CODES = [
  "069500", // KODEX 200
  "102110", // TIGER 200
];

/** 스윕에 쓰일 수 있는 모든 ETF — 보유분 조회·현금 취급용 */
export const CASH_SWEEP_CANDIDATE_CODES = [...INDEX_SWEEP_CODES, ...RATE_SWEEP_CODES];

export function isIndexSweepCode(code: string | null | undefined): boolean {
  return INDEX_SWEEP_CODES.includes(String(code ?? "").trim());
}

/** 시드 대비 항상 순수 현금으로 남겨두는 비율 (레짐과 무관하게 고정) */
const FLAT_RESERVE_PCT = 10;
/**
 * 이 금액 미만의 유휴현금은 스윕하지 않는다.
 * 청산 임계값(CASH_SWEEP_LIQUIDATE_THRESHOLD, 30만원)과의 간격(히스테리시스)을 넓게 둬서
 * 현금이 30만~50만원대를 오갈 때마다 스윕 매수/청산이 반복되며 수수료·세금만 나가는
 * 왕복 손실(휘핑쏘)을 줄인다. 예전엔 50만원이라 간격이 20만원뿐이었다.
 */
const CASH_SWEEP_MIN_BUY_AMOUNT = 1_000_000;
/** 실거래용 가용현금이 이 밑으로 떨어지면 스윕 포지션을 전량 현금화한다 */
export const CASH_SWEEP_LIQUIDATE_THRESHOLD = 300_000;

export function resolveCashSweepIdleAmount(input: {
  availableCash: number;
  seedCapital: number;
}): number {
  const availableCash = Math.max(0, input.availableCash);
  const seedCapital = Math.max(0, input.seedCapital);
  if (seedCapital <= 0) return 0;
  const reserve = seedCapital * (FLAT_RESERVE_PCT / 100);
  const idle = Math.max(0, availableCash - reserve);
  return idle >= CASH_SWEEP_MIN_BUY_AMOUNT ? Math.floor(idle) : 0;
}

export function shouldLiquidateCashSweep(input: {
  availableCash: number;
  sweepPositionValue: number;
}): boolean {
  if (input.sweepPositionValue <= 0) return false;
  return input.availableCash < CASH_SWEEP_LIQUIDATE_THRESHOLD;
}

/**
 * 다른 필터를 모두 통과한 실제 매수 후보가 현금 부족으로만 막혔을 때, 스윕 포지션 전량이 아니라
 * 부족분만큼만 매도하기 위한 수량을 계산한다. 전량 청산(runCashSweepLiquidateStep)과 달리
 * 이 경로는 실제 매수가 성사될 후보가 있을 때만 호출되므로, 매매 빈도는 실제 매수 빈도에 비례하고
 * 나머지 스윕 잔량은 계속 이자를 태운다.
 */
export function resolveCashSweepTopUpQty(input: {
  cashNeeded: number;
  availableCash: number;
  sweepQty: number;
  sweepPrice: number;
}): number {
  if (input.sweepQty <= 0 || input.sweepPrice <= 0) return 0;
  if (input.cashNeeded <= input.availableCash) return 0;
  // 매수 뒤에도 청산 임계값만큼은 현금이 남게 판다. 부족분만 팔면 매수 직후 현금이 0 근처가 되어
  // 같은 회차 끝의 청산 점검에 걸려 스윕을 또 팔았다(2026-10-06: 보충 11주 → 청산 45주 → 한 시간 뒤 28주 재매수).
  const shortfall = input.cashNeeded + CASH_SWEEP_LIQUIDATE_THRESHOLD - input.availableCash;
  return Math.min(input.sweepQty, Math.ceil(shortfall / input.sweepPrice));
}

/**
 * 현금이 청산 임계값 밑으로 떨어졌을 때 팔 스윕 수량: 고정 예비 현금(시드의 FLAT_RESERVE_PCT)을 채울 만큼만.
 * 예전엔 전량 현금화해서, 다음 회차에 예비 현금을 넘는 금액이 유휴현금으로 잡혀 다시 사들이는 왕복이 생겼다
 * (2026-10-01·10-06, 수백만 원 규모 매도 후 같은 날 재매수).
 */
export function resolveCashSweepRestoreQty(input: {
  availableCash: number;
  seedCapital: number;
  sweepQty: number;
  sweepPrice: number;
}): number {
  if (input.sweepQty <= 0 || input.sweepPrice <= 0 || input.seedCapital <= 0) return 0;
  const reserve = input.seedCapital * (FLAT_RESERVE_PCT / 100);
  const need = reserve - Math.max(0, input.availableCash);
  if (need <= 0) return 0;
  return Math.min(input.sweepQty, Math.ceil(need / input.sweepPrice));
}
