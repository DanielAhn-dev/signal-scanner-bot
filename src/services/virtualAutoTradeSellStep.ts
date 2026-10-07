/**
 * 종목 자동매매의 매도 실행 — 모든 매도 경로(익절·손절·로테이션·실적 관문 교체·지수 모드 전환 정리)가 이 함수 하나를 쓴다.
 * 무엇을 팔지는 호출측이 정하고, 여기는 체결가·비용 계산과 포지션·실현손익·거래기록·FIFO 로트 반영을 맡는다.
 *
 * 설정(prefs)·거래기록·로트·중복실행 방지·로그는 deps로 주입받는다 — 자동매매 서비스가 실제 구현을 넘기고,
 * 테스트는 가짜를 넘겨 부분 실패 시 원장 일관성을 검증한다.
 */
import { PORTFOLIO_TABLES } from "../db/portfolioSchema";
import { AUTO_TRADE_STRATEGY_ID, buildStrategyMemo } from "../lib/strategyMemo";
import { resolveSellTaxRate } from "../lib/securitiesTax";
import { resolveVirtualExecutionPrice } from "./virtualAutoTradeExecution";
import { buildPositionStrategyMemo } from "./virtualAutoTradePositionStrategy";
import type * as LotService from "./virtualLotService";
import type { appendVirtualDecisionLog } from "./decisionLogService";

type SupabaseClientAny = any;

/**
 * 자동 매도 사유. 섹터 정리·비중 축소는 예전에 손익 부호에 따라 take-profit-partial / loss-trim으로 기록돼
 * 수수료 빼면 손실인 섹터 정리 매도가 "자동 익절 완료"로 보였다(2026-10-01 한미약품 +0.1% → −3,181원).
 */
export type AutoTradeSellReason =
  | "take-profit-partial"
  | "take-profit-final"
  | "stop-loss"
  | "loss-trim"
  | "sector-rotation-sell"
  | "overweight-trim"
  | "rotation-sell"
  | "event-risk-defensive-exit";

/** 거래 기록·결정 로그에 남는 매도 이유 문구 */
export function sellReasonSummary(reason: AutoTradeSellReason, isFullExit: boolean): string {
  switch (reason) {
    case "take-profit-partial":
    case "take-profit-final":
      return isFullExit ? "자동 익절 완료" : "자동 부분익절";
    case "stop-loss":
      return "자동 손절";
    case "loss-trim":
      return "자동 손실 축소";
    case "sector-rotation-sell":
      return "섹터 약세 정리 매도";
    case "overweight-trim":
      return "비중 초과 축소 매도";
    case "rotation-sell":
      return "교체 매도";
    case "event-risk-defensive-exit":
      return "이벤트 선제 정리";
  }
}

export type HoldingRow = {
  id: number;
  code: string;
  buy_price: number | null;
  buy_date?: string | null;
  created_at?: string | null;
  quantity: number | null;
  invested_amount: number | null;
  status?: string | null;
  memo?: string | null;
  planned_review_at?: string | null;
};

