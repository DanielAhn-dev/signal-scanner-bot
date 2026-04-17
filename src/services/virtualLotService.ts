import { createClient } from "@supabase/supabase-js";
import { PORTFOLIO_TABLES } from "../db/portfolioSchema";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

type LotRow = {
  id: number;
  remaining_quantity: number;
  acquired_quantity: number;
  acquired_price: number;
  acquired_at: string;
};

export type FifoSaleAllocation = {
  lotId: number;
  quantity: number;
  unitCost: number;
  costAmount: number;
  remainingQuantityAfter: number;
};

export type FifoSalePreview = {
  allocations: FifoSaleAllocation[];
  totalCost: number;
};

type EnsureTradeLotsInput = {
  chatId: number;
  watchlistId?: number | null;
  code: string;
  quantity: number;
  investedAmount?: number | null;
  buyPrice?: number | null;
  acquiredAt?: string | null;
  buyDate?: string | null;
};

type ReplaceTradeLotsInput = {
  chatId: number;
  watchlistId?: number | null;
  code: string;
  quantity: number;
  investedAmount?: number | null;
  buyPrice?: number | null;
  acquiredAt?: string | null;
  buyDate?: string | null;
  note?: string;
  sourceTradeId?: number | null;
};

function toPositiveNumber(value: unknown): number | null {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return num;
}

function toPositiveInteger(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : 0;
}

function resolveUnitCost(input: {
  quantity: number;
  investedAmount?: number | null;
  buyPrice?: number | null;
}): number | null {
  const quantity = toPositiveInteger(input.quantity);
  if (quantity <= 0) return null;

  const investedAmount = toPositiveNumber(input.investedAmount);
  if (investedAmount) {
    return Number((investedAmount / quantity).toFixed(4));
  }

  const buyPrice = toPositiveNumber(input.buyPrice);
  return buyPrice ? Number(buyPrice.toFixed(4)) : null;
}

function resolveAcquiredAt(input: {
  acquiredAt?: string | null;
  buyDate?: string | null;
}): string {
  const acquiredAt = String(input.acquiredAt ?? "").trim();
  if (acquiredAt) {
    const date = new Date(acquiredAt);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }

  const buyDate = String(input.buyDate ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(buyDate)) {
    const date = new Date(`${buyDate}T09:00:00+09:00`);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }

  return new Date().toISOString();
}

async function fetchOpenLots(chatId: number, code: string): Promise<LotRow[]> {
  const { data, error } = await supabase
    .from(PORTFOLIO_TABLES.lots)
    .select("id, remaining_quantity, acquired_quantity, acquired_price, acquired_at")
    .eq("chat_id", chatId)
    .eq("code", code)
    .gt("remaining_quantity", 0)
    .order("acquired_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw error;

  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: Number(row.id),
    remaining_quantity: Number(row.remaining_quantity ?? 0),
    acquired_quantity: Number(row.acquired_quantity ?? 0),
    acquired_price: Number(row.acquired_price ?? 0),
    acquired_at: String(row.acquired_at ?? ""),
  }));
}

export async function ensureTradeLotsForHolding(
  input: EnsureTradeLotsInput
): Promise<LotRow[]> {
  const existingLots = await fetchOpenLots(input.chatId, input.code);
  if (existingLots.length) return existingLots;

  const quantity = toPositiveInteger(input.quantity);
  const unitCost = resolveUnitCost(input);
  if (quantity <= 0 || !unitCost) return [];

  const nowIso = new Date().toISOString();
  const { error } = await supabase.from(PORTFOLIO_TABLES.lots).insert({
    chat_id: input.chatId,
    watchlist_id: input.watchlistId ?? null,
    code: input.code,
    acquired_price: unitCost,
    acquired_quantity: quantity,
    remaining_quantity: quantity,
    acquired_at: resolveAcquiredAt(input),
    seed_watchlist_id: input.watchlistId ?? null,
    note: "fifo-migration-seed",
    created_at: nowIso,
    updated_at: nowIso,
  });

  if (error) throw error;

  return fetchOpenLots(input.chatId, input.code);
}

