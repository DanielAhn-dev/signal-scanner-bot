/**
 * 지수 보유 모드의 DB 실행 단계 — 모드 전환 시 종목 봇 보유분 정리, 지수 ETF 리밸런싱 매매, 모드 해제 시 보유분 정리.
 * 무엇을 얼마나 사고팔지는 indexHoldStrategy.ts(planIndexHoldRebalance)가 정하고, 여기는 그 계획을 DB에 적용한다.
 *
 * 설정(prefs)·실시간가·종목 매도·스윕 매매는 deps로 주입받는다 — 자동매매 서비스가 실제 구현을 넘기고,
 * 테스트는 가짜를 넘겨 매매 결과와 실패 시 자산 일관성을 검증한다.
 */
import { toKstDateKey } from "../lib/krxCalendar";
import { PORTFOLIO_TABLES } from "../db/portfolioSchema";
import { buildStrategyMemo, parseStrategyMemo } from "../lib/strategyMemo";
import { resolveBaseSellTaxRate } from "../lib/securitiesTax";
import { AUTO_TRADE_STRATEGY_ID } from "../lib/strategyMemo";
import { CASH_SWEEP_STRATEGY_ID } from "./virtualAutoTradeCashSweep";
import { fmtSweepPnl, type CashSweepSteps, type SweepHolding } from "./virtualAutoTradeCashSweepStep";
import {
  INDEX_HOLD_DESCRIPTION,
  INDEX_HOLD_STRATEGY_ID,
  INDEX_MODE_CODES,
  INDEX_MODE_STRATEGY_IDS,
  isLeverageEtfCode,
  planIndexHoldRebalance,
} from "./indexHoldStrategy";
import type { AutoTradeActionSummary } from "./virtualAutoTradeService";

type SupabaseClientAny = any;

/** 지수 보유 모드가 읽는 보유 행 (자동매매 서비스의 HoldingRow와 호환되는 최소 필드) */
export type IndexHoldRow = {
  id: number;
  code: string;
  buy_price: number | null;
  quantity: number | null;
  invested_amount: number | null;
  memo?: string | null;
};

export type IndexHoldDeps = {
  getPrefs: (chatId: number) => Promise<Record<string, unknown>>;
  /** 장중이면 가격을 실시간가로 덮어쓰고, 실시간가를 못 받은 종목은 0으로 지운다 */
  overlayIntradayPrices: (prices: Map<string, number>, codes: string[]) => Promise<unknown>;
  /** 봇 계좌(브로커·계좌명 없음)의 보유 중 포지션 */
  fetchHoldings: (supabase: SupabaseClientAny, chatId: number) => Promise<{ data: IndexHoldRow[] | null; error: unknown }>;
  /** 종목 봇이 산 보유분 전량 매도 (자동매매 일반 매도 경로) */
  sellStockBotHolding: (input: {
    supabase: SupabaseClientAny;
    runId: number | null;
    chatId: number;
    holding: IndexHoldRow;
    price: number;
    qty: number;
    feeRate: number;
    taxRate: number;
    dryRun: boolean;
  }) => Promise<{ sold: boolean; note: string }>;
  sellSweepPosition: CashSweepSteps["sellSweepPosition"];
  commitEtfTrade: CashSweepSteps["commitEtfTrade"];
  writeActionLog: (payload: {
    supabase: SupabaseClientAny;
    runId: number | null;
    chatId: number;
    code?: string;
    actionType: "BUY";
    reason?: string;
    detail?: Record<string, unknown>;
  }) => Promise<void>;
};

function toNumber(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function fmtKrw(value: number): string {
  return `${Math.round(value).toLocaleString("ko-KR")}원`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const rec = error as Record<string, unknown>;
    const message = String(rec.message ?? rec.details ?? rec.hint ?? "").trim();
    if (message) return message;
  }
  return String(error ?? "unknown error");
}

/** 봇이 산 지수·레버리지·금리 ETF 보유분 (유휴현금 스윕 또는 지수 보유·예전 1.5배 모드로 산 것만 — 사용자가 직접 산 같은 ETF는 제외) */
export function isBotIndexEtfRow(row: Pick<IndexHoldRow, "code" | "memo">): boolean {
  if (!INDEX_MODE_CODES.includes(String(row.code))) return false;
  const strategyId = parseStrategyMemo(row.memo).strategyId;
  return strategyId === CASH_SWEEP_STRATEGY_ID || INDEX_MODE_STRATEGY_IDS.includes(strategyId ?? "");
}

