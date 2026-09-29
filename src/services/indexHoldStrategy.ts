/**
 * 지수 보유 모드 — 계정별로 켜는 초보자용 전략 (종목 매매 봇 대신 실행).
 *
 * 규칙: KODEX 200을 계속 보유한다. 새로 들어온 현금(입금·정리 매도 대금)도 KODEX 200을 산다. 파는 조건은 없다.
 *   종목을 고르지 않고 매매가 거의 없어서, 100만원 + 월 적립으로 그대로 따라 하기 쉽다.
 *
 * 근거 (2026-09-29, 실제 ETF 가격 2010-02~2026-09, 신호 다음 날 체결·세금 반영):
 *   KODEX 200 보유 연 14.1%·최대낙폭 -41% / 50일선 1배 8.2%·-29% / 50일선 1.5배(레버리지 50%) 세후 7.9%·-47%.
 *   30년 코스피로는 50일선 규칙이 연 9.3% vs 보유 8.3%로 앞서지만 그 차이는 1997~2002 위기 구간에서만 나왔다.
 *   시총 상위 종목 선별은 10년간 지수를 이기지 못했다. 레버리지는 세금(기타 ETF 매매차익 15.4%) 뒤 이득이 없어 뺐다.
 *   대가: 코스피가 -40% 떨어지면 그대로 맞는다 — 떨어질 때 팔지 않고 적립을 계속하는 것이 이 모드의 전제다.
 *
 * 예전 지수 1.5배 모드(index_lev15)를 켜 둔 계정은 이 모드로 이어지고, 들고 있던 레버리지·금리 ETF는
 * 다음 실행 때 팔아서 KODEX 200으로 옮긴다.
 */
import { INDEX_SWEEP_CODES, RATE_SWEEP_CODES } from "./virtualAutoTradeCashSweep";

/** users.prefs.virtual_strategy_mode 값 */
export const INDEX_HOLD_MODE = "index_hold" as const;
/** 예전 지수 1.5배 모드 값 — 저장된 계정은 지수 보유 모드로 본다 */
const LEGACY_INDEX_LEVERAGE_MODE = "index_lev15";
export type VirtualStrategyMode = "stock" | typeof INDEX_HOLD_MODE;

/** 이 모드로 산 포지션의 메모 전략 ID — 종목 봇의 손절·익절·통계 루프가 건드리지 않게 구분한다 */
export const INDEX_HOLD_STRATEGY_ID = "index-hold.v1";
/** 예전 1.5배 모드로 산 포지션의 전략 ID (보유분 인식용) */
export const LEGACY_INDEX_LEVERAGE_STRATEGY_ID = "index-lev15.v1";
export const INDEX_MODE_STRATEGY_IDS = [INDEX_HOLD_STRATEGY_ID, LEGACY_INDEX_LEVERAGE_STRATEGY_ID];

/** 예전 1.5배 모드가 사던 2배 레버리지 ETF — 이제는 팔기만 한다 */
export const LEVERAGE_ETF_CODES = ["122630"]; // KODEX 레버리지

/** 이 모드가 다루는 ETF 전체 (보유분 조회·정리용) */
export const INDEX_MODE_CODES = [...INDEX_SWEEP_CODES, ...LEVERAGE_ETF_CODES, ...RATE_SWEEP_CODES];

export function normalizeStrategyMode(raw: unknown): VirtualStrategyMode {
  return raw === INDEX_HOLD_MODE || raw === LEGACY_INDEX_LEVERAGE_MODE ? INDEX_HOLD_MODE : "stock";
}

export function isLeverageEtfCode(code: string | null | undefined): boolean {
  return LEVERAGE_ETF_CODES.includes(String(code ?? "").trim());
}

export type IndexModeHolding = { code: string; quantity: number; price: number };
export type IndexModeOrder = { code: string; quantity: number };

export type IndexModePlan = {
  /** 보유할 지수 ETF (종가가 없으면 null) */
  target: string | null;
  sell: IndexModeOrder[];
  buy: IndexModeOrder[];
  /** 매매를 못 하거나 보류한 이유 */
  notes: string[];
};

/** 수수료·체결 여유분 — 현금보다 많이 사지 않도록 이만큼 남긴다 */
const BUY_BUFFER = 1.005;

/**
 * 이번 실행에서 팔고 살 수량을 정한다 (DB 없이 계산만).
 * - 이미 들고 있는 지수 ETF가 있으면 그 종목을 유지한다 (KODEX 200 ↔ TIGER 200 왕복 방지)
 * - 지수 ETF가 아닌 보유분(레버리지·금리 ETF)은 전량 매도
 * - 현금은 전부 지수 ETF로 (1주 단위)
 */
export function planIndexHoldRebalance(input: {
  cash: number;
  holdings: IndexModeHolding[];
  prices: Map<string, number>;
  feeRate?: number;
}): IndexModePlan {
  const feeRate = Math.max(0, input.feeRate ?? 0.00015);
  const holdings = input.holdings.filter((h) => h.quantity > 0 && h.price > 0);
  const priced = (code: string) => (input.prices.get(code) ?? 0) > 0;
  // 들고 있는 지수 ETF의 실시간가가 없으면 이번엔 쉰다 — 다른 지수 ETF로 새로 사면 두 종목으로 갈라진다
  if (input.holdings.some((h) => h.quantity > 0 && INDEX_SWEEP_CODES.includes(h.code) && !priced(h.code))) {
    return { target: null, sell: [], buy: [], notes: ["보유 지수 ETF의 실시간가가 없어 이번에는 매매하지 않습니다 (다음 회차에 다시)"] };
  }
  const heldIndex = holdings.find((h) => INDEX_SWEEP_CODES.includes(h.code) && priced(h.code));
  const target = heldIndex?.code ?? INDEX_SWEEP_CODES.find(priced) ?? null;
  if (!target) {
    return { target, sell: [], buy: [], notes: ["지수 ETF 가격이 없어 이번에는 매매하지 않습니다"] };
  }

  const sellRows = holdings.filter((h) => h.code !== target);
  const sell = sellRows.map((h) => ({ code: h.code, quantity: h.quantity }));
  const sellProceeds = sellRows.reduce((s, h) => s + h.quantity * h.price * (1 - feeRate), 0);
  const cash = Math.max(0, input.cash) + sellProceeds;
  const price = input.prices.get(target)!;
  const quantity = Math.floor(cash / BUY_BUFFER / price);
  return { target, sell, buy: quantity > 0 ? [{ code: target, quantity }] : [], notes: [] };
}

export const INDEX_HOLD_DESCRIPTION = "KODEX 200 계속 보유 (새 현금도 KODEX 200)";
