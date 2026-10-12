/**
 * 유휴현금 스윕(cash sweep).
 *
 * 봇 계좌를 코어(지수 ETF)와 개별주 몫(시드의 SATELLITE_CAP_PCT)으로 나누고, 몫을 넘는 현금을 지수 ETF로 옮겨 둔다.
 * 지수 보유분은 개별주 매수 자금으로 팔지 않는다(2026-10-12). 예전엔 개별주 매수에 현금이 모자라거나 현금이
 * 30만원 밑으로 떨어지면 지수를 팔아 채웠다 — 지수를 싸게 팔아 개별주를 사고, 개별주에서 손절하는 경로가 됐다.
 * 이제 개별주는 몫 안의 현금으로만 사고, 잃은 몫은 지수로 메우지 않는다.
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
 * 방어모드 진입/해제 시마다 스윕 매수가 반복되기 때문.
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

/**
 * 개별주 몫(위성) 상한: 봇 계좌의 개별주 평가액 + 개별주용 현금을 합쳐 시드의 이 비율까지만 둔다.
 * 나머지는 전부 지수 ETF(코어)에 둔다. 예전엔 "시드 10%는 현금"만 정하고 개별주 보유분은 따로 셌다.
 */
export const SATELLITE_CAP_PCT = 10;
/**
 * 관리자 실험 계좌용: 시드 전체를 종목 봇이 운용한다 (11/23 관문 검증 데이터 수집, 2026-10-13).
 * 이때는 유휴현금을 지수에 넣지 않는다 — 넣으면 다음 매수 때 다시 팔아야 해 왕복이 생긴다.
 */
export const EXPERIMENT_CAP_PCT = 100;

/** 계좌의 개별주 몫(%) — 실험 계좌만 100, 나머지는 SATELLITE_CAP_PCT */
export function readSatelliteCapPct(prefs: Record<string, unknown>): number {
  return Number(prefs.virtual_satellite_cap_pct) === EXPERIMENT_CAP_PCT ? EXPERIMENT_CAP_PCT : SATELLITE_CAP_PCT;
}
/**
 * 이 금액 미만의 유휴현금은 스윕하지 않는다 (몇만 원씩 자주 사서 수수료만 나가는 것 방지).
 * 월 입금이 들어온 회차는 이 하한 없이 입금액만큼 산다 (resolveCashSweepIdleAmount의 depositAmount).
 */
const CASH_SWEEP_MIN_BUY_AMOUNT = 1_000_000;

/**
 * 지수 ETF로 옮길 유휴현금.
 * - 개별주용 현금 = 시드 × SATELLITE_CAP_PCT − 개별주 평가액 (개별주가 이미 몫을 채웠거나 넘었으면 0)
 * - 그 위의 현금은 지수로 간다. 개별주에서 번 돈도 몫을 넘으면 지수로 옮겨진다.
 * - 개별주에서 잃은 몫은 지수를 팔아 채우지 않는다 (2026-10-12: 지수를 팔아 개별주를 사는 경로를 없앰).
 * - 이번 회차에 월 입금이 들어왔으면 입금액(현금 한도 안)은 최소 금액과 무관하게 지수로 산다 — 새 돈은 지수로.
 */
export function resolveCashSweepIdleAmount(input: {
  availableCash: number;
  seedCapital: number;
  /** 봇 계좌 개별주(지수 ETF 제외) 평가액 */
  satelliteValue?: number;
  depositAmount?: number;
  /** 개별주 몫(%) — 기본 SATELLITE_CAP_PCT */
  capPct?: number;
}): number {
  const availableCash = Math.max(0, input.availableCash);
  const seedCapital = Math.max(0, input.seedCapital);
  if (seedCapital <= 0) return 0;
  const capPct = input.capPct ?? SATELLITE_CAP_PCT;
  if (capPct >= EXPERIMENT_CAP_PCT) return 0;
  const satelliteCash = Math.max(0, seedCapital * (capPct / 100) - Math.max(0, input.satelliteValue ?? 0));
  const idle = Math.max(0, availableCash - satelliteCash);
  const deposit = Math.min(availableCash, Math.max(0, input.depositAmount ?? 0));
  if (idle >= CASH_SWEEP_MIN_BUY_AMOUNT) return Math.floor(Math.max(idle, deposit));
  return Math.floor(deposit);
}
