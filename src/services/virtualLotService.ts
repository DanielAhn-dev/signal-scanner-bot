import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { PORTFOLIO_TABLES } from "../db/portfolioSchema";

// 로트는 보유 행(virtual_positions.id = position_id) 단위로만 다룬다.
// 한 계정에 봇 가상 행과 여러 실계좌 행이 같은 종목으로 함께 있을 수 있어서,
// chat_id+code로 찾으면 다른 계좌 로트로 원가를 계산하거나 닫아 버린다(DB RPC 027도 position_id로 매칭).
// position_id가 null인 옛 로트(보유 행 삭제로 SET NULL 된 것 포함)는 어느 계좌 것인지 알 수 없으므로
// 원가 계산·닫기 대상에서 빼고, 운영 정합성 점검의 orphan 정리로만 처리한다.
type LotDb = Pick<SupabaseClient, "from">;

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
  /** 보유 행 id(virtual_positions.id). 없으면 어느 계좌 로트인지 알 수 없어 거부한다. */
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
  /** 보유 행 id. 전량 매도 후 정리(quantity 0)여도 넘겨야 그 행의 로트만 닫는다. */
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

type AppendTradeLotsInput = {
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

function requirePositionId(positionId: number | null | undefined, code: string): number {
  const id = toPositiveInteger(positionId);
  if (id <= 0) throw new Error(`position id is required for lots of ${code}`);
  return id;
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

export function createVirtualLotService(db: LotDb) {
  async function fetchOpenLots(chatId: number, positionId: number): Promise<LotRow[]> {
    const { data, error } = await db
      .from(PORTFOLIO_TABLES.lots)
      .select("id, remaining_quantity, acquired_quantity, acquired_price, acquired_at")
      .eq("chat_id", chatId)
      .eq("position_id", positionId)
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

  async function ensureTradeLotsForHolding(input: EnsureTradeLotsInput): Promise<LotRow[]> {
    const positionId = requirePositionId(input.watchlistId, input.code);
    const existingLots = await fetchOpenLots(input.chatId, positionId);
    if (existingLots.length) return existingLots;

    const quantity = toPositiveInteger(input.quantity);
    const unitCost = resolveUnitCost(input);
    if (quantity <= 0 || !unitCost) return [];

    const nowIso = new Date().toISOString();
    const { error } = await db.from(PORTFOLIO_TABLES.lots).insert({
      chat_id: input.chatId,
      watchlist_id: positionId,
      position_id: positionId,
      code: input.code,
      acquired_price: unitCost,
      acquired_quantity: quantity,
      remaining_quantity: quantity,
      acquired_at: resolveAcquiredAt(input),
      seed_watchlist_id: positionId,
      seed_position_id: positionId,
      note: "fifo-migration-seed",
      created_at: nowIso,
      updated_at: nowIso,
    });

    if (error) throw error;

    return fetchOpenLots(input.chatId, positionId);
  }

  async function previewFifoSale(input: {
    chatId: number;
    /** 파는 보유 행 id. 이 행의 로트만 소진한다. */
    positionId: number | null;
    code: string;
    quantity: number;
  }): Promise<FifoSalePreview> {
    const quantity = toPositiveInteger(input.quantity);
    if (quantity <= 0) {
      return { allocations: [], totalCost: 0 };
    }

    const lots = await fetchOpenLots(input.chatId, requirePositionId(input.positionId, input.code));
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

  async function applyFifoSale(input: {
    chatId: number;
    code: string;
    exitPrice: number;
    tradeId?: number | null;
    allocations: FifoSaleAllocation[];
  }): Promise<void> {
    const nowIso = new Date().toISOString();

    // 로트 id는 previewFifoSale이 보유 행 기준으로 고른 것이라 그대로 갱신한다
    for (const allocation of input.allocations) {
      const nextRemaining = Math.max(0, allocation.remainingQuantityAfter);
      const updatePayload = {
        remaining_quantity: nextRemaining,
        updated_at: nowIso,
        closed_at: nextRemaining === 0 ? nowIso : null,
      };

      const { error: updateError } = await db
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

    const { error: insertError } = await db
      .from(PORTFOLIO_TABLES.lotMatches)
      .insert(rows);

    if (insertError) throw insertError;
  }

  async function replaceTradeLotsForHolding(input: ReplaceTradeLotsInput): Promise<void> {
    const nowIso = new Date().toISOString();
    const positionId = requirePositionId(input.watchlistId, input.code);
    const quantity = toPositiveInteger(input.quantity);
    const unitCost = resolveUnitCost(input);

    // 이 보유 행의 로트만 닫는다(같은 종목의 다른 계좌 로트는 그대로 둔다)
    const { error: closeError } = await db
      .from(PORTFOLIO_TABLES.lots)
      .update({
        remaining_quantity: 0,
        closed_at: nowIso,
        updated_at: nowIso,
      })
      .eq("chat_id", input.chatId)
      .eq("position_id", positionId)
      .gt("remaining_quantity", 0);

    if (closeError) throw closeError;

    if (quantity <= 0 || !unitCost) return;

    const { error: insertError } = await db
      .from(PORTFOLIO_TABLES.lots)
      .insert({
        chat_id: input.chatId,
        watchlist_id: positionId,
        position_id: positionId,
        code: input.code,
        acquired_price: unitCost,
        acquired_quantity: quantity,
        remaining_quantity: quantity,
        acquired_at: resolveAcquiredAt(input),
        source_trade_id: input.sourceTradeId ?? null,
        note: input.note ?? "position-adjust-reset",
        created_at: nowIso,
        updated_at: nowIso,
      });

    if (insertError) throw insertError;
  }

  async function appendTradeLotsForHolding(input: AppendTradeLotsInput): Promise<void> {
    const nowIso = new Date().toISOString();
    const positionId = requirePositionId(input.watchlistId, input.code);
    const quantity = toPositiveInteger(input.quantity);
    const unitCost = resolveUnitCost(input);

    if (quantity <= 0 || !unitCost) return;

    const { error: insertError } = await db
      .from(PORTFOLIO_TABLES.lots)
      .insert({
        chat_id: input.chatId,
        watchlist_id: positionId,
        position_id: positionId,
        code: input.code,
        acquired_price: unitCost,
        acquired_quantity: quantity,
        remaining_quantity: quantity,
        acquired_at: resolveAcquiredAt(input),
        source_trade_id: input.sourceTradeId ?? null,
        note: input.note ?? "position-add-on",
        created_at: nowIso,
        updated_at: nowIso,
      });

    if (insertError) throw insertError;
  }

  return {
    ensureTradeLotsForHolding,
    previewFifoSale,
    applyFifoSale,
    replaceTradeLotsForHolding,
    appendTradeLotsForHolding,
  };
}

type VirtualLotService = ReturnType<typeof createVirtualLotService>;

let defaultService: VirtualLotService | null = null;
function lotService(): VirtualLotService {
  if (!defaultService) {
    defaultService = createVirtualLotService(
      createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
    );
  }
  return defaultService;
}

export const ensureTradeLotsForHolding: VirtualLotService["ensureTradeLotsForHolding"] = (input) =>
  lotService().ensureTradeLotsForHolding(input);
export const previewFifoSale: VirtualLotService["previewFifoSale"] = (input) =>
  lotService().previewFifoSale(input);
export const applyFifoSale: VirtualLotService["applyFifoSale"] = (input) =>
  lotService().applyFifoSale(input);
export const replaceTradeLotsForHolding: VirtualLotService["replaceTradeLotsForHolding"] = (input) =>
  lotService().replaceTradeLotsForHolding(input);
export const appendTradeLotsForHolding: VirtualLotService["appendTradeLotsForHolding"] = (input) =>
  lotService().appendTradeLotsForHolding(input);
