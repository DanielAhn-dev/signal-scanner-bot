/**
 * 지수 1.5배 모드 — 계정별로 켜는 공격형 전략 (종목 매매 봇 대신 실행).
 *
 * 규칙: 코스피 50일선 위 → KODEX 200 50% + KODEX 레버리지(2배) 50% (합쳐서 지수 약 1.5배)
 *       50일선 아래 → CD금리 ETF (전부 파킹) · 판정 불가 → 매매하지 않음(보유 유지)
 * 판정 값은 봇 신규 매수·유휴현금 스윕과 같은 kospiSma50 (KODEX 200 종가 / 직전 50일 평균).
 *
 * 근거 (코스피 1996~2026 일봉, 다음 날 체결, 선물형 레버리지 모델 — 2026-09-29 검증):
 *   50일선 1배 연 10.5%·최대낙폭 -34% / 50일선 1.5배 13.2%·-51% / 50일선 2배 15.0%·-64% / 계속 보유 9.8%·-64%.
 *   2007~2016에는 1배·1.5배·2배 모두 연 3.4~3.6%로 레버리지 이득이 없었다 — 수익이 늘 거라는 보장이 아니라
 *   "오를 때 더 벌고 낙폭도 그만큼 큰" 선택이다. 그래서 관리자 계좌 기본값이 아니라 소액 실험 계정용 옵션이다.
 * 세금 반영 재검증 (2026-09-29, 실제 KODEX 200·KODEX 레버리지 가격 2010-02~2026-09, 다음 날 종가 체결):
 *   레버리지는 기타 ETF라 팔 때 이익에 15.4%가 붙고 손실은 상계되지 않는다 (KODEX 200은 비과세, 일반 계좌 기준).
 *   50일선 1.5배 세전 10.4% → 세후 7.9%·낙폭 -47% / 50일선 1배 세후 8.2%·-29% / KODEX 200 보유 14.1%·-41%.
 *   2010~2017은 1.5배 세후 0.5%. 일반 계좌에서는 1배보다 낫다는 근거가 없다 — 가상 계좌도 이 세금을 뺀다
 *   (securitiesTax.resolveOtherEtfGainTax).
 *   50일선 구간 안에서 반반 비율을 다시 맞추는 것(±5%p·±10%p·매일)은 구간 진입 때만 맞추는 것과
 *   연수익·낙폭 차이가 0.1%p 안팎이고 매매만 10배 늘어서, 50일선을 넘나들 때와 새 현금이 생겼을 때만 매매한다.
 */
import { INDEX_SWEEP_CODES, RATE_SWEEP_CODES } from "./virtualAutoTradeCashSweep";

/** users.prefs.virtual_strategy_mode 값 */
export const INDEX_LEVERAGE_MODE = "index_lev15" as const;
export type VirtualStrategyMode = "stock" | typeof INDEX_LEVERAGE_MODE;

/** 이 모드로 산 포지션의 메모 전략 ID — 종목 봇의 손절·익절·통계 루프가 건드리지 않게 구분한다 */
export const INDEX_LEVERAGE_STRATEGY_ID = "index-lev15.v1";

/** 2배 레버리지 ETF (우선순위 순, 종가가 있는 첫 번째 사용) */
export const LEVERAGE_ETF_CODES = ["122630"]; // KODEX 레버리지

/** 이 모드가 다루는 ETF 전체 */
export const INDEX_MODE_CODES = [...INDEX_SWEEP_CODES, ...LEVERAGE_ETF_CODES, ...RATE_SWEEP_CODES];

export function normalizeStrategyMode(raw: unknown): VirtualStrategyMode {
  return raw === INDEX_LEVERAGE_MODE ? INDEX_LEVERAGE_MODE : "stock";
}

export function isLeverageEtfCode(code: string | null | undefined): boolean {
  return LEVERAGE_ETF_CODES.includes(String(code ?? "").trim());
}

export type IndexModeHolding = { code: string; quantity: number; price: number };
export type IndexModeOrder = { code: string; quantity: number };

export type IndexModePlan = {
  /** 50일선 위(1.5배) / 아래(금리) / 판정 불가(금리) */
  regime: "up" | "down" | "unknown";
  /** 목표 비중 (코드 → 0~1) */
  targets: Array<{ code: string; weight: number }>;
  sell: IndexModeOrder[];
  buy: IndexModeOrder[];
  /** 매매를 못 하거나 보류한 이유 */
  notes: string[];
};

/** 수수료·체결 여유분 — 현금보다 많이 사지 않도록 이만큼 남긴다 */
const BUY_BUFFER = 1.005;

function pickPriced(codes: string[], prices: Map<string, number>, maxPrice = Infinity): string | null {
  return codes.find((code) => {
    const price = prices.get(code) ?? 0;
    return price > 0 && price <= maxPrice;
  }) ?? null;
}

