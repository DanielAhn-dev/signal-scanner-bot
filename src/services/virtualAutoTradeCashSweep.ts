/**
 * 유휴현금 스윕(cash sweep).
 *
 * 자동매매가 실거래 후보를 못 찾아 현금이 그대로 방치되는 구간(방어장·성과게이트 보수모드 등)에서,
 * 시드 대비 항상 남겨두는 최소 현금(FLAT_RESERVE_PCT)을 넘는 유휴현금을 CD금리/KOFR 연동 ETF로
 * 옮겨 무위험에 가깝게 이자를 태운다. 실거래 매수에 현금이 필요해지면 스윕 포지션을 전량
 * 현금화해 자금을 돌려준다.
 *
 * 시장 레짐별 현금 하한(minCashReservePct)과는 별개의 고정 비율을 쓴다 — 레짐 로직에 얽히면
 * 방어모드 진입/해제 시마다 스윕 매수·매도가 반복돼 수수료만 나가는 휘핑쏘가 생기기 때문.
 */

/** 스윕 매매에 쓰는 전략 ID. AUTO_TRADE_STRATEGY_ID와 달라서 성과게이트·승률 통계에서 자동 제외된다. */
export const CASH_SWEEP_STRATEGY_ID = "cash-sweep.v1";

/** 우선순위 순 후보 코드. 유니버스에 종가가 채워진 첫 번째 종목을 사용한다. */
export const CASH_SWEEP_CANDIDATE_CODES = [
  "459580", // KODEX CD금리액티브(합성)
  "357870", // TIGER CD금리투자KIS(합성)
  "423160", // KODEX KOFR금리액티브(합성)
];

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
  const shortfall = Math.max(0, input.cashNeeded - input.availableCash);
  if (shortfall <= 0) return 0;
  return Math.min(input.sweepQty, Math.ceil(shortfall / input.sweepPrice));
}
