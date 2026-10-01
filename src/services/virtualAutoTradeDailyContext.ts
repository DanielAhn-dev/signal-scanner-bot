/**
 * 일일점검 준비 단계의 계산 — 보유 종목 시세 맵 구성과 가용현금 결정. DB·API 없이 계산만 한다.
 * 조회(stocks·실시간가)와 알림·로그는 호출측(runDailyReviewForUser)이 맡는다.
 */

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export type HoldingQuoteMaps = {
  closeByCode: Map<string, number>;
  nameByCode: Map<string, string>;
  marketByCode: Map<string, string>;
  sectorIdByCode: Map<string, string>;
  isSectorLeaderByCode: Map<string, boolean>;
};

/** stocks 행으로 종목별 종가·이름·시장·섹터·섹터 리더 맵을 만든다 (종가가 0 이하면 종가 맵에서 뺀다) */
export function buildHoldingQuoteMaps(rows: Array<Record<string, unknown>>): HoldingQuoteMaps {
  const maps: HoldingQuoteMaps = {
    closeByCode: new Map(),
    nameByCode: new Map(),
    marketByCode: new Map(),
    sectorIdByCode: new Map(),
    isSectorLeaderByCode: new Map(),
  };
  for (const row of rows) {
    const code = String(row.code ?? "");
    if (!code) continue;
    const name = String(row.name ?? "").trim();
    const close = toNumber(row.close, 0);
    const market = String(row.market ?? "");
    const sectorId = String(row.sector_id ?? "");
    if (close > 0) maps.closeByCode.set(code, close);
    if (name) maps.nameByCode.set(code, name);
    if (market) maps.marketByCode.set(code, market);
    if (sectorId) maps.sectorIdByCode.set(code, sectorId);
    maps.isSectorLeaderByCode.set(code, row.is_sector_leader === true);
  }
  return maps;
}

/** 시세 최신화가 이만큼 지나면 계정 전체 매매 판단을 멈춘다 (배치 정지 사고 방지) */
export const STALE_PRICE_GUARD_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * 보유 종목 시세가 오래됐는지 (계정 단위). 보유가 없으면 판단하지 않는다.
 * @returns stale이면 최신화 후 경과 일수 (알 수 없으면 null)
 */
export function evaluateQuoteStaleness(input: {
  rows: Array<Record<string, unknown>>;
  hasHoldings: boolean;
  now?: number;
}): { stale: false } | { stale: true; staleDays: number | null; freshestUpdatedAt: number | null } {
  if (!input.hasHoldings) return { stale: false };
  const now = input.now ?? Date.now();
  const updatedAts = input.rows
    .map((row) => Date.parse(String(row.updated_at ?? "")))
    .filter((ts) => Number.isFinite(ts));
  const freshestUpdatedAt = updatedAts.length ? Math.max(...updatedAts) : null;
  if (freshestUpdatedAt !== null && now - freshestUpdatedAt <= STALE_PRICE_GUARD_MS) return { stale: false };
  return {
    stale: true,
    staleDays: freshestUpdatedAt !== null ? Math.floor((now - freshestUpdatedAt) / (24 * 60 * 60 * 1000)) : null,
    freshestUpdatedAt,
  };
}

/**
 * 이번 회차 가용현금. 저장된 현금(prefs.virtual_cash)을 쓰되, 0 이하이거나 없으면
 * "시드 + 실현손익 − 보유 투자금"(syncVirtualPortfolio와 같은 식)으로 보정한다.
 *
 * 보유 투자금에는 유휴현금 스윕 보유분도 넣어야 한다 — 예전엔 스윕을 뺀 보유분으로 계산해,
 * 보정이 일어나면 스윕에 들어 있는 돈이 현금으로도 잡혔다.
 * 수동 학습(dryRun)의 스윕 현금화 예정액은 보정 뒤에 더한다 — 예전엔 보정이 그 금액을 덮어썼다.
 */
export function resolveReviewCash(input: {
  storedCash: unknown;
  seedCapital: number;
  realizedPnl: number;
  /** 스윕 보유분을 포함한 모든 봇 보유 포지션 */
  holdings: Array<{ quantity: number | null; buy_price: number | null; invested_amount: number | null }>;
  /** dryRun 수동 학습에서만 0보다 크다 */
  simulatedSweepReleaseCash: number;
}): { availableCash: number; corrected: boolean } {
  const storedRaw = Number(input.storedCash);
  const storedCash = Number.isFinite(storedRaw) ? Math.max(0, storedRaw) : null;
  const invested = input.holdings.reduce((sum, row) => {
    const qty = Math.max(0, Math.floor(toNumber(row.quantity, 0)));
    const buyPrice = Math.max(0, toNumber(row.buy_price, 0));
    const investedAmount = Math.max(0, toNumber(row.invested_amount, 0));
    const fallbackInvested = qty > 0 && buyPrice > 0 ? Math.round(qty * buyPrice) : 0;
    return sum + Math.max(investedAmount, fallbackInvested);
  }, 0);
  const derivedCash = Math.max(0, Math.round(input.seedCapital + input.realizedPnl - invested));
  const corrected = (storedCash ?? 0) <= 0 && derivedCash > 0;
  const base = corrected ? derivedCash : storedCash ?? derivedCash;
  return { availableCash: base + Math.max(0, input.simulatedSweepReleaseCash), corrected };
}
