import { createClient } from "@supabase/supabase-js";
import { PORTFOLIO_TABLES } from "../db/portfolioSchema";
import {
  applyFifoSale,
  ensureTradeLotsForHolding,
  previewFifoSale,
} from "./virtualLotService";
import {
  getUserInvestmentPrefs,
  setUserInvestmentPrefs,
} from "./userService";
import { syncVirtualPortfolio } from "./portfolioService";
import { buildStrategyMemo } from "../lib/strategyMemo";
import { appendVirtualDecisionLog } from "./decisionLogService";

type RunMode = "auto" | "monday" | "daily";
type RunType = "MONDAY_BUY" | "DAILY_REVIEW" | "MANUAL";
type SupabaseClientAny = any;

type AutoTradeSettingRow = {
  chat_id: number;
  is_enabled: boolean;
  monday_buy_slots: number;
  max_positions: number;
  min_buy_score: number;
  take_profit_pct: number;
  stop_loss_pct: number;
  last_monday_buy_at?: string | null;
  last_daily_review_at?: string | null;
  selected_strategy?: string | null;
};

const AUTO_TRADE_STRATEGY_ID = "core.autotrade.v1";

export type AutoTradeRunMode = RunMode;

export type ChatAutoTradeRunSummary = {
  mode: RunMode;
  runType: RunType;
  runKey: string;
  dryRun: boolean;
  action: AutoTradeActionSummary;
};

type HoldingRow = {
  id: number;
  code: string;
  buy_price: number | null;
  buy_date?: string | null;
  created_at?: string | null;
  quantity: number | null;
  invested_amount: number | null;
  status?: string | null;
};

type ScoreCandidateRow = {
  code: string;
  total_score: number | null;
  signal: string | null;
  stock: {
    code: string;
    name: string | null;
    close: number | null;
  } | Array<{
    code: string;
    name: string | null;
    close: number | null;
  }> | null;
};

export type AutoTradeActionSummary = {
  chatId: number;
  buys: number;
  sells: number;
  skipped: number;
  errors: number;
  notes: string[];
};

export type AutoTradeRunSummary = {
  mode: RunMode;
  runType: RunType;
  runKey: string;
  totalUsers: number;
  processedUsers: number;
  buyCount: number;
  sellCount: number;
  skippedCount: number;
  errorCount: number;
  actions: AutoTradeActionSummary[];
};

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toPositiveInt(value: unknown, fallback: number): number {
  const n = Math.floor(toNumber(value, fallback));
  return n > 0 ? n : fallback;
}

function kstNow(base = new Date()): Date {
  return new Date(base.getTime() + 9 * 60 * 60 * 1000);
}