/**
 * 이번 실행에서 팔고 살 수량을 정한다 (DB 없이 계산만).
 * - 목표에 없는 보유분은 전량 매도 (50일선을 넘나들 때 갈아타기)
 * - 목표 종목은 팔지 않고, 현금이 있으면 목표 비중보다 모자란 쪽부터 채운다
 * - 50일선 위인데 레버리지·지수 ETF 종가가 없으면 1.5배를 만들 수 없으므로 이번엔 매매하지 않는다
 */
export function planIndexModeRebalance(input: {
  kospiSma50Ratio: number | null | undefined;
  cash: number;
  holdings: IndexModeHolding[];
  prices: Map<string, number>;
  feeRate?: number;
}): IndexModePlan {
  const feeRate = Math.max(0, input.feeRate ?? 0.00015);
  const ratio = input.kospiSma50Ratio;
  const regime: IndexModePlan["regime"] =
    ratio == null || !Number.isFinite(ratio) ? "unknown" : ratio >= 1 ? "up" : "down";
  const holdings = input.holdings.filter((h) => h.quantity > 0 && h.price > 0);
  const notes: string[] = [];

  // 판정 불가(지수 일봉 조회 실패·부족)는 시장 신호가 아니라 데이터 문제 — 들고 있는 것을 그대로 둔다.
  // 예전엔 금리 ETF로 전량 갈아타서, 조회 한 번 실패하면 1.5배 포지션을 팔았다가 다음 날 다시 샀다.
  if (regime === "unknown") {
    notes.push("코스피 50일선을 판정할 수 없어 이번에는 매매하지 않습니다 (보유 유지)");
    return { regime, targets: [], sell: [], buy: [], notes };
  }

  let targets: Array<{ code: string; weight: number }>;
  if (regime === "up") {
    const indexCode = pickPriced(INDEX_SWEEP_CODES, input.prices);
    const leverageCode = pickPriced(LEVERAGE_ETF_CODES, input.prices);
    if (!indexCode || !leverageCode) {
      notes.push(`${!leverageCode ? "레버리지" : "지수"} ETF 종가가 아직 없어 이번에는 매매하지 않습니다`);
      return { regime, targets: [], sell: [], buy: [], notes };
    }
    targets = [
      { code: indexCode, weight: 0.5 },
      { code: leverageCode, weight: 0.5 },
    ];
  } else {
    // 이미 들고 있는 금리 ETF가 있으면 그대로 쓴다 (종목만 바꾸는 왕복 매매 방지)
    const heldRate = holdings.find((h) => RATE_SWEEP_CODES.includes(h.code));
    const totalValue = Math.max(0, input.cash) + holdings.reduce((s, h) => s + h.quantity * h.price, 0);
    // 1주 값이 계좌보다 비싼 금리 ETF(예: KODEX CD금리 1주 100만원대)는 소액 계좌가 못 산다 — 살 수 있는 것부터
    const rateCode = heldRate?.code ?? pickPriced(RATE_SWEEP_CODES, input.prices, totalValue / BUY_BUFFER);
    targets = rateCode ? [{ code: rateCode, weight: 1 }] : [];
    if (!rateCode) notes.push("살 수 있는 금리 ETF 종가가 없어 현금으로 둡니다");
  }

  const targetCodes = new Set(targets.map((t) => t.code));
  const sell = holdings
    .filter((h) => !targetCodes.has(h.code))
    .map((h) => ({ code: h.code, quantity: h.quantity }));

  const sellProceeds = holdings
    .filter((h) => !targetCodes.has(h.code))
    .reduce((s, h) => s + h.quantity * h.price * (1 - feeRate), 0);
  const cash = Math.max(0, input.cash) + sellProceeds;
  const keptValue = (code: string) =>
    holdings.filter((h) => h.code === code).reduce((s, h) => s + h.quantity * h.price, 0);
  const equity = cash + targets.reduce((s, t) => s + keptValue(t.code), 0);

  // 목표보다 모자란 금액 — 현금이 부족하면 모자란 비율대로 나눈다
  const shortfalls = targets.map((t) => ({ ...t, need: Math.max(0, equity * t.weight - keptValue(t.code)) }));
  const totalNeed = shortfalls.reduce((s, t) => s + t.need, 0);
  const budget = cash / BUY_BUFFER;
  const scale = totalNeed > budget && totalNeed > 0 ? budget / totalNeed : 1;

  const buy: IndexModeOrder[] = [];
  for (const t of shortfalls) {
    const price = input.prices.get(t.code) ?? 0;
    const quantity = price > 0 ? Math.floor((t.need * scale) / price) : 0;
    if (quantity <= 0) continue;
    buy.push({ code: t.code, quantity });
  }
  return { regime, targets, sell, buy, notes };
}

export function describeIndexModeRegime(regime: IndexModePlan["regime"]): string {
  if (regime === "up") return "코스피 50일선 위 → KODEX 200 50% + 레버리지 50% (지수 약 1.5배)";
  if (regime === "down") return "코스피 50일선 아래 → 금리 ETF";
  return "50일선 판정 불가 → 보유 유지";
}