export function createIndexHoldSteps(deps: IndexHoldDeps) {
  /**
   * 지수 보유 모드 실행. 계정 설정으로 켜면 종목 매수·일일점검·유휴현금 스윕 대신 호출된다.
   * 1) 종목 봇이 산 보유분이 남아 있으면 정리 (모드를 켠 직후 한 번)
   * 2) 지수 ETF가 아닌 보유분(예전 1.5배 모드의 레버리지·금리 ETF)은 팔고, 현금은 전부 KODEX 200
   */
  async function runIndexHoldForUser(payload: {
    supabase: SupabaseClientAny;
    setting: { chat_id: number };
    runId: number | null;
    dryRun: boolean;
  }): Promise<AutoTradeActionSummary> {
    const chatId = payload.setting.chat_id;
    const summary: AutoTradeActionSummary = { chatId, buys: 0, sells: 0, skipped: 0, errors: 0, notes: [] };
    const tag = "[지수 보유]";
    const prefs = await deps.getPrefs(chatId);
    const feeRate = toNumber(prefs.virtual_fee_rate, 0.00015);
    const taxRate = resolveBaseSellTaxRate(prefs.virtual_tax_rate as number | null | undefined);

    const { data: holdingsData, error: holdingsError } = await deps.fetchHoldings(payload.supabase, chatId);
    if (holdingsError) {
      summary.errors += 1;
      summary.notes.push(`${tag} 보유 조회 실패: ${errorMessage(holdingsError)}`);
      return summary;
    }
    const rows = holdingsData ?? [];
    const etfRows = rows.filter(isBotIndexEtfRow);
    const stockBotRows = rows.filter(
      (row) => !isBotIndexEtfRow(row) && parseStrategyMemo(row.memo).strategyId === AUTO_TRADE_STRATEGY_ID
    );

    const priceCodes = [...new Set([...INDEX_MODE_CODES, ...stockBotRows.map((row) => row.code)])];
    const { data: priceRows } = await payload.supabase.from("stocks").select("code, name, close").in("code", priceCodes);
    const prices = new Map<string, number>();
    const names = new Map<string, string>();
    for (const row of (priceRows ?? []) as Array<{ code: string; name: string | null; close: number | null }>) {
      if (toNumber(row.close, 0) > 0) prices.set(row.code, toNumber(row.close, 0));
      names.set(row.code, row.name ?? row.code);
    }
    await deps.overlayIntradayPrices(prices, priceCodes);
    const label = (code: string) => `${names.get(code) ?? code}(${code})`;

    // 1) 종목 봇 보유분 정리
    for (const holding of stockBotRows) {
      const qty = Math.max(0, Math.floor(toNumber(holding.quantity, 0)));
      const price = prices.get(holding.code) ?? 0;
      if (qty <= 0 || !(price > 0)) {
        summary.skipped += 1;
        summary.notes.push(`${tag} ${label(holding.code)} 정리 보류: 가격 없음`);
        continue;
      }
      const result = await deps
        .sellStockBotHolding({
          supabase: payload.supabase,
          runId: payload.runId,
          chatId,
          holding,
          price,
          qty,
          feeRate,
          taxRate,
          dryRun: payload.dryRun,
        })
        .catch((e: unknown) => {
          summary.errors += 1;
          summary.notes.push(`${tag} ${label(holding.code)} 정리 실패: ${errorMessage(e)}`);
          return null;
        });
      if (result?.sold) {
        summary.sells += 1;
        summary.notes.push(`${tag}[모드 전환 정리] ${label(holding.code)} ${qty}주 — 종목 봇 보유분 · ${result.note}`);
      } else if (result && payload.dryRun) {
        summary.notes.push(`${tag}[테스트] ${label(holding.code)} ${qty}주 정리 예정 (종목 봇 보유분)`);
      }
    }

    // 2) 지수 ETF로 맞추기 (정리 매도로 늘어난 현금을 다시 읽는다)
    const cash = payload.dryRun
      ? Math.max(0, toNumber(prefs.virtual_cash, 0))
      : Math.max(0, toNumber((await deps.getPrefs(chatId)).virtual_cash, 0));
    const plan = planIndexHoldRebalance({
      cash,
      holdings: etfRows.map((row) => ({
        code: row.code,
        quantity: Math.max(0, Math.floor(toNumber(row.quantity, 0))),
        price: prices.get(row.code) ?? 0,
      })),
      prices,
      feeRate,
    });
    summary.notes.push(`${tag} ${INDEX_HOLD_DESCRIPTION} · 매도 ${plan.sell.length} · 매수 ${plan.buy.length}`);
    summary.notes.push(...plan.notes.map((note) => `${tag} ${note}`));

    for (const order of plan.sell) {
      const row = etfRows.find((r) => r.code === order.code)!;
      const holding: SweepHolding = {
        id: toNumber(row.id, 0),
        code: row.code,
        name: names.get(row.code) ?? row.code,
        price: prices.get(row.code) ?? 0,
        quantity: order.quantity,
        invested_amount: Math.max(0, toNumber(row.invested_amount, 0)),
      };
      if (payload.dryRun) {
        summary.notes.push(`${tag}[테스트] ${label(row.code)} ${order.quantity}주 전량 매도 예정 (평가액 ${fmtKrw(order.quantity * holding.price)})`);
        continue;
      }
      try {
        const { net, pnl } = await deps.sellSweepPosition({
          supabase: payload.supabase,
          chatId,
          holding,
          sellQty: order.quantity,
          event: "index-mode-rotate",
          note: "index-hold-rotate",
          strategyId: INDEX_HOLD_STRATEGY_ID,
        });
        summary.sells += 1;
        summary.notes.push(`${tag} ${label(row.code)} ${order.quantity}주 전량 매도 (${fmtKrw(net)}, 손익 ${fmtSweepPnl(pnl)}) — ${INDEX_HOLD_DESCRIPTION}`);
      } catch (e) {
        summary.errors += 1;
        summary.notes.push(`${tag} ${label(row.code)} 매도 실패: ${errorMessage(e)}`);
      }
    }

    for (const order of plan.buy) {
      const price = prices.get(order.code) ?? 0;
      const invested = Math.round(order.quantity * price);
      if (payload.dryRun) {
        summary.notes.push(`${tag}[테스트] ${label(order.code)} ${order.quantity}주 매수 예정 (${fmtKrw(invested)})`);
        continue;
      }
      // 매도 반영 뒤 현금을 다시 읽어, 현금보다 많이 사지 않는다
      const available = Math.max(0, toNumber((await deps.getPrefs(chatId)).virtual_cash, 0));
      const quantity = Math.min(order.quantity, Math.floor(available / (price * (1 + feeRate))));
      if (quantity <= 0) {
        summary.skipped += 1;
        summary.notes.push(`${tag} ${label(order.code)} 매수 보류: 현금 부족`);
        continue;
      }
      const amount = Math.round(quantity * price);
      const fee = Math.round(amount * feeRate);
      const memo = buildStrategyMemo({ strategyId: INDEX_HOLD_STRATEGY_ID, event: "index-mode-buy", note: "index-hold" });
      const existing = etfRows.find((row) => row.code === order.code);
      const nextQty = Math.floor(toNumber(existing?.quantity, 0)) + quantity;
      const nextInvested = Math.round(toNumber(existing?.invested_amount, 0)) + amount + fee;
      const positions = () => payload.supabase.from(PORTFOLIO_TABLES.positions);
      try {
        await deps.commitEtfTrade({
          chatId,
          cashPatch: { virtual_cash: Math.max(0, Math.round(available - amount - fee)) },
          revertCashPatch: { virtual_cash: available },
          writePosition: () =>
            existing
              ? positions()
                  .update({
                    quantity: nextQty,
                    invested_amount: nextInvested,
                    buy_price: Number((nextInvested / nextQty).toFixed(4)),
                    memo,
                  })
                  .eq("chat_id", chatId)
                  .eq("id", existing.id)
              : positions().insert({
                  chat_id: chatId,
                  code: order.code,
                  buy_price: price,
                  buy_date: toKstDateKey(),
                  quantity,
                  invested_amount: nextInvested,
                  bucket: "SWING",
                  status: "holding",
                  broker_name: null,
                  account_name: null,
                  memo,
                }),
          tradeLog: {
            supabase: payload.supabase,
            chatId,
            code: order.code,
            side: "BUY",
            price,
            quantity,
            grossAmount: amount,
            netAmount: amount + fee,
            feeAmount: fee,
            memo,
            source: "AUTO",
            brokerName: null,
            accountName: null,
          },
        });
      } catch (e) {
        summary.errors += 1;
        summary.notes.push(`${tag} ${label(order.code)} 매수 실패: ${errorMessage(e)}`);
        continue;
      }
      summary.buys += 1;
      summary.notes.push(`${tag} ${label(order.code)} ${quantity}주 매수 · ${fmtKrw(price)} · 투입 ${fmtKrw(amount)} — ${INDEX_HOLD_DESCRIPTION}`);
      await deps.writeActionLog({
        supabase: payload.supabase,
        runId: payload.runId,
        chatId,
        code: order.code,
        actionType: "BUY",
        reason: "index-hold",
        detail: { qty: quantity, price },
      });
    }

    if (!plan.sell.length && !plan.buy.length && !stockBotRows.length) {
      summary.skipped += 1;
    }
    return summary;
  }

  /**
   * 지수 보유 모드(또는 예전 1.5배 모드)를 끈 계정: 레버리지 ETF는 팔고, KODEX 200·금리 ETF는 유휴현금 스윕으로 넘긴다
   * (종목 봇의 스윕 단계가 이어서 관리). 해당 보유분이 없으면 아무것도 하지 않는다.
   * 한 종목이 실패해도 나머지 종목은 계속 처리하고, 실패는 알림 문구로 남긴다.
   */
  async function releaseIndexModeHoldings(payload: {
    supabase: SupabaseClientAny;
    chatId: number;
    dryRun: boolean;
  }): Promise<{ notes: string[] }> {
    const notes: string[] = [];
    try {
      const { data } = await payload.supabase
        .from(PORTFOLIO_TABLES.positions)
        .select("id, code, quantity, invested_amount, memo")
        .eq("chat_id", payload.chatId)
        .in("code", INDEX_MODE_CODES)
        .eq("status", "holding")
        .is("broker_name", null)
        .is("account_name", null);
      const rows = ((data ?? []) as Record<string, unknown>[]).filter(
        (row) => INDEX_MODE_STRATEGY_IDS.includes(parseStrategyMemo(row.memo as string | null).strategyId ?? "")
      );
      if (!rows.length) return { notes };
      const { data: priceRows } = await payload.supabase
        .from("stocks")
        .select("code, name, close")
        .in("code", rows.map((row) => String(row.code)));
      const priceMap = new Map(
        ((priceRows ?? []) as Record<string, unknown>[]).map((row) => [
          String(row.code),
          { close: toNumber(row.close, 0), name: String(row.name ?? row.code) },
        ])
      );
      for (const row of rows) {
        const code = String(row.code);
        const info = priceMap.get(code);
        const name = info?.name ?? code;
        if (!isLeverageEtfCode(code)) {
          if (!payload.dryRun) {
            const { error } = await payload.supabase
              .from(PORTFOLIO_TABLES.positions)
              .update({ memo: buildStrategyMemo({ strategyId: CASH_SWEEP_STRATEGY_ID, event: "sweep-buy", note: "from-index-mode" }) })
              .eq("chat_id", payload.chatId)
              .eq("id", toNumber(row.id, 0));
            if (error) {
              notes.push(`[지수 모드 해제] ${name} 스윕으로 넘기기 실패 (다음 회차에 다시): ${errorMessage(error)}`);
              continue;
            }
          }
          notes.push(`[지수 모드 해제] ${name} 보유분을 유휴현금 스윕으로 넘김`);
          continue;
        }
        const quantity = Math.max(0, Math.floor(toNumber(row.quantity, 0)));
        if (!info || info.close <= 0 || quantity <= 0) {
          notes.push(`[지수 모드 해제] ${name} 매도 보류: 가격 없음`);
          continue;
        }
        if (payload.dryRun) {
          notes.push(`[지수 모드 해제][테스트] ${info.name} ${quantity}주 매도 예정`);
          continue;
        }
        try {
          const { net, pnl } = await deps.sellSweepPosition({
            supabase: payload.supabase,
            chatId: payload.chatId,
            holding: {
              id: toNumber(row.id, 0),
              code,
              name: info.name,
              price: info.close,
              quantity,
              invested_amount: Math.max(0, toNumber(row.invested_amount, 0)),
            },
            sellQty: quantity,
            event: "index-mode-release",
            note: "index-mode-off",
            strategyId: String(parseStrategyMemo(row.memo as string | null).strategyId ?? INDEX_HOLD_STRATEGY_ID),
          });
          notes.push(`[지수 모드 해제] ${info.name} ${quantity}주 매도 (${fmtKrw(net)}, 손익 ${fmtSweepPnl(pnl)})`);
        } catch (e) {
          notes.push(`[지수 모드 해제] ${info.name} 매도 실패 (다음 회차에 다시): ${errorMessage(e)}`);
        }
      }
    } catch (e) {
      console.error("[autoTrade] index mode release failed", e);
    }
    return { notes };
  }

  return { runIndexHoldForUser, releaseIndexModeHoldings };
}