function kstDateKey(base = new Date()): string {
  const d = kstNow(base);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isKstMonday(base = new Date()): boolean {
  return kstNow(base).getUTCDay() === 1;
}

function normalizeStock(input: ScoreCandidateRow["stock"]): {
  name: string;
  close: number;
} | null {
  const row = Array.isArray(input) ? input[0] : input;
  if (!row) return null;
  const close = toNumber(row.close, 0);
  if (close <= 0) return null;
  return {
    name: String(row.name ?? ""),
    close,
  };
}

async function appendTradeLog(payload: {
  supabase: SupabaseClientAny;
  chatId: number;
  code: string;
  side: "BUY" | "SELL";
  price: number;
  quantity: number;
  grossAmount: number;
  netAmount: number;
  feeAmount?: number;
  taxAmount?: number;
  pnlAmount?: number;
  memo?: string;
}): Promise<number | null> {
  const { data, error } = await payload.supabase
    .from(PORTFOLIO_TABLES.trades)
    .insert({
      chat_id: payload.chatId,
      code: payload.code,
      side: payload.side,
      price: payload.price,
      quantity: payload.quantity,
      gross_amount: payload.grossAmount,
      net_amount: payload.netAmount,
      fee_amount: payload.feeAmount ?? 0,
      tax_amount: payload.taxAmount ?? 0,
      pnl_amount: payload.pnlAmount ?? 0,
      memo: payload.memo ?? null,
      traded_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    throw error;
  }

  return Number((data as Record<string, unknown> | null)?.id ?? 0) || null;
}

async function writeActionLog(payload: {
  supabase: SupabaseClientAny;
  runId: number | null;
  chatId: number;
  code?: string;
  actionType: "BUY" | "SELL" | "HOLD" | "SKIP" | "ERROR";
  reason?: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  await payload.supabase.from("virtual_autotrade_actions").insert({
    run_id: payload.runId,
    chat_id: payload.chatId,
    code: payload.code ?? null,
    action_type: payload.actionType,
    reason: payload.reason ?? null,
    detail: payload.detail ?? null,
  });
}

async function getLatestScoreAsof(
  supabase: SupabaseClientAny
): Promise<string | null> {
  const { data, error } = await supabase
    .from("scores")
    .select("asof")
    .order("asof", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return (data as { asof?: string } | null)?.asof ?? null;
}

async function selectMondayCandidates(payload: {
  supabase: SupabaseClientAny;
  minBuyScore: number;
  limit: number;
  heldCodes: Set<string>;
}): Promise<Array<{ code: string; close: number; score: number; name: string }>> {
  const latestAsof = await getLatestScoreAsof(payload.supabase);
  if (!latestAsof) return [];

  const { data, error } = await payload.supabase
    .from("scores")
    .select(
      [
        "code",
        "total_score",
        "signal",
        "stock:stocks!inner(code, name, close)",
      ].join(",")
    )
    .eq("asof", latestAsof)
    .gte("total_score", payload.minBuyScore)
    .in("signal", ["BUY", "STRONG_BUY", "WATCH"])
    .order("total_score", { ascending: false })
    .limit(Math.max(payload.limit * 5, payload.limit));

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as ScoreCandidateRow[];
  const out: Array<{ code: string; close: number; score: number; name: string }> = [];

  for (const row of rows) {
    if (payload.heldCodes.has(row.code)) continue;
    const stock = normalizeStock(row.stock);
    if (!stock) continue;

    out.push({
      code: row.code,
      close: stock.close,
      score: toNumber(row.total_score, 0),
      name: stock.name || row.code,
    });

    if (out.length >= payload.limit) break;
  }

  return out;
}

async function runMondayBuyForUser(payload: {
  supabase: SupabaseClientAny;
  setting: AutoTradeSettingRow;
  runId: number | null;
  dryRun: boolean;
}): Promise<AutoTradeActionSummary> {
  const chatId = payload.setting.chat_id;
  const summary: AutoTradeActionSummary = {
    chatId,
    buys: 0,
    sells: 0,
    skipped: 0,
    errors: 0,
    notes: [],
  };

  const { data: holdingRows, error: holdingError } = await payload.supabase
    .from(PORTFOLIO_TABLES.positionsLegacy)
    .select("id, code, status")
    .eq("chat_id", chatId);

  if (holdingError) {
    summary.errors += 1;
    summary.notes.push(`보유 조회 실패: ${holdingError.message}`);
    await writeActionLog({
      supabase: payload.supabase,
      runId: payload.runId,
      chatId,
      actionType: "ERROR",
      reason: "holdings-fetch-failed",
      detail: { error: holdingError.message },
    });
    return summary;
  }

  const holdings = (holdingRows ?? []) as Array<{ id: number; code: string; status?: string | null }>;
  const heldCodes = new Set(
    holdings
      .filter((row) => (row.status ?? "holding") !== "closed")
      .map((row) => String(row.code))
  );

  const activeCount = heldCodes.size;
  const maxPositions = toPositiveInt(payload.setting.max_positions, 10);
  let remainSlots = Math.max(0, Math.min(toPositiveInt(payload.setting.monday_buy_slots, 2), maxPositions - activeCount));

  // 선택된 전략에 따라 신규 매수 중단
  if (["HOLD_SAFE", "WAIT_AND_DIP_BUY"].includes(payload.setting.selected_strategy ?? "")) {
    remainSlots = 0;
  }

  if (remainSlots <= 0) {
    summary.skipped += 1;
    summary.notes.push("추가 매수 슬롯 없음");
    await writeActionLog({
      supabase: payload.supabase,
      runId: payload.runId,
      chatId,
      actionType: "SKIP",
      reason: "no-buy-slots",
      detail: { activeCount, maxPositions, remainSlots },
    });
    return summary;
  }

  const candidates = await selectMondayCandidates({
    supabase: payload.supabase,
    minBuyScore: toPositiveInt(payload.setting.min_buy_score, 72),
    limit: remainSlots,
    heldCodes,
  });

  if (!candidates.length) {
    summary.skipped += 1;
    summary.notes.push("매수 후보 없음");
    await writeActionLog({
      supabase: payload.supabase,
      runId: payload.runId,
      chatId,
      actionType: "SKIP",
      reason: "no-candidates",
      detail: { remainSlots },
    });
    return summary;
  }

  for (const candidate of candidates) {
    try {
      if (payload.dryRun) {
        summary.buys += 1;
        await writeActionLog({
          supabase: payload.supabase,
          runId: payload.runId,
          chatId,
          code: candidate.code,
          actionType: "BUY",
          reason: "dry-run-monday-buy",
          detail: {
            price: candidate.close,
            score: candidate.score,
            quantity: 1,
          },
        });
        continue;
      }

      const { data: upserted, error: upsertError } = await payload.supabase
        .from(PORTFOLIO_TABLES.positionsLegacy)
        .upsert(
          {
            chat_id: chatId,
            code: candidate.code,
            buy_price: candidate.close,
            buy_date: new Date().toISOString().slice(0, 10),
            quantity: 1,
            invested_amount: Math.round(candidate.close),
            status: "holding",
          },
          { onConflict: "chat_id,code", ignoreDuplicates: true }
        )
        .select("id, created_at, buy_date")
        .maybeSingle();

      if (upsertError) {
        throw upsertError;
      }

      const tradeId = await appendTradeLog({
        supabase: payload.supabase,
        chatId,
        code: candidate.code,
        side: "BUY",
        price: candidate.close,
        quantity: 1,
        grossAmount: Math.round(candidate.close),
        netAmount: Math.round(candidate.close),
        memo: buildStrategyMemo({
          strategyId: AUTO_TRADE_STRATEGY_ID,
          event: "monday-buy",
          note: "autotrade-monday-buy",
        }),
      });

      const positionId = Number((upserted as Record<string, unknown> | null)?.id ?? 0) || null;
      if (positionId) {
        await ensureTradeLotsForHolding({
          chatId,
          watchlistId: positionId,
          code: candidate.code,
          quantity: 1,
          investedAmount: Math.round(candidate.close),
          buyPrice: candidate.close,
          acquiredAt: String((upserted as Record<string, unknown> | null)?.created_at ?? "") || null,
          buyDate: String((upserted as Record<string, unknown> | null)?.buy_date ?? "") || null,
        });
      }

      summary.buys += 1;
      await writeActionLog({
        supabase: payload.supabase,
        runId: payload.runId,
        chatId,
        code: candidate.code,
        actionType: "BUY",
        reason: "monday-score-candidate",
        detail: {
          score: candidate.score,
          price: candidate.close,
          tradeId,
        },
      });
      // 결정로그: 월요일 자동 매수
      appendVirtualDecisionLog({
        chatId,
        code: candidate.code,
        action: "BUY",
        strategyId: AUTO_TRADE_STRATEGY_ID,
        strategyVersion: "v1",
        confidence: Math.min(100, Math.max(0, candidate.score)),
        expectedHorizonDays: 5,
        reasonSummary: `자동 월요일 매수 (점수 ${candidate.score.toFixed(1)})`,
        reasonDetails: { score: candidate.score, price: candidate.close, trigger: "monday-score-candidate" },
        linkedTradeId: tradeId ?? undefined,
      }).catch((err: unknown) => console.error("[autoTrade] decision log BUY failed", err));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      summary.errors += 1;
      summary.notes.push(`${candidate.code} 매수 실패: ${message}`);
      await writeActionLog({
        supabase: payload.supabase,
        runId: payload.runId,
        chatId,
        code: candidate.code,
        actionType: "ERROR",
        reason: "monday-buy-failed",
        detail: { error: message },
      });
    }
  }

  if (!payload.dryRun) {
    await syncVirtualPortfolio(chatId, chatId);
  }

  return summary;
}

async function runDailyReviewForUser(payload: {
  supabase: SupabaseClientAny;
  setting: AutoTradeSettingRow;
  runId: number | null;
  dryRun: boolean;
}): Promise<AutoTradeActionSummary> {
  const chatId = payload.setting.chat_id;
  const summary: AutoTradeActionSummary = {
    chatId,
    buys: 0,
    sells: 0,
    skipped: 0,
    errors: 0,
    notes: [],
  };

  // 적용된 전략 기록
  const selectedStrategy = payload.setting.selected_strategy;
  if (selectedStrategy) {
    const strategyLabels: Record<string, string> = {
      HOLD_SAFE: "안전 포지셀",
      REDUCE_TIGHT: "타이트 손절",
      WAIT_AND_DIP_BUY: "매수 기회 대기",
    };
    summary.notes.push(`전략: ${strategyLabels[selectedStrategy] || selectedStrategy}`);
  }

  const { data: holdingsData, error: holdingsError } = await payload.supabase
    .from(PORTFOLIO_TABLES.positionsLegacy)
    .select("id, code, buy_price, buy_date, created_at, quantity, invested_amount, status")
    .eq("chat_id", chatId)
    .eq("status", "holding");

  if (holdingsError) {
    summary.errors += 1;
    summary.notes.push(`보유 조회 실패: ${holdingsError.message}`);
    await writeActionLog({
      supabase: payload.supabase,
      runId: payload.runId,
      chatId,
      actionType: "ERROR",
      reason: "daily-holdings-fetch-failed",
      detail: { error: holdingsError.message },
    });
    return summary;
  }

  const holdings = (holdingsData ?? []) as HoldingRow[];
  if (!holdings.length) {
    summary.skipped += 1;
    summary.notes.push("보유 종목 없음");
    return summary;
  }

  const codeList = holdings.map((row) => row.code);
  const { data: stockRows, error: stockError } = await payload.supabase
    .from("stocks")
    .select("code, close")
    .in("code", codeList);

  if (stockError) {
    summary.errors += 1;
    summary.notes.push(`시세 조회 실패: ${stockError.message}`);
    return summary;
  }

  const closeByCode = new Map<string, number>();
  for (const row of stockRows ?? []) {
    const code = String((row as Record<string, unknown>).code ?? "");
    const close = toNumber((row as Record<string, unknown>).close, 0);
    if (code && close > 0) closeByCode.set(code, close);
  }

  const prefs = await getUserInvestmentPrefs(chatId);
  const feeRate = toNumber(prefs.virtual_fee_rate, 0.00015);
  const taxRate = toNumber(prefs.virtual_tax_rate, 0.0018);
  let stopLossPct = Math.abs(toNumber(payload.setting.stop_loss_pct, 4));
  let takeProfitPct = Math.abs(toNumber(payload.setting.take_profit_pct, 8));

  // 선택된 전략에 따라 손절/익절 조정
  if (selectedStrategy === "REDUCE_TIGHT") {
    stopLossPct = 2;
    takeProfitPct = 4;
  }

  let realizedDelta = 0;
  let availableCash = Math.max(
    0,
    toNumber(
      prefs.virtual_cash,
      toNumber(prefs.virtual_seed_capital, toNumber(prefs.capital_krw, 0))
    )
  );

  for (const holding of holdings) {
    const qty = Math.max(0, Math.floor(toNumber(holding.quantity, 0)));
    const buyPrice = toNumber(holding.buy_price, 0);
    const close = closeByCode.get(holding.code) ?? 0;

    if (qty <= 0 || buyPrice <= 0 || close <= 0) {
      summary.skipped += 1;
      await writeActionLog({
        supabase: payload.supabase,
        runId: payload.runId,
        chatId,
        code: holding.code,
        actionType: "SKIP",
        reason: "invalid-holding-or-price",
      });
      continue;
    }

    const pnlPct = ((close - buyPrice) / buyPrice) * 100;
    const shouldTakeProfit = pnlPct >= takeProfitPct;
    const shouldStopLoss = pnlPct <= -stopLossPct;

    if (!shouldTakeProfit && !shouldStopLoss) {
      await writeActionLog({
        supabase: payload.supabase,
        runId: payload.runId,
        chatId,
        code: holding.code,
        actionType: "HOLD",
        reason: "within-range",
        detail: {
          buyPrice,
          close,
          pnlPct: Number(pnlPct.toFixed(2)),
        },
      });
      continue;
    }

    const gross = Math.round(close * qty);
    const feeAmount = Math.round(gross * feeRate);
    const taxAmount = Math.round(gross * taxRate);
    const net = Math.max(0, gross - feeAmount - taxAmount);

    try {
      if (payload.dryRun) {
        summary.sells += 1;
        await writeActionLog({
          supabase: payload.supabase,
          runId: payload.runId,
          chatId,
          code: holding.code,
          actionType: "SELL",
          reason: shouldTakeProfit ? "dry-run-take-profit" : "dry-run-stop-loss",
          detail: { qty, buyPrice, close, pnlPct: Number(pnlPct.toFixed(2)) },
        });
        continue;
      }

      await ensureTradeLotsForHolding({
        chatId,
        watchlistId: holding.id,
        code: holding.code,
        quantity: qty,
        investedAmount: holding.invested_amount,
        buyPrice,
        acquiredAt: holding.created_at,
        buyDate: holding.buy_date,
      });

      const fifo = await previewFifoSale({
        chatId,
        code: holding.code,
        quantity: qty,
      });

      const pnl = net - fifo.totalCost;
      realizedDelta += pnl;
      availableCash += net;

      const tradeId = await appendTradeLog({
        supabase: payload.supabase,
        chatId,
        code: holding.code,
        side: "SELL",
        price: close,
        quantity: qty,
        grossAmount: gross,
        netAmount: net,
        feeAmount,
        taxAmount,
        pnlAmount: pnl,
        memo: buildStrategyMemo({
          strategyId: AUTO_TRADE_STRATEGY_ID,
          event: shouldTakeProfit ? "daily-take-profit" : "daily-stop-loss",
          note: shouldTakeProfit ? "autotrade-take-profit" : "autotrade-stop-loss",
        }),
      });

      const { error: deleteError } = await payload.supabase
        .from(PORTFOLIO_TABLES.positionsLegacy)
        .delete()
        .eq("chat_id", chatId)
        .eq("id", holding.id);

      if (deleteError) {
        throw deleteError;
      }

      await applyFifoSale({
        chatId,
        code: holding.code,
        exitPrice: close,
        tradeId,
        allocations: fifo.allocations,
      });

      summary.sells += 1;
      await writeActionLog({
        supabase: payload.supabase,
        runId: payload.runId,
        chatId,
        code: holding.code,
        actionType: "SELL",
        reason: shouldTakeProfit ? "take-profit" : "stop-loss",
        detail: {
          qty,
          buyPrice,
          close,
          gross,
          net,
          pnl,
          pnlPct: Number(pnlPct.toFixed(2)),
          tradeId,
        },
      });
      // 결정로그: 일일 자동 매도 (익절/손절)
      appendVirtualDecisionLog({
        chatId,
        code: holding.code,
        action: "SELL",
        strategyId: AUTO_TRADE_STRATEGY_ID,
        strategyVersion: "v1",
        confidence: shouldTakeProfit ? 80 : 70,
        reasonSummary: shouldTakeProfit
          ? `자동 익절 (수익률 +${pnlPct.toFixed(1)}%)`
          : `자동 손절 (수익률 ${pnlPct.toFixed(1)}%)`,
        reasonDetails: {
          trigger: shouldTakeProfit ? "take-profit" : "stop-loss",
          pnlPct: Number(pnlPct.toFixed(2)),
          pnl,
          buyPrice,
          sellPrice: close,
        },
        linkedTradeId: tradeId ?? undefined,
      }).catch((err: unknown) => console.error("[autoTrade] decision log SELL failed", err));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      summary.errors += 1;
      summary.notes.push(`${holding.code} 매도 실패: ${message}`);
      await writeActionLog({
        supabase: payload.supabase,
        runId: payload.runId,
        chatId,
        code: holding.code,
        actionType: "ERROR",
        reason: "daily-sell-failed",
        detail: { error: message },
      });
    }
  }

  // 매도 이후 재조회 기준으로 신규 매수 후보를 판단한다.
  const { data: postHoldings, error: postHoldingsError } = await payload.supabase
    .from(PORTFOLIO_TABLES.positionsLegacy)
    .select("code, status")
    .eq("chat_id", chatId);

  if (postHoldingsError) {
    summary.errors += 1;
    summary.notes.push(`매도 후 보유 재조회 실패: ${postHoldingsError.message}`);
  } else {
    const heldCodes = new Set(
      ((postHoldings ?? []) as Array<{ code: string; status?: string | null }>)
        .filter((row) => (row.status ?? "holding") !== "closed")
        .map((row) => String(row.code))
    );

    const maxPositions = toPositiveInt(payload.setting.max_positions, 10);
    const currentCount = heldCodes.size;
    const room = Math.max(0, maxPositions - currentCount);
    // 기존 monday_buy_slots를 회차당 신규매수 상한으로 재사용한다.
    const maxNewBuysPerRun = toPositiveInt(payload.setting.monday_buy_slots, 2);
    let buySlots = Math.min(room, maxNewBuysPerRun);

    // 선택된 전략에 따라 신규 매수 중단
    if (["HOLD_SAFE", "WAIT_AND_DIP_BUY"].includes(payload.setting.selected_strategy ?? "")) {
      buySlots = 0;
    }

    if (buySlots > 0 && availableCash > 0) {
      const candidates = await selectMondayCandidates({
        supabase: payload.supabase,
        minBuyScore: toPositiveInt(payload.setting.min_buy_score, 72),
        limit: buySlots,
        heldCodes,
      });

      let slotsLeft = buySlots;
      for (const candidate of candidates) {
        if (slotsLeft <= 0) break;

        const budgetPerSlot = Math.max(0, Math.floor(availableCash / slotsLeft));
        const qty = Math.max(0, Math.floor(budgetPerSlot / candidate.close));
        if (qty <= 0) {
          summary.skipped += 1;
          await writeActionLog({
            supabase: payload.supabase,
            runId: payload.runId,
            chatId,
            code: candidate.code,
            actionType: "SKIP",
            reason: "insufficient-cash",
            detail: {
              availableCash,
              budgetPerSlot,
              price: candidate.close,
            },
          });
          slotsLeft -= 1;
          continue;
        }

        const investedAmount = Math.round(qty * candidate.close);

        try {
          if (payload.dryRun) {
            summary.buys += 1;
            await writeActionLog({
              supabase: payload.supabase,
              runId: payload.runId,
              chatId,
              code: candidate.code,
              actionType: "BUY",
              reason: "dry-run-rebalance-buy",
              detail: {
                qty,
                price: candidate.close,
                investedAmount,
                score: candidate.score,
              },
            });
            slotsLeft -= 1;
            continue;
          }

          const { data: upserted, error: upsertError } = await payload.supabase
            .from(PORTFOLIO_TABLES.positionsLegacy)
            .upsert(
              {
                chat_id: chatId,
                code: candidate.code,
                buy_price: candidate.close,
                buy_date: new Date().toISOString().slice(0, 10),
                quantity: qty,
                invested_amount: investedAmount,
                status: "holding",
              },
              { onConflict: "chat_id,code", ignoreDuplicates: true }
            )
            .select("id, created_at, buy_date")
            .maybeSingle();

          if (upsertError) {
            throw upsertError;
          }

          const tradeId = await appendTradeLog({
            supabase: payload.supabase,
            chatId,
            code: candidate.code,
            side: "BUY",
            price: candidate.close,
            quantity: qty,
            grossAmount: investedAmount,
            netAmount: investedAmount,
            memo: buildStrategyMemo({
              strategyId: AUTO_TRADE_STRATEGY_ID,
              event: "rebalance-buy",
              note: "autotrade-rebalance-buy",
            }),
          });

          const positionId = Number((upserted as Record<string, unknown> | null)?.id ?? 0) || null;
          if (positionId) {
            await ensureTradeLotsForHolding({
              chatId,
              watchlistId: positionId,
              code: candidate.code,
              quantity: qty,
              investedAmount,
              buyPrice: candidate.close,
              acquiredAt: String((upserted as Record<string, unknown> | null)?.created_at ?? "") || null,
              buyDate: String((upserted as Record<string, unknown> | null)?.buy_date ?? "") || null,
            });
          }

          availableCash = Math.max(0, availableCash - investedAmount);
          summary.buys += 1;
          await writeActionLog({
            supabase: payload.supabase,
            runId: payload.runId,
            chatId,
            code: candidate.code,
            actionType: "BUY",
            reason: "rebalance-buy",
            detail: {
              qty,
              price: candidate.close,
              investedAmount,
              score: candidate.score,
              tradeId,
              cashAfter: availableCash,
            },
          });
          // 결정로그: 일일 리밸런싱 재매수
          appendVirtualDecisionLog({
            chatId,
            code: candidate.code,
            action: "BUY",
            strategyId: AUTO_TRADE_STRATEGY_ID,
            strategyVersion: "v1",
            confidence: Math.min(100, Math.max(0, candidate.score)),
            expectedHorizonDays: 5,
            reasonSummary: `자동 리밸런싱 재매수 (점수 ${candidate.score.toFixed(1)})`,
            reasonDetails: { score: candidate.score, price: candidate.close, qty, trigger: "rebalance-buy" },
            linkedTradeId: tradeId ?? undefined,
          }).catch((err: unknown) => console.error("[autoTrade] decision log rebalance BUY failed", err));
        } catch (error: unknown) {
          const message = error instanceof Error ? error.message : String(error);
          summary.errors += 1;
          summary.notes.push(`${candidate.code} 신규 매수 실패: ${message}`);
          await writeActionLog({
            supabase: payload.supabase,
            runId: payload.runId,
            chatId,
            code: candidate.code,
            actionType: "ERROR",
            reason: "rebalance-buy-failed",
            detail: { error: message },
          });
        }

        slotsLeft -= 1;
      }
    }
  }

  if (!payload.dryRun) {
    await setUserInvestmentPrefs(chatId, {
      virtual_realized_pnl: toNumber(prefs.virtual_realized_pnl, 0) + realizedDelta,
      virtual_cash: Math.max(0, Math.round(availableCash)),
    });
    await syncVirtualPortfolio(chatId, chatId);
  }

  return summary;
}

function selectRunType(mode: RunMode, now = new Date()): RunType {
  if (mode === "monday") return "MONDAY_BUY";
  if (mode === "daily") return "DAILY_REVIEW";
  // 기본 auto 모드는 요일과 무관하게 매도/신규매수를 함께 판단하는 일일 사이클을 사용한다.
  return "DAILY_REVIEW";
}

function buildDefaultSettingForChat(chatId: number, riskProfile?: "safe" | "balanced" | "active"): AutoTradeSettingRow {
  if (riskProfile === "active") {
    return {
      chat_id: chatId,
      is_enabled: true,
      monday_buy_slots: 3,
      max_positions: 12,
      min_buy_score: 74,
      take_profit_pct: 10,
      stop_loss_pct: 5,
    };
  }
  if (riskProfile === "balanced") {
    return {
      chat_id: chatId,
      is_enabled: true,
      monday_buy_slots: 2,
      max_positions: 10,
      min_buy_score: 72,
      take_profit_pct: 9,
      stop_loss_pct: 4,
    };
  }
  return {
    chat_id: chatId,
    is_enabled: true,
    monday_buy_slots: 2,
    max_positions: 8,
    min_buy_score: 70,
    take_profit_pct: 8,
    stop_loss_pct: 4,
  };
}

export async function runVirtualAutoTradingForChat(input: {
  chatId: number;
  mode?: RunMode;
  dryRun?: boolean;
  ensureEnabled?: boolean;
}): Promise<ChatAutoTradeRunSummary> {
  const mode = input.mode ?? "auto";
  const dryRun = Boolean(input.dryRun);
  const ensureEnabled = input.ensureEnabled !== false;

  const supabase: SupabaseClientAny = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const runType = selectRunType(mode);
  const runKey = `${kstDateKey()}-${Date.now()}`;

  const { data: settingRow } = await supabase
    .from("virtual_autotrade_settings")
    .select(
      "chat_id, is_enabled, monday_buy_slots, max_positions, min_buy_score, take_profit_pct, stop_loss_pct, last_monday_buy_at, last_daily_review_at"
    )
    .eq("chat_id", input.chatId)
    .maybeSingle();

  const prefs = await getUserInvestmentPrefs(input.chatId);
  const defaultSetting = buildDefaultSettingForChat(input.chatId, prefs.risk_profile);

  const setting: AutoTradeSettingRow = {
    ...defaultSetting,
    ...(settingRow as Partial<AutoTradeSettingRow> | null ?? {}),
    chat_id: input.chatId,
    is_enabled: ensureEnabled ? true : Boolean((settingRow as any)?.is_enabled ?? defaultSetting.is_enabled),
  };

  if (ensureEnabled) {
    await supabase.from("virtual_autotrade_settings").upsert(
      {
        chat_id: setting.chat_id,
        is_enabled: setting.is_enabled,
        monday_buy_slots: setting.monday_buy_slots,
        max_positions: setting.max_positions,
        min_buy_score: setting.min_buy_score,
        take_profit_pct: setting.take_profit_pct,
        stop_loss_pct: setting.stop_loss_pct,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "chat_id" }
    );
  }

  const runId = await startRun({
    supabase,
    runType: "MANUAL",
    runKey,
    chatId: input.chatId,
  });

  const action = runType === "MONDAY_BUY"
    ? await runMondayBuyForUser({
        supabase,
        setting,
        runId,
        dryRun,
      })
    : await runDailyReviewForUser({
        supabase,
        setting,
        runId,
        dryRun,
      });

  const status = action.errors > 0
    ? "FAILED"
    : action.buys + action.sells > 0
      ? "SUCCESS"
      : "SKIPPED";

  await finishRun({
    supabase,
    runId,
    status,
    summary: {
      mode,
      runType,
      buys: action.buys,
      sells: action.sells,
      skipped: action.skipped,
      errors: action.errors,
      notes: action.notes,
      dryRun,
    },
  });

  return {
    mode,
    runType,
    runKey,
    dryRun,
    action,
  };
}

async function startRun(payload: {
  supabase: SupabaseClientAny;
  runType: RunType;
  runKey: string;
  chatId: number;
}): Promise<number | null> {
  const { data, error } = await payload.supabase
    .from("virtual_autotrade_runs")
    .upsert(
      {
        run_type: payload.runType,
        run_key: payload.runKey,
        chat_id: payload.chatId,
        status: "SKIPPED",
        started_at: new Date().toISOString(),
      },
      { onConflict: "run_type,run_key,chat_id" }
    )
    .select("id")
    .maybeSingle();

  if (error) return null;
  return Number((data as Record<string, unknown> | null)?.id ?? 0) || null;
}

async function finishRun(payload: {
  supabase: SupabaseClientAny;
  runId: number | null;
  status: "SUCCESS" | "SKIPPED" | "FAILED";
  summary: Record<string, unknown>;
}): Promise<void> {
  if (!payload.runId) return;
  await payload.supabase
    .from("virtual_autotrade_runs")
    .update({
      status: payload.status,
      summary: payload.summary,
      finished_at: new Date().toISOString(),
    })
    .eq("id", payload.runId);
}

export async function runVirtualAutoTradingCycle(input?: {
  mode?: RunMode;
  maxUsers?: number;
  dryRun?: boolean;
}): Promise<AutoTradeRunSummary> {
  const mode = input?.mode ?? "auto";
  const maxUsers = Math.max(1, Math.floor(input?.maxUsers ?? 200));
  const dryRun = Boolean(input?.dryRun);

  const supabase: SupabaseClientAny = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );

  const runType = selectRunType(mode);
  const runKey = kstDateKey();

  const { data: settingsData, error: settingsError } = await supabase
    .from("virtual_autotrade_settings")
    .select(
      "chat_id, is_enabled, monday_buy_slots, max_positions, min_buy_score, take_profit_pct, stop_loss_pct, last_monday_buy_at, last_daily_review_at"
    )
    .eq("is_enabled", true)
    .order("chat_id", { ascending: true })
    .limit(maxUsers);

  if (settingsError) {
    throw settingsError;
  }

  const settings = (settingsData ?? []) as AutoTradeSettingRow[];
  const summary: AutoTradeRunSummary = {
    mode,
    runType,
    runKey,
    totalUsers: settings.length,
    processedUsers: 0,
    buyCount: 0,
    sellCount: 0,
    skippedCount: 0,
    errorCount: 0,
    actions: [],
  };

  for (const setting of settings) {
    const runId = await startRun({
      supabase,
      runType,
      runKey,
      chatId: setting.chat_id,
    });

    try {
      const actionSummary = runType === "MONDAY_BUY"
        ? await runMondayBuyForUser({
            supabase,
            setting,
            runId,
            dryRun,
          })
        : await runDailyReviewForUser({
            supabase,
            setting,
            runId,
            dryRun,
          });

      const status = actionSummary.errors > 0
        ? "FAILED"
        : actionSummary.buys + actionSummary.sells > 0
          ? "SUCCESS"
          : "SKIPPED";

      await finishRun({
        supabase,
        runId,
        status,
        summary: {
          buys: actionSummary.buys,
          sells: actionSummary.sells,
          skipped: actionSummary.skipped,
          errors: actionSummary.errors,
          notes: actionSummary.notes,
          dryRun,
        },
      });

      if (!dryRun) {
        if (runType === "MONDAY_BUY") {
          await supabase
            .from("virtual_autotrade_settings")
            .update({ last_monday_buy_at: new Date().toISOString() })
            .eq("chat_id", setting.chat_id);
        } else {
          await supabase
            .from("virtual_autotrade_settings")
            .update({ last_daily_review_at: new Date().toISOString() })
            .eq("chat_id", setting.chat_id);
        }
      }

      summary.processedUsers += 1;
      summary.buyCount += actionSummary.buys;
      summary.sellCount += actionSummary.sells;
      summary.skippedCount += actionSummary.skipped;
      summary.errorCount += actionSummary.errors;
      summary.actions.push(actionSummary);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await finishRun({
        supabase,
        runId,
        status: "FAILED",
        summary: {
          error: message,
          dryRun,
        },
      });

      summary.processedUsers += 1;
      summary.errorCount += 1;
      summary.actions.push({
        chatId: setting.chat_id,
        buys: 0,
        sells: 0,
        skipped: 0,
        errors: 1,
        notes: [message],
      });
    }
  }

  return summary;
}
