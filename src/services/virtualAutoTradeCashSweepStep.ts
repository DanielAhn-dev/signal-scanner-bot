/**
 * 유휴현금 스윕의 DB 실행 단계 — 스윕 포지션 조회·매수·매도·현금화와 그에 따른 거래기록·현금 반영.
 * 순수 판단 로직(얼마나, 언제)은 virtualAutoTradeCashSweep.ts에 있고, 여기는 그 판단을 DB에 적용한다.
 *
 * 설정(prefs)·거래기록·실시간가는 deps로 주입받는다 — 자동매매 서비스가 실제 구현을 넘기고,
 * 테스트는 가짜를 넘겨 부분 실패 시 자산(현금+포지션) 일관성을 검증한다.
 */
import { toKstDateKey } from "../lib/krxCalendar";
import { PORTFOLIO_TABLES } from "../db/portfolioSchema";
import { buildStrategyMemo, parseStrategyMemo } from "../lib/strategyMemo";
import { resolveBaseSellTaxRate, resolveOtherEtfGainTax, resolveSellTaxRate } from "../lib/securitiesTax";
import {
  CASH_SWEEP_CANDIDATE_CODES,
  CASH_SWEEP_STRATEGY_ID,
  INDEX_SWEEP_CODES,
  isIndexSweepCode,
  resolveCashSweepIdleAmount,
  resolveCashSweepTopUpQty,
  shouldLiquidateCashSweep,
} from "./virtualAutoTradeCashSweep";

type SupabaseClientAny = any;

export type SweepHolding = { id: number; code: string; name: string; price: number; quantity: number; invested_amount: number };

export type CashSweepTradeLog = {
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
  source?: "AUTO";
  brokerName?: string | null;
  accountName?: string | null;
};

export type CashSweepDeps = {
  getPrefs: (chatId: number) => Promise<Record<string, unknown>>;
  /** 실패 시 예외 대신 ok:false를 돌려준다 (setUserInvestmentPrefs와 같은 계약) */
  setPrefs: (chatId: number, patch: Record<string, number>) => Promise<{ ok: boolean }>;
  appendTradeLog: (payload: CashSweepTradeLog) => Promise<unknown>;
  /** 장중이면 가격을 실시간가로 덮어쓰고, 실시간가를 못 받은 종목은 0으로 지운다 */
  overlayIntradayPrices: (prices: Map<string, number>, codes: string[]) => Promise<unknown>;
};

