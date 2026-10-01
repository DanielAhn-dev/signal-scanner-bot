/**
 * 종목 자동매매의 매수 기록 — 신규 매수(월요일·일일점검 신규·실적 관문 교체)와 추가매수가 공통으로 쓰는 DB 단계.
 * 무엇을 몇 주 살지, 현금을 얼마나 쓸지는 호출측이 정한다. 여기는 포지션 생성과 그 뒤의 거래기록·FIFO 로트를 맡는다.
 *
 * 원장의 기준은 포지션이다 — 현금은 실행 끝의 syncVirtualPortfolio가 "시드 + 실현손익 − 보유 투자금"으로 다시 계산한다.
 * 그래서 포지션이 써졌으면 매수는 성립한 것으로 보고, 거래기록·로트 저장 실패는 로그만 남긴다.
 * 예전엔 거래기록 실패가 예외로 끝나 호출측이 가용현금을 줄이지 못했고, 같은 실행의 다음 매수가 없는 현금을 썼다.
 */
import { PORTFOLIO_TABLES } from "../db/portfolioSchema";
import type * as LotService from "./virtualLotService";

type SupabaseClientAny = any;

export type NewPositionRow = { id: number; created_at: string | null; buy_date: string | null };

export type AutoTradeBuyDeps = {
  appendTradeLog: (payload: {
    supabase: SupabaseClientAny;
    chatId: number;
    code: string;
    side: "BUY";
    price: number;
    quantity: number;
    grossAmount: number;
    netAmount: number;
    memo?: string;
    source?: "AUTO";
    brokerName?: string | null;
    accountName?: string | null;
  }) => Promise<number | null>;
  lots: Pick<typeof LotService, "ensureTradeLotsForHolding" | "appendTradeLotsForHolding">;
};

/** 예전 스키마라 진입 맥락 컬럼(target_horizon 등)이 없어서 난 오류인지 */
export function isMissingVirtualPositionHorizonColumns(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const rec = error as Record<string, unknown>;
  const code = String(rec.code ?? "").trim();
  const message = String(rec.message ?? rec.details ?? "").toLowerCase();
  if (code !== "42703") return false;
  return (
    message.includes("target_horizon") ||
    message.includes("horizon_reason") ||
    message.includes("macro_context_at_entry") ||
    message.includes("news_context_at_entry") ||
    message.includes("planned_review_at")
  );
}

const HORIZON_COLUMNS = [
  "target_horizon",
  "horizon_reason",
  "macro_context_at_entry",
  "news_context_at_entry",
  "planned_review_at",
] as const;

export function createAutoTradeBuyStep(deps: AutoTradeBuyDeps) {
  /**
   * 새 종목 포지션을 만든다. 같은 종목 포지션이 이미 있으면(겹친 실행 등) 아무것도 쓰지 않고 null —
   * 호출측은 이 매수를 건너뛴다 (예전엔 null이어도 거래기록·현금 차감을 진행해 없는 매수가 기록됐다).
   * 진입 맥락 컬럼이 없는 예전 스키마면 그 컬럼을 빼고 한 번 더 시도한다. 그 밖의 쓰기 오류는 예외.
   */
  async function insertNewPosition(
    supabase: SupabaseClientAny,
    row: Record<string, unknown>
  ): Promise<NewPositionRow | null> {
    const upsert = (values: Record<string, unknown>) =>
      supabase
        .from(PORTFOLIO_TABLES.positions)
        .upsert(values, { onConflict: "chat_id,code,account_name", ignoreDuplicates: true })
        .select("id, created_at, buy_date")
        .maybeSingle();

    let result = await upsert(row);
    if (result.error && isMissingVirtualPositionHorizonColumns(result.error)) {
      const fallback = { ...row };
      for (const column of HORIZON_COLUMNS) delete fallback[column];
      result = await upsert(fallback);
    }
    if (result.error) throw result.error;
    const data = result.data as Record<string, unknown> | null;
    if (!data) return null;
    return {
      id: Number(data.id ?? 0),
      created_at: String(data.created_at ?? "") || null,
      buy_date: String(data.buy_date ?? "") || null,
    };
  }

  /**
   * 포지션을 반영한 뒤 거래기록과 FIFO 로트를 남긴다. 둘 다 실패해도 매수는 성립하므로 예외를 던지지 않는다.
   * 새 포지션은 로트를 보유분 기준으로 맞추고(ensure), 추가매수는 이번 매수분 로트를 덧붙인다(append).
   * @returns 거래기록 ID (저장 실패 시 null)
   */
  async function recordBuyAfterPosition(input: {
    supabase: SupabaseClientAny;
    chatId: number;
    code: string;
    price: number;
    quantity: number;
    investedAmount: number;
    memo: string;
    lot:
      | { kind: "new"; position: NewPositionRow }
      | { kind: "add-on"; holdingId: number; note: string };
  }): Promise<number | null> {
    const tradeId = await deps
      .appendTradeLog({
        supabase: input.supabase,
        chatId: input.chatId,
        code: input.code,
        side: "BUY",
        price: input.price,
        quantity: input.quantity,
        grossAmount: input.investedAmount,
        netAmount: input.investedAmount,
        memo: input.memo,
        source: "AUTO",
        brokerName: null,
        accountName: null,
      })
      .catch((e: unknown) => {
        console.error("[autoTrade] 매수 거래기록 저장 실패 (포지션은 반영됨)", input.code, e);
        return null;
      });

    try {
      if (input.lot.kind === "new") {
        if (input.lot.position.id > 0) {
          await deps.lots.ensureTradeLotsForHolding({
            chatId: input.chatId,
            watchlistId: input.lot.position.id,
            code: input.code,
            quantity: input.quantity,
            investedAmount: input.investedAmount,
            buyPrice: input.price,
            acquiredAt: input.lot.position.created_at,
            buyDate: input.lot.position.buy_date,
          });
        }
      } else {
        await deps.lots.appendTradeLotsForHolding({
          chatId: input.chatId,
          watchlistId: input.lot.holdingId,
          code: input.code,
          quantity: input.quantity,
          investedAmount: input.investedAmount,
          buyPrice: input.price,
          acquiredAt: new Date().toISOString(),
          note: input.lot.note,
          sourceTradeId: tradeId,
        });
      }
    } catch (e) {
      // 로트가 없거나 모자라면 매도 때 executeAutoTradeSell이 보유분 기준으로 다시 만든다
      // (ensureTradeLotsForHolding 시드 / previewFifoSale 부족 시 replaceTradeLotsForHolding)
      console.error("[autoTrade] 매수 FIFO 로트 저장 실패 (매도 시 보유분 기준으로 재구성됨)", input.code, e);
    }
    return tradeId;
  }

  return { insertNewPosition, recordBuyAfterPosition };
}