export async function previewFifoSale(input: {
  chatId: number;
  code: string;
  quantity: number;
}): Promise<FifoSalePreview> {
  const quantity = toPositiveInteger(input.quantity);
  if (quantity <= 0) {
    return { allocations: [], totalCost: 0 };
  }

  const lots = await fetchOpenLots(input.chatId, input.code);
  let remaining = quantity;
  const allocations: FifoSaleAllocation[] = [];

  for (const lot of lots) {
    if (remaining <= 0) break;
    const takeQty = Math.min(remaining, toPositiveInteger(lot.remaining_quantity));
    if (takeQty <= 0) continue;

    const unitCost = Number(lot.acquired_price ?? 0);
    const costAmount = Math.round(unitCost * takeQty);
    allocations.push({
      lotId: lot.id,
      quantity: takeQty,
      unitCost,
      costAmount,
      remainingQuantityAfter: Math.max(0, lot.remaining_quantity - takeQty),
    });
    remaining -= takeQty;
  }

  if (remaining > 0) {
    throw new Error(`FIFO lots are insufficient for ${input.code}: need ${quantity}, left ${remaining}`);
  }

  return {
    allocations,
    totalCost: allocations.reduce((sum, item) => sum + item.costAmount, 0),
  };
}

export async function applyFifoSale(input: {
  chatId: number;
  code: string;
  exitPrice: number;
  tradeId?: number | null;
  allocations: FifoSaleAllocation[];
}): Promise<void> {
  const nowIso = new Date().toISOString();

  for (const allocation of input.allocations) {
    const nextRemaining = Math.max(0, allocation.remainingQuantityAfter);
    const updatePayload = {
      remaining_quantity: nextRemaining,
      updated_at: nowIso,
      closed_at: nextRemaining === 0 ? nowIso : null,
    };

    const { error: updateError } = await supabase
      .from(PORTFOLIO_TABLES.lots)
      .update(updatePayload)
      .eq("id", allocation.lotId)
      .eq("chat_id", input.chatId)
      .eq("code", input.code);

    if (updateError) throw updateError;
  }

  if (!input.tradeId || !input.allocations.length) return;

  const rows = input.allocations.map((allocation) => ({
    trade_id: input.tradeId,
    lot_id: allocation.lotId,
    chat_id: input.chatId,
    code: input.code,
    quantity: allocation.quantity,
    unit_cost: allocation.unitCost,
    cost_amount: allocation.costAmount,
    pnl_amount: Math.round((input.exitPrice - allocation.unitCost) * allocation.quantity),
    created_at: nowIso,
  }));

  const { error: insertError } = await supabase
    .from(PORTFOLIO_TABLES.lotMatches)
    .insert(rows);

  if (insertError) throw insertError;
}

export async function replaceTradeLotsForHolding(
  input: ReplaceTradeLotsInput
): Promise<void> {
  const nowIso = new Date().toISOString();
  const quantity = toPositiveInteger(input.quantity);
  const unitCost = resolveUnitCost(input);

  const { error: closeError } = await supabase
    .from(PORTFOLIO_TABLES.lots)
    .update({
      remaining_quantity: 0,
      closed_at: nowIso,
      updated_at: nowIso,
    })
    .eq("chat_id", input.chatId)
    .eq("code", input.code)
    .gt("remaining_quantity", 0);

  if (closeError) throw closeError;

  if (quantity <= 0 || !unitCost) return;

  const { error: insertError } = await supabase
    .from(PORTFOLIO_TABLES.lots)
    .insert({
      chat_id: input.chatId,
      watchlist_id: input.watchlistId ?? null,
      code: input.code,
      acquired_price: unitCost,
      acquired_quantity: quantity,
      remaining_quantity: quantity,
      acquired_at: resolveAcquiredAt(input),
      source_trade_id: input.sourceTradeId ?? null,
      note: input.note ?? "watchlist-adjust-reset",
      created_at: nowIso,
      updated_at: nowIso,
    });

  if (insertError) throw insertError;
}