export type AutoTradeSellDeps = {
  getPrefs: (chatId: number) => Promise<Record<string, unknown>>;
  /** 실패 시 예외 대신 ok:false를 돌려준다 (setUserInvestmentPrefs와 같은 계약) */
  setPrefs: (chatId: number, patch: Record<string, number>) => Promise<{ ok: boolean }>;
  appendTradeLog: (payload: {
    supabase: SupabaseClientAny;
    chatId: number;
    code: string;
    side: "SELL";
    price: number;
    quantity: number;
    grossAmount: number;
    netAmount: number;
    feeAmount?: number;
    taxAmount?: number;
    pnlAmount?: number;
    memo?: string;
    source?: "AUTO";
    brokerName?: string | null;
    accountName?: string | null;
  }) => Promise<number | null>;
  /** 같은 매도가 두 번 실행되지 않게 op_key를 선점한다. 이미 있으면 false */
  tryRegisterOperation: (params: {
    supabase: SupabaseClientAny;
    opKey: string;
    chatId: number | string;
    strategy?: string | null;
    meta?: Record<string, unknown> | null;
  }) => Promise<boolean>;
  writeActionLog: (payload: {
    supabase: SupabaseClientAny;
    runId: number | null;
    chatId: number;
    code?: string;
    actionType: "SELL" | "SKIP";
    reason?: string;
    detail?: Record<string, unknown>;
  }) => Promise<void>;
  appendVirtualDecisionLog: typeof appendVirtualDecisionLog;
  lots: Pick<
    typeof LotService,
    "ensureTradeLotsForHolding" | "previewFifoSale" | "replaceTradeLotsForHolding" | "applyFifoSale"
  >;
};

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function fmtKrw(value: number): string {
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

export function createAutoTradeSellStep(deps: AutoTradeSellDeps) {
  /**
   * 보유분 일부/전량 매도. 실행 시 포지션과 실현손익(prefs.virtual_realized_pnl)까지 반영한다 —
   * 돌려주는 realizedPnlDelta는 요약·통계용이며 호출측이 다시 더하면 안 된다.
   * 현금(virtual_cash)은 호출측이 proceeds로 갱신한다 (이미 모아 둔 availableCash와 함께 쓰므로).
   * dryRun이면 매도안만 계산해 돌려주고 아무것도 쓰지 않는다.
   */
  async function executeAutoTradeSell(payload: {
    supabase: SupabaseClientAny;
    runId: number | null;
    chatId: number;
    holding: HoldingRow;
    close: number;
    buyPrice: number;
    feeRate: number;
    taxRate: number;
    sellQty: number;
    reason: AutoTradeSellReason;
    stopLossContext?: string | null;
    profileLabel: string;
    strategyProfile: string;
    takeProfitTranchesDone: number;
    nextTakeProfitTranchesDone: number;
    dryRun: boolean;
    /** 보유 중 최고가. 부분 매도 후 남은 포지션 memo에 보존한다. */
    peakPrice?: number | null;
    /** 이번 매도 뒤 남은 포지션의 절반 손절 완료 여부. 부분 매도 후 memo에 남긴다. */
    halfStopDone?: boolean;
  }): Promise<{
    sold: boolean;
    partial: boolean;
    proceeds: number;
    realizedPnlDelta: number;
    note: string;
  }> {
    const qty = Math.max(0, Math.floor(toNumber(payload.holding.quantity, 0)));
    const invested = Math.max(
      0,
      toNumber(payload.holding.invested_amount, qty * payload.buyPrice)
    );
    const sellQty = Math.max(0, Math.min(qty, Math.floor(payload.sellQty)));
    const isFullExit = sellQty >= qty;
    const remainQty = Math.max(0, qty - sellQty);

    if (qty <= 0 || sellQty <= 0) {
      return {
        sold: false,
        partial: false,
        proceeds: 0,
        realizedPnlDelta: 0,
        note: `${payload.holding.code} 매도 스킵: 수량 계산 오류`,
      };
    }

    await deps.lots.ensureTradeLotsForHolding({
      chatId: payload.chatId,
      watchlistId: payload.holding.id,
      code: payload.holding.code,
      quantity: qty,
      investedAmount: invested,
      buyPrice: payload.buyPrice,
      acquiredAt: payload.holding.created_at,
      buyDate: payload.holding.buy_date,
    });

    let fifo;
    try {
      fifo = await deps.lots.previewFifoSale({
        chatId: payload.chatId,
        code: payload.holding.code,
        quantity: sellQty,
      });
    } catch (fifoError) {
      try {
        await deps.lots.replaceTradeLotsForHolding({
          chatId: payload.chatId,
          watchlistId: payload.holding.id,
          code: payload.holding.code,
          quantity: qty,
          investedAmount: invested,
          buyPrice: payload.buyPrice,
          acquiredAt: payload.holding.created_at,
          buyDate: payload.holding.buy_date,
          note: "autotrade-fifo-rebuild-before-sell",
        });

        fifo = await deps.lots.previewFifoSale({
          chatId: payload.chatId,
          code: payload.holding.code,
          quantity: sellQty,
        });
      } catch (repairError) {
        const message = repairError instanceof Error ? repairError.message : String(repairError)
        return {
          sold: false,
          partial: false,
          proceeds: 0,
          realizedPnlDelta: 0,
          note: `${payload.holding.code} 매도 중단: FIFO 정합성 자동 복구 실패 (${message})`,
        }
      }
    }
    const soldCost = fifo.totalCost;
    const remainInvested = Math.max(0, invested - soldCost);
    const nextBuyPrice =
      remainQty > 0 && remainInvested > 0
        ? Number((remainInvested / remainQty).toFixed(4))
        : null;
    const execution = resolveVirtualExecutionPrice({
      referencePrice: payload.close,
      side: "SELL",
    });
    const executionPrice = execution.executionPrice;
    const gross = Math.round(executionPrice * sellQty);
    const feeAmount = Math.round(gross * payload.feeRate);
    // ETF·ETN은 증권거래세 면제 — 보유 종목이 ETF인지 이름으로 확인한다
    const { data: stockNameRow } = await payload.supabase
      .from("stocks")
      .select("name")
      .eq("code", payload.holding.code)
      .maybeSingle();
    const effectiveTaxRate = resolveSellTaxRate({
      code: payload.holding.code,
      name: (stockNameRow as { name?: string } | null)?.name ?? null,
      baseRate: payload.taxRate,
    });
    const taxAmount = Math.round(gross * effectiveTaxRate);
    const net = Math.max(0, gross - feeAmount - taxAmount);
    const pnl = net - soldCost;
    const isTakeProfit = payload.reason === "take-profit-partial" || payload.reason === "take-profit-final";

    const sellOpKey = `${payload.chatId}:SELL:${payload.holding.code}:${Math.round(executionPrice)}:${sellQty}:${new Date().toISOString().slice(0,16)}`;
    const sellRegistered = await deps.tryRegisterOperation({
      supabase: payload.supabase,
      opKey: sellOpKey,
      chatId: payload.chatId,
      strategy: AUTO_TRADE_STRATEGY_ID,
      meta: { event: payload.reason, holdingId: payload.holding.id, runId: payload.runId },
    }).catch((err) => { throw err; });

    if (!sellRegistered) {
      await deps.writeActionLog({
        supabase: payload.supabase,
        runId: payload.runId,
        chatId: payload.chatId,
        code: payload.holding.code,
        actionType: "SKIP",
        reason: "duplicate-execution",
        detail: { opKey: sellOpKey },
      });
      return {
        sold: false,
        partial: false,
        proceeds: 0,
        realizedPnlDelta: 0,
        note: `${payload.holding.code} 매도 스킵: 중복 실행`,
      };
    }

    if (payload.dryRun) {
      await deps.writeActionLog({
        supabase: payload.supabase,
        runId: payload.runId,
        chatId: payload.chatId,
        code: payload.holding.code,
        actionType: "SELL",
        reason: `dry-run-${payload.reason}`,
        detail: {
          qty: sellQty,
          remainQty,
          buyPrice: payload.buyPrice,
          close: payload.close,
          executionPrice,
          slippageBps: execution.slippageBps,
          pnl,
          isFullExit,
          stopLossContext: payload.reason === "stop-loss" ? payload.stopLossContext ?? null : null,
          takeProfitTranchesDone: payload.takeProfitTranchesDone,
          nextTakeProfitTranchesDone: payload.nextTakeProfitTranchesDone,
        },
      });
      return {
        sold: true,
        partial: !isFullExit,
        proceeds: net,
        realizedPnlDelta: pnl,
        note: isFullExit
          ? `[테스트 매도안] ${payload.holding.code} ${sellQty}주 전량매도 · 전략 ${payload.profileLabel} · 손익률 ${(((executionPrice - payload.buyPrice) / payload.buyPrice) * 100).toFixed(2)}%`
          : `[테스트 부분익절안] ${payload.holding.code} ${sellQty}주 매도 · 잔여 ${remainQty}주 · 전략 ${payload.profileLabel}`,
      };
    }

    // 반영 순서: 실현손익 → 포지션 → 거래기록·FIFO 로트. DB 트랜잭션이 없어서 순서로 보완한다.
    // 현금은 실행 끝의 syncVirtualPortfolio가 "시드 + 실현손익 − 보유 투자금"으로 다시 계산하므로,
    // 포지션이 빠졌는데 실현손익이 안 들어가면 그 매도의 손익만큼 현금이 영구히 틀어진다.
    // 예전엔 실현손익을 호출측이 따로 더했는데 로테이션·실적 관문 교체·지수 모드 전환 정리는 빠뜨렸고,
    // 포지션 삭제 뒤 거래기록·로트 저장이 실패하면 예외로 끝나 호출측도 손익을 더하지 못했다.
    const pnlBefore = toNumber((await deps.getPrefs(payload.chatId)).virtual_realized_pnl, 0);
    const pnlSaved = await deps.setPrefs(payload.chatId, { virtual_realized_pnl: Math.round(pnlBefore + pnl) });
    if (!pnlSaved.ok) throw new Error("실현손익 반영 실패 — 포지션은 그대로 둠");

    const positions = () => payload.supabase.from(PORTFOLIO_TABLES.positions);
    const { error: positionError } = isFullExit
      ? await positions().delete().eq("chat_id", payload.chatId).eq("id", payload.holding.id)
      : await positions()
          .update({
            quantity: remainQty,
            invested_amount: remainInvested,
            buy_price: nextBuyPrice,
            memo: buildPositionStrategyMemo({
              // 손실 중 부분 매도(절반 손절)를 익절로 남기지 않는다
              event: payload.reason === "stop-loss" ? "partial-stop-loss" : "partial-take-profit",
              note: payload.reason === "stop-loss" ? "autotrade-partial-stop-loss" : "autotrade-partial-take-profit",
              profile: payload.strategyProfile,
              takeProfitTranchesDone: payload.nextTakeProfitTranchesDone,
              // 부분익절 후에도 수익잠금 트레일링이 고점 기준을 잃지 않도록 유지
              peakPrice: payload.peakPrice ?? null,
              halfStopDone: payload.halfStopDone ?? false,
            }),
            status: "holding",
          })
          .eq("chat_id", payload.chatId)
          .eq("id", payload.holding.id);
    if (positionError) {
      const reverted = await deps
        .setPrefs(payload.chatId, { virtual_realized_pnl: Math.round(pnlBefore) })
        .catch(() => ({ ok: false }));
      if (!reverted.ok) {
        console.error("[autoTrade] 매도 포지션 반영 실패 후 실현손익 되돌리기도 실패 — 수동 확인 필요", {
          chatId: payload.chatId,
          code: payload.holding.code,
          pnl,
        });
      }
      throw positionError;
    }

    // 여기부터는 이력·보조 원장이라 실패해도 매도 자체(포지션·실현손익)는 성립한다 — 로그만 남기고 진행
    const tradeId = await deps
      .appendTradeLog({
        supabase: payload.supabase,
        chatId: payload.chatId,
        code: payload.holding.code,
        side: "SELL",
        price: executionPrice,
        quantity: sellQty,
        grossAmount: gross,
        netAmount: net,
        feeAmount,
        taxAmount,
        pnlAmount: pnl,
        memo: buildStrategyMemo({
          strategyId: AUTO_TRADE_STRATEGY_ID,
          event: payload.reason,
          note: payload.reason,
        }),
        source: "AUTO",
        brokerName: null,
        accountName: null,
      })
      .catch((e: unknown) => {
        console.error("[autoTrade] 매도 거래기록 저장 실패 (포지션·실현손익은 반영됨)", e);
        return null;
      });

    try {
      await deps.lots.applyFifoSale({
        chatId: payload.chatId,
        code: payload.holding.code,
        exitPrice: executionPrice,
        tradeId,
        allocations: fifo.allocations,
      });
    } catch (lotError) {
      console.error("[autoTrade] 매도 FIFO 로트 반영 실패 — 보유분 기준으로 다시 만든다", lotError);
      await deps.lots
        .replaceTradeLotsForHolding({
          chatId: payload.chatId,
          watchlistId: isFullExit ? null : payload.holding.id,
          code: payload.holding.code,
          quantity: remainQty,
          investedAmount: isFullExit ? 0 : remainInvested,
          buyPrice: isFullExit ? null : nextBuyPrice,
          acquiredAt: payload.holding.created_at,
          buyDate: payload.holding.buy_date,
          note: "autotrade-fifo-rebuilt-after-sell",
        })
        .catch((e: unknown) => console.error("[autoTrade] 매도 후 FIFO 로트 재구성 실패", e));
    }

    await deps.writeActionLog({
      supabase: payload.supabase,
      runId: payload.runId,
      chatId: payload.chatId,
      code: payload.holding.code,
      actionType: "SELL",
      reason: payload.reason,
      detail: {
        qty: sellQty,
        remainQty,
        buyPrice: payload.buyPrice,
        close: payload.close,
        executionPrice,
        slippageBps: execution.slippageBps,
        gross,
        net,
        pnl,
        isFullExit,
        stopLossContext: payload.reason === "stop-loss" ? payload.stopLossContext ?? null : null,
        takeProfitTranchesDone: payload.takeProfitTranchesDone,
        nextTakeProfitTranchesDone: payload.nextTakeProfitTranchesDone,
        tradeId,
      },
    });

    deps.appendVirtualDecisionLog({
      chatId: payload.chatId,
      code: payload.holding.code,
      action: "SELL",
      strategyId: AUTO_TRADE_STRATEGY_ID,
      strategyVersion: "v1",
      confidence: isTakeProfit ? 80 : 70,
      expectedHorizonDays: isTakeProfit ? 3 : 1,
      reasonSummary: `${sellReasonSummary(payload.reason, isFullExit)} (${payload.profileLabel})`,
      reasonDetails: {
        trigger: payload.reason,
        stopLossContext: payload.reason === "stop-loss" ? payload.stopLossContext ?? null : null,
        sellQty,
        remainQty,
        buyPrice: payload.buyPrice,
        sellPrice: executionPrice,
        referencePrice: payload.close,
        slippageBps: execution.slippageBps,
        pnl,
      },
      linkedTradeId: tradeId ?? undefined,
    }).catch((err: unknown) => console.error("[autoTrade] decision log SELL failed", err));

    return {
      sold: true,
      partial: !isFullExit,
      proceeds: net,
      realizedPnlDelta: pnl,
      note: isFullExit
        ? `[실행 매도] ${payload.holding.code} ${sellQty}주 · 전략 ${payload.profileLabel} · 매도가 ${fmtKrw(executionPrice)}`
        : `[실행 부분익절] ${payload.holding.code} ${sellQty}주 · 잔여 ${remainQty}주 · 전략 ${payload.profileLabel} · 매도가 ${fmtKrw(executionPrice)}`,
    };
  }

  return { executeAutoTradeSell };
}
