import { createClient } from "@supabase/supabase-js";
import {
  getUserInvestmentPrefs,
  setUserInvestmentPrefs,
  type InvestmentPrefs,
} from "./userService";

export type VirtualTradeSide = "BUY" | "SELL" | "ADJUST";

export type SectorConcentration = {
  /** 섹터 ID (예: "KRX:IT") */
  sectorId: string;
  /** 섹터 표시명 (prefix 제거, 예: "IT") */
  sectorName: string;
  /** 투자금 기준 비중 (0~100) */
  ratio: number;
};

export type SectorConcentrationWarning = SectorConcentration & {
  level: "warning" | "danger";
};

export const SECTOR_CONCENTRATION_WARNING_RATIO = 30;
export const SECTOR_CONCENTRATION_DANGER_RATIO = 50;

/**
 * 보유 종목 목록을 받아 섹터별 투자 집중도를 계산한다.
 * investedAmount가 없는 종목(미매수 관심종목)은 제외한다.
 */
export function calculateSectorConcentration(
  holdings: Array<{ sectorId: string | null; investedAmount: number | null }>
): SectorConcentration[] {
  const sectorTotals = new Map<string, number>();
  let total = 0;

  for (const h of holdings) {
    if (!h.sectorId || !h.investedAmount || h.investedAmount <= 0) continue;
    sectorTotals.set(h.sectorId, (sectorTotals.get(h.sectorId) ?? 0) + h.investedAmount);
    total += h.investedAmount;
  }

  if (total <= 0) return [];

  return Array.from(sectorTotals.entries())
    .map(([sectorId, amount]) => ({
      sectorId,
      sectorName: sectorId.replace(/^[^:]+:/, ""),
      ratio: (amount / total) * 100,
    }))
    .sort((a, b) => b.ratio - a.ratio);
}

export function getSectorConcentrationWarnings(
  concentrations: SectorConcentration[],
  warningRatio = SECTOR_CONCENTRATION_WARNING_RATIO,
  dangerRatio = SECTOR_CONCENTRATION_DANGER_RATIO
): SectorConcentrationWarning[] {
  return concentrations
    .filter((concentration) => concentration.ratio > warningRatio)
    .map((concentration) => ({
      ...concentration,
      level: concentration.ratio > dangerRatio ? "danger" : "warning",
    }));
}

type WatchlistHoldingRow = {
  id: number;
  quantity?: number | null;
  buy_price?: number | null;
  invested_amount?: number | null;
  status?: string | null;
};

type NormalizedHolding = {
  id: number;
  quantity: number;
  buyPrice: number | null;
  investedAmount: number | null;
  status: "holding" | "closed";
};

export type SyncedPortfolioState = {
  seedCapital: number;
  cashBalance: number;
  realizedPnl: number;
  investedTotal: number;
  holdingCount: number;
};

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function toPositiveNumber(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function toFiniteNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function roundKrw(value: number): number {
  return Math.max(0, Math.round(value));
}

function deriveSeedCapital(prefs: InvestmentPrefs, investedTotal: number): number {
  const realizedPnl = toFiniteNumber(prefs.virtual_realized_pnl, 0);
  const inferredSeed = roundKrw(
    toFiniteNumber(prefs.virtual_cash, 0) + investedTotal - realizedPnl
  );

  return (
    toPositiveNumber(prefs.virtual_seed_capital) ??
    toPositiveNumber(prefs.capital_krw) ??
    inferredSeed
  );
}

export function normalizeWatchlistHolding(input: {
  id: number;
  quantity?: unknown;
  buyPrice?: unknown;
  investedAmount?: unknown;
  status?: unknown;
}): NormalizedHolding {
  const buyPrice = toPositiveNumber(input.buyPrice);
  const rawQty = Number(input.quantity);
  const quantity = Number.isFinite(rawQty) && rawQty > 0
    ? Math.floor(rawQty)
    : buyPrice
      ? 1
      : 0;

  if (!buyPrice || quantity <= 0) {
    return {
      id: input.id,
      quantity: 0,
      buyPrice,
      investedAmount: null,
      status: "closed",
    };
  }

  const computedInvested = roundKrw(quantity * buyPrice);
  const currentInvested = toPositiveNumber(input.investedAmount);
  const investedAmount = currentInvested && Math.abs(currentInvested - computedInvested) < 1
    ? Math.round(currentInvested)
    : computedInvested;

  return {
    id: input.id,
    quantity,
    buyPrice,
    investedAmount,
    status: "holding",
  };
}

export function deriveSyncedPortfolioState(input: {
  prefs: InvestmentPrefs;
  holdings: Array<Pick<NormalizedHolding, "investedAmount" | "status">>;
}): SyncedPortfolioState {
  const realizedPnl = toFiniteNumber(input.prefs.virtual_realized_pnl, 0);
  const investedTotal = roundKrw(
    input.holdings.reduce((sum, row) => {
      if (row.status !== "holding") return sum;
      return sum + toFiniteNumber(row.investedAmount, 0);
    }, 0)
  );
  const holdingCount = input.holdings.filter((row) => row.status === "holding").length;
  const seedCapital = deriveSeedCapital(input.prefs, investedTotal);
  const cashBalance = roundKrw(seedCapital + realizedPnl - investedTotal);

  return {
    seedCapital,
    cashBalance,
    realizedPnl,
    investedTotal,
    holdingCount,
  };
}

export async function syncVirtualPortfolio(
  chatId: number,
  tgId: number
): Promise<SyncedPortfolioState> {
  const prefs = await getUserInvestmentPrefs(tgId);
  const { data, error } = await supabase
    .from("watchlist")
    .select("id, quantity, buy_price, invested_amount, status")
    .eq("chat_id", chatId);

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as WatchlistHoldingRow[];
  const normalized = rows.map((row) =>
    normalizeWatchlistHolding({
      id: row.id,
      quantity: row.quantity,
      buyPrice: row.buy_price,
      investedAmount: row.invested_amount,
      status: row.status,
    })
  );

  for (let idx = 0; idx < rows.length; idx += 1) {
    const row = rows[idx];
    const next = normalized[idx];
    const currentQty = Math.max(0, Math.floor(Number(row.quantity ?? 0)));
    const currentBuyPrice = toPositiveNumber(row.buy_price);
    const currentInvested = toPositiveNumber(row.invested_amount);
    const currentStatus = row.status === "closed" ? "closed" : "holding";

    if (
      currentQty === next.quantity &&
      currentBuyPrice === next.buyPrice &&
      currentInvested === next.investedAmount &&
      currentStatus === next.status
    ) {
      continue;
    }

    const { error: updateError } = await supabase
      .from("watchlist")
      .update({
        quantity: next.quantity > 0 ? next.quantity : null,
        buy_price: next.buyPrice,
        invested_amount: next.investedAmount,
        status: next.status,
      })
      .eq("id", row.id);

    if (updateError) {
      throw updateError;
    }
  }

  const synced = deriveSyncedPortfolioState({ prefs, holdings: normalized });
  await setUserInvestmentPrefs(tgId, {
    virtual_seed_capital: synced.seedCapital,
    virtual_cash: synced.cashBalance,
    virtual_realized_pnl: synced.realizedPnl,
  });

  return synced;
}