/** 수수료·슬리피지 여유분. 매수 체결액이 순수 현금을 넘지 않도록 이만큼 더 확보한다. */
export const BUY_CASH_BUFFER = 1.005;

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function fmtKrw(value: number): string {
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

export const fmtSweepPnl = (pnl: number) => `${pnl >= 0 ? "+" : ""}${fmtKrw(pnl)}`;

export function createCashSweepSteps(deps: CashSweepDeps) {

  /** 스윕 ETF 후보의 종가(장중이면 실시간가로 덮어씀)·이름. 가격이 없으면 close=0 */
  async function loadSweepPrices(
    supabase: SupabaseClientAny
  ): Promise<Map<string, { close: number; name: string }>> {
    const { data: priceRows } = await supabase
      .from("stocks")
      .select("code, name, close")
      .in("code", CASH_SWEEP_CANDIDATE_CODES);
    const rows = (priceRows ?? []) as Record<string, unknown>[];
    const closes = new Map(rows.map((row) => [String(row.code ?? ""), toNumber(row.close, 0)] as [string, number]));
    await deps.overlayIntradayPrices(closes, [...closes.keys()]);
    return new Map(
      rows.map((row) => [
        String(row.code ?? ""),
        { close: closes.get(String(row.code ?? "")) ?? 0, name: String(row.name ?? "") },
      ])
    );
  }

  /** 봇이 보유 중인 스윕 포지션 행 (전략 메모가 CASH_SWEEP_STRATEGY_ID인 것만, 지수형·금리형 모두) */
  async function loadSweepPositionRows(supabase: SupabaseClientAny, chatId: number): Promise<Record<string, unknown>[]> {
    const { data: rows } = await supabase
      .from(PORTFOLIO_TABLES.positions)
      .select("id, code, quantity, invested_amount, memo")
      .eq("chat_id", chatId)
      .in("code", CASH_SWEEP_CANDIDATE_CODES)
      .eq("status", "holding")
      .is("broker_name", null)
      .is("account_name", null);
    return ((rows ?? []) as Record<string, unknown>[]).filter(
      (row) => parseStrategyMemo(row.memo as string | null).strategyId === CASH_SWEEP_STRATEGY_ID
    );
  }

  /**
   * 보유 중인 스윕 ETF 중 (장중 실시간가를 못 받아) 가격이 없는 것이 있는지 — 있으면 그 회차 스윕을 쉰다.
   * @param rows loadSweepPositionRows 결과 (호출측이 한 번 조회해 여러 함수에 재사용)
   */
  function hasUnpricedSweepHolding(
    rows: Record<string, unknown>[],
    prices: Map<string, { close: number; name: string }>
  ): boolean {
    return rows.some((row) => toNumber(row.quantity, 0) > 0 && !((prices.get(String(row.code ?? ""))?.close ?? 0) > 0));
  }

  /**
   * 현재 보유 중인 스윕 포지션 (지수형·금리형 어느 쪽이든, 종가가 있는 첫 번째). 없으면 null.
   * @param rows loadSweepPositionRows 결과
   */
  function loadSweepHolding(
    rows: Record<string, unknown>[],
    prices: Map<string, { close: number; name: string }>
  ): SweepHolding | null {
    for (const row of rows) {
      const code = String(row.code ?? "");
      const price = prices.get(code)?.close ?? 0;
      const quantity = Math.max(0, Math.floor(toNumber(row.quantity, 0)));
      if (price <= 0 || quantity <= 0) continue;
      return {
        id: toNumber(row.id, 0),
        code,
        name: prices.get(code)?.name || code,
        price,
        quantity,
        invested_amount: Math.max(0, toNumber(row.invested_amount, 0)),
      };
    }
    return null;
  }

  /**
   * 봇 ETF 매매(유휴현금 스윕·지수 보유 모드) 한 건을 자산(현금+포지션)이 어긋나지 않게 반영한다. DB 트랜잭션이 없어서 순서로 보완한다.
   * 1) 현금(prefs) 반영 — 실패하면 아무것도 바뀌지 않은 채 예외
   * 2) 포지션 반영 — 실패하면 1)을 되돌리고 예외 (되돌리기마저 실패하면 불일치를 로그로 남긴다)
   * 3) 거래기록 — 이력일 뿐이라 실패해도 자산은 맞으므로 로그만 남기고 진행한다
   * 예전엔 포지션 → 거래기록 → 현금 순서였고 포지션 쓰기 오류를 확인하지 않았다. 그래서 포지션 삭제가 실패해도
   * 현금이 들어와 자산이 두 번 잡히거나(매도), 포지션 생성이 실패해도 현금만 빠져 돈이 사라질 수 있었다(매수).
   */
  async function commitEtfTrade(input: {
    chatId: number;
    cashPatch: Record<string, number>;
    revertCashPatch: Record<string, number>;
    writePosition: () => PromiseLike<{ error?: unknown }>;
    tradeLog: CashSweepTradeLog;
  }): Promise<void> {
    const cashResult = await deps.setPrefs(input.chatId, input.cashPatch);
    if (!cashResult.ok) throw new Error("현금 반영 실패 — 포지션은 그대로 둠");

    const { error: positionError } = await input.writePosition();
    if (positionError) {
      const revert = await deps.setPrefs(input.chatId, input.revertCashPatch).catch(() => ({ ok: false }));
      if (!revert.ok) {
        console.error("[autoTrade] cash sweep: 포지션 반영 실패 후 현금 되돌리기도 실패 — 수동 확인 필요", {
          chatId: input.chatId,
          code: input.tradeLog.code,
          side: input.tradeLog.side,
          cashPatch: input.cashPatch,
          revertCashPatch: input.revertCashPatch,
        });
      }
      throw positionError;
    }

    try {
      await deps.appendTradeLog(input.tradeLog);
    } catch (e) {
      console.error("[autoTrade] cash sweep: 거래기록 저장 실패 (현금·포지션은 반영됨)", e);
    }
  }

  /** 스윕 포지션 일부/전량 매도 (현금 반영·포지션 갱신·거래 기록). 순매도금액과 손익을 돌려준다 */
  async function sellSweepPosition(payload: {
    supabase: SupabaseClientAny;
    chatId: number;
    holding: SweepHolding;
    sellQty: number;
    event: string;
    note: string;
    /** 거래 기록에 남길 전략 ID (기본: 유휴현금 스윕) */
    strategyId?: string;
  }): Promise<{ net: number; pnl: number }> {
    const { holding, sellQty } = payload;
    const prefs = await deps.getPrefs(payload.chatId);
    const availableCash = Math.max(0, toNumber(prefs.virtual_cash, 0));
    const realizedPnl = toNumber(prefs.virtual_realized_pnl, 0);
    const { net, feeAmount, taxAmount, soldInvested } = estimateSweepSell(prefs, holding, sellQty);
    const gross = Math.round(holding.price * sellQty);
    const pnl = net - soldInvested;
    const remainingQty = holding.quantity - sellQty;
    const positions = () => payload.supabase.from(PORTFOLIO_TABLES.positions);

    await commitEtfTrade({
      chatId: payload.chatId,
      cashPatch: {
        virtual_cash: Math.max(0, Math.round(availableCash + net)),
        virtual_realized_pnl: realizedPnl + pnl,
      },
      revertCashPatch: { virtual_cash: availableCash, virtual_realized_pnl: realizedPnl },
      writePosition: () =>
        remainingQty <= 0
          ? positions().delete().eq("chat_id", payload.chatId).eq("id", holding.id)
          : positions()
              .update({
                quantity: remainingQty,
                invested_amount: Math.max(0, holding.invested_amount - soldInvested),
              })
              .eq("chat_id", payload.chatId)
              .eq("id", holding.id),
      tradeLog: {
        supabase: payload.supabase,
        chatId: payload.chatId,
        code: holding.code,
        side: "SELL",
        price: holding.price,
        quantity: sellQty,
        grossAmount: gross,
        netAmount: net,
        feeAmount,
        taxAmount,
        pnlAmount: pnl,
        memo: buildStrategyMemo({
          strategyId: payload.strategyId ?? CASH_SWEEP_STRATEGY_ID,
          event: payload.event,
          note: payload.note,
        }),
        source: "AUTO",
        brokerName: null,
        accountName: null,
      },
    });
    return { net, pnl };
  }

  /**
   * 스윕 매도 비용 계산 — 스윕 종목은 ETF라 매도 증권거래세가 없다 (resolveSellTaxRate).
   * 대신 레버리지·CD금리 같은 기타 ETF는 이익에 15.4%가 붙는다 (resolveOtherEtfGainTax).
   */
  function estimateSweepSell(
    prefs: Record<string, unknown>,
    holding: SweepHolding,
    sellQty: number
  ): { net: number; feeAmount: number; taxAmount: number; soldInvested: number } {
    const feeRate = toNumber(prefs.virtual_fee_rate, 0.00015);
    const taxRate = resolveSellTaxRate({ code: holding.code, baseRate: resolveBaseSellTaxRate(prefs.virtual_tax_rate as number | null | undefined) });
    const gross = Math.round(holding.price * sellQty);
    const feeAmount = Math.round(gross * feeRate);
    const avgBuyPrice = holding.quantity > 0 ? holding.invested_amount / holding.quantity : holding.price;
    const soldInvested = Math.round(avgBuyPrice * sellQty);
    const gainTax = resolveOtherEtfGainTax({ code: holding.code, gain: gross - feeAmount - soldInvested });
    const taxAmount = Math.round(gross * taxRate) + gainTax;
    return { net: Math.max(0, gross - feeAmount - taxAmount), feeAmount, taxAmount, soldInvested };
  }

  /**
   * 유휴현금 스윕 중 "현금화(liquidate)"만 담당하는 단계.
   * 매수 판단 로직보다 먼저 호출해, 스윕 포지션에 묶여있던 자금을 이번 회차 매수에도 쓸 수 있게 한다.
   * (예전엔 매수 판단 뒤에만 호출돼, 현금부족으로 스킵된 회차의 스윕 자금이 다음 회차에야 풀렸음)
   * 현금화가 일어나지 않으면(스윕 포지션 없음/임계값 이상) 아무 것도 하지 않고 조용히 반환한다.
   */
  async function runCashSweepLiquidateStep(payload: {
    supabase: SupabaseClientAny;
    chatId: number;
    dryRun: boolean;
    forceLiquidate?: boolean;
  }): Promise<{ notes: string[]; liquidated: boolean; releasedCash: number }> {
    const notes: string[] = [];
    try {
      const prefs = await deps.getPrefs(payload.chatId);
      const seedCapital = Math.max(
        0,
        toNumber(prefs.virtual_seed_capital, toNumber(prefs.capital_krw, 0))
      );
      const availableCash = Math.max(0, toNumber(prefs.virtual_cash, 0));
      if (seedCapital <= 0) return { notes, liquidated: false, releasedCash: 0 };

      const holding = loadSweepHolding(
        await loadSweepPositionRows(payload.supabase, payload.chatId),
        await loadSweepPrices(payload.supabase)
      );
      if (!holding) return { notes, liquidated: false, releasedCash: 0 };
      const sweepCurrentValue = holding.quantity * holding.price;

      if (!payload.forceLiquidate && !shouldLiquidateCashSweep({ availableCash, sweepPositionValue: sweepCurrentValue })) {
        return { notes, liquidated: false, releasedCash: 0 };
      }

      if (payload.dryRun) {
        notes.push(
          `[유휴현금 스윕][테스트] ${holding.name} 전량 현금화 예정 (평가액 ${fmtKrw(sweepCurrentValue)})${payload.forceLiquidate ? " · 수동 학습 판단용" : ""}`
        );
        return { notes, liquidated: false, releasedCash: estimateSweepSell(prefs, holding, holding.quantity).net };
      }

      const { net, pnl } = await sellSweepPosition({
        supabase: payload.supabase,
        chatId: payload.chatId,
        holding,
        sellQty: holding.quantity,
        event: "sweep-liquidate",
        note: "cash-sweep-liquidate",
      });
      notes.push(
        `[유휴현금 스윕] ${holding.name} 전량 현금화 · 실거래 자금 확보 (${fmtKrw(net)}, 손익 ${fmtSweepPnl(pnl)})${payload.forceLiquidate ? " · 수동 학습 판단용" : " · 참고: 유휴현금 파킹용이며 개별 종목 매수 신호가 아닙니다"}`
      );
      return { notes, liquidated: true, releasedCash: net };
    } catch (e) {
      console.error("[autoTrade] cash sweep liquidate step failed", e);
      return { notes: [], liquidated: false, releasedCash: 0 };
    }
  }

  /**
   * 다른 필터를 모두 통과한 실제 매수 후보가 현금 부족으로만 막혔을 때 호출한다.
   * 전량 현금화(runCashSweepLiquidateStep)와 달리 부족분만큼만 스윕 포지션을 매도해,
   * 나머지 잔량은 계속 굴리고 매매(수수료 발생) 빈도는 실제 매수 성사 빈도에만 비례하게 한다.
   */
  async function topUpCashSweepForBuy(payload: {
    supabase: SupabaseClientAny;
    chatId: number;
    dryRun: boolean;
    cashNeeded: number;
    availableCash: number;
  }): Promise<{ notes: string[]; releasedCash: number }> {
    const notes: string[] = [];
    try {
      const holding = loadSweepHolding(
        await loadSweepPositionRows(payload.supabase, payload.chatId),
        await loadSweepPrices(payload.supabase)
      );
      if (!holding) return { notes, releasedCash: 0 };

      const sellQty = resolveCashSweepTopUpQty({
        cashNeeded: payload.cashNeeded,
        availableCash: payload.availableCash,
        sweepQty: holding.quantity,
        sweepPrice: holding.price,
      });
      if (sellQty <= 0) return { notes, releasedCash: 0 };

      if (payload.dryRun) {
        const prefs = await deps.getPrefs(payload.chatId);
        notes.push(
          `[유휴현금 스윕][테스트] ${holding.name} ${sellQty}주 부분 현금화 예정 (신규매수 자금 보충, 평가액 ${fmtKrw(Math.round(holding.price * sellQty))})`
        );
        return { notes, releasedCash: estimateSweepSell(prefs, holding, sellQty).net };
      }

      const { net, pnl } = await sellSweepPosition({
        supabase: payload.supabase,
        chatId: payload.chatId,
        holding,
        sellQty,
        event: "sweep-topup",
        note: "cash-sweep-partial-topup-for-buy",
      });
      notes.push(
        `[유휴현금 스윕] ${holding.name} ${sellQty}주 부분 현금화 · 신규매수 자금 보충 (${fmtKrw(net)}, 손익 ${fmtSweepPnl(pnl)})`
      );
      return { notes, releasedCash: net };
    } catch (e) {
      console.error("[autoTrade] cash sweep top-up step failed", e);
      return { notes: [], releasedCash: 0 };
    }
  }

  /**
   * 현금하한(deployableCash)은 스윕 포지션 평가액까지 유동자금으로 보고 계산하므로, 사이징된 매수액이
   * 순수 현금(virtual_cash)보다 클 수 있다. 그 경우 스윕에서 부족분만 부분 매도해 현금을 맞춘다.
   * 보충 후에도 모자라면 호출측이 순수 현금 기준으로 매수 규모를 줄인다.
   * topUpCashSweepForBuy가 내부에서 예외를 삼키고 빈 결과를 돌려주므로 여기서 따로 catch하지 않는다.
   */
  async function ensureCashForBuy(payload: {
    supabase: SupabaseClientAny;
    chatId: number;
    dryRun: boolean;
    requiredCash: number;
    availableCash: number;
  }): Promise<{ notes: string[]; releasedCash: number }> {
    const requiredCash = Math.ceil(Math.max(0, payload.requiredCash) * BUY_CASH_BUFFER);
    if (requiredCash <= payload.availableCash) return { notes: [], releasedCash: 0 };
    return topUpCashSweepForBuy({
      supabase: payload.supabase,
      chatId: payload.chatId,
      dryRun: payload.dryRun,
      cashNeeded: requiredCash,
      availableCash: payload.availableCash,
    });
  }

  /** 현재 보유 중인 유휴현금 스윕 포지션 평가액 (없으면 0) */
  async function fetchCashSweepPositionValue(
    supabase: SupabaseClientAny,
    chatId: number
  ): Promise<number> {
    try {
      const sweepRows = await loadSweepPositionRows(supabase, chatId);
      if (!sweepRows.length) return 0;
      const { data: priceRows } = await supabase
        .from("stocks")
        .select("code, close")
        .in("code", sweepRows.map((row) => String(row.code ?? "")));
      const closeByCode = new Map(
        ((priceRows ?? []) as Record<string, unknown>[]).map((row) => [
          String(row.code ?? ""),
          toNumber(row.close, 0),
        ])
      );
      return sweepRows.reduce((sum, row) => {
        const qty = Math.max(0, Math.floor(toNumber(row.quantity, 0)));
        return sum + qty * (closeByCode.get(String(row.code ?? "")) ?? 0);
      }, 0);
    } catch (e) {
      console.error("[autoTrade] cash sweep value lookup failed", e);
      return 0;
    }
  }

  /**
   * 유휴현금 스윕 실행 단계. 매수/매도 판단이 모두 끝난 뒤 마지막에 한 번 호출한다.
   * - 실거래용 현금이 부족하면(CASH_SWEEP_LIQUIDATE_THRESHOLD 미만) 스윕 포지션을 전량 현금화해
   *   다음 회차 매수 자금으로 돌려준다. (매수 판단 전에도 runCashSweepLiquidateStep으로 선(先)현금화하지만,
   *   매수/매도 이후 현금이 다시 임계값 밑으로 떨어지는 경우를 대비해 여기서도 동일 점검을 유지한다.)
   * - 스윕은 항상 지수 ETF(KODEX 200)에 둔다. 예전 금리 ETF 보유분은 지수 ETF로 갈아탄다.
   *   보유 중인 스윕이 반대쪽이면 전량 팔아 갈아탄다.
   * - 유휴현금이 충분히 쌓였으면 그쪽 ETF를 매수(또는 추가매수 평단 갱신)한다.
   * 매매 실패는 자동매매 본 로직에 영향을 주지 않도록 통째로 삼킨다(best-effort).
   */
  async function runCashSweepStep(payload: {
    supabase: SupabaseClientAny;
    chatId: number;
    dryRun: boolean;
    disableParking?: boolean;
  }): Promise<{ notes: string[] }> {
    const notes: string[] = [];
    try {
      const liquidateResult = await runCashSweepLiquidateStep(payload);
      if (liquidateResult.notes.length > 0) {
        notes.push(...liquidateResult.notes);
      }
      if (liquidateResult.liquidated) {
        return { notes };
      }
      if (payload.disableParking) {
        return { notes };
      }

      let prefs = await deps.getPrefs(payload.chatId);
      const seedCapital = Math.max(
        0,
        toNumber(prefs.virtual_seed_capital, toNumber(prefs.capital_krw, 0))
      );
      if (seedCapital <= 0) return { notes };

      const prices = await loadSweepPrices(payload.supabase);
      const sweepRows = await loadSweepPositionRows(payload.supabase, payload.chatId);
      // 들고 있는 스윕 ETF의 실시간가가 없으면 쉰다 — 다른 지수 ETF를 새로 사면 두 종목으로 갈라진다
      if (hasUnpricedSweepHolding(sweepRows, prices)) {
        notes.push("[유휴현금 스윕] 보유 ETF의 실시간가가 없어 이번 회차는 쉽니다 (다음 회차에 다시)");
        return { notes };
      }
      // 50일선과 무관하게 항상 지수 ETF (2026-09-29 검증: 적립·거치 모두 보유가 하위 10% 결과까지 앞섬 — virtualAutoTradeCashSweep.ts)
      const targetCodes = INDEX_SWEEP_CODES;
      const targetLabel = "지수 보유";
      // 지수 ETF 가격이 없으면 이번 회차는 건너뛴다 (금리형으로 대체하면 들고 있던 지수 스윕을 팔아 버린다)
      const sweepCode = targetCodes.find((code) => (prices.get(code)?.close ?? 0) > 0);
      if (!sweepCode) return { notes };
      const sweepPrice = prices.get(sweepCode)!.close;
      const sweepName = prices.get(sweepCode)!.name || sweepCode;

      let holding = loadSweepHolding(sweepRows, prices);
      let availableCash = Math.max(0, toNumber(prefs.virtual_cash, 0));

      // 1) 반대쪽 스윕을 들고 있으면 갈아탄다
      if (holding && isIndexSweepCode(holding.code) !== isIndexSweepCode(sweepCode)) {
        if (payload.dryRun) {
          const net = estimateSweepSell(prefs, holding, holding.quantity).net;
          notes.push(`[유휴현금 스윕][테스트] ${targetLabel}: ${holding.name} 전량 매도 후 ${sweepName}로 교체 예정 (평가액 ${fmtKrw(holding.quantity * holding.price)})`);
          availableCash += net;
        } else {
          const { net, pnl } = await sellSweepPosition({
            supabase: payload.supabase,
            chatId: payload.chatId,
            holding,
            sellQty: holding.quantity,
            event: "sweep-rotate",
            note: `cash-sweep-rotate-to-${sweepCode}`,
          });
          notes.push(`[유휴현금 스윕] ${targetLabel}: ${holding.name} 전량 매도 (${fmtKrw(net)}, 손익 ${fmtSweepPnl(pnl)}) → ${sweepName}로 교체`);
          prefs = await deps.getPrefs(payload.chatId);
          availableCash = Math.max(0, toNumber(prefs.virtual_cash, 0));
        }
        holding = null;
      }

      const existingSweep = holding && holding.code === sweepCode ? holding : null;
      const sweepQty = existingSweep?.quantity ?? 0;
      const sweepInvested = existingSweep?.invested_amount ?? 0;

      // 2) 유휴현금 충분 → 스윕 매수(신규 진입 또는 추가매수 평단 갱신)
      const idleAmount = resolveCashSweepIdleAmount({ availableCash, seedCapital });
      if (idleAmount <= 0) return { notes };
      const buyQty = Math.floor(idleAmount / sweepPrice);
      if (buyQty <= 0) return { notes };
      const buyInvested = Math.round(buyQty * sweepPrice);

      if (payload.dryRun) {
        notes.push(`[유휴현금 스윕][테스트] ${sweepName} ${buyQty}주 매수 예정 (${fmtKrw(buyInvested)}) · ${targetLabel}`);
        return { notes };
      }

      const positions = () => payload.supabase.from(PORTFOLIO_TABLES.positions);
      const nextQty = sweepQty + buyQty;
      const nextInvested = sweepInvested + buyInvested;
      await commitEtfTrade({
        chatId: payload.chatId,
        cashPatch: { virtual_cash: Math.max(0, Math.round(availableCash - buyInvested)) },
        revertCashPatch: { virtual_cash: availableCash },
        writePosition: () =>
          existingSweep
            ? positions()
                .update({
                  quantity: nextQty,
                  invested_amount: nextInvested,
                  buy_price: Number((nextInvested / nextQty).toFixed(4)),
                })
                .eq("chat_id", payload.chatId)
                .eq("id", existingSweep.id)
            : positions().insert({
                chat_id: payload.chatId,
                code: sweepCode,
                buy_price: sweepPrice,
                buy_date: toKstDateKey(),
                quantity: buyQty,
                invested_amount: buyInvested,
                bucket: "SWING",
                status: "holding",
                broker_name: null,
                account_name: null,
                memo: buildStrategyMemo({
                  strategyId: CASH_SWEEP_STRATEGY_ID,
                  event: "sweep-buy",
                  note: "cash-sweep-buy",
                }),
              }),
        tradeLog: {
          supabase: payload.supabase,
          chatId: payload.chatId,
          code: sweepCode,
          side: "BUY",
          price: sweepPrice,
          quantity: buyQty,
          grossAmount: buyInvested,
          netAmount: buyInvested,
          memo: buildStrategyMemo({
            strategyId: CASH_SWEEP_STRATEGY_ID,
            event: "sweep-buy",
            note: "cash-sweep-buy",
          }),
          source: "AUTO",
          brokerName: null,
          accountName: null,
        },
      });

      notes.push(
        `[유휴현금 스윕] ${sweepName} ${buyQty}주 매수 · 유휴현금 ${fmtKrw(buyInvested)} 투입 (누적 ${fmtKrw(sweepInvested + buyInvested)}) · ${targetLabel}, 개별 종목 매수 신호가 아닙니다`
      );
      return { notes };
    } catch (e) {
      console.error("[autoTrade] cash sweep step failed", e);
      return { notes: [] };
    }
  }

  return {
    commitEtfTrade,
    sellSweepPosition,
    runCashSweepLiquidateStep,
    ensureCashForBuy,
    fetchCashSweepPositionValue,
    runCashSweepStep,
  };
}

export type CashSweepSteps = ReturnType<typeof createCashSweepSteps>;
