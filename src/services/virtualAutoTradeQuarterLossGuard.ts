/**
 * 분기 개별주 손실 한도 — 이번 분기(KST 달력 분기) 개별주 손익이 개별주 몫의 −15%에 닿으면 그 분기 개별주 신규·추가 매수를 멈춘다.
 *
 * 근거: docs/hypothesis-ledger.md '11/23 안건 — 봇 개별주 상한·손실 한도'(손실 차단형). 상한 10%는 10/12에 넣었고,
 * 손실 한도는 2026-10-13 사용자 결정으로 11/23 관문보다 먼저 넣었다(하락장, 손실 차단형이라 수익 비교 대상이 아님).
 * 개별주 우위 근거 없음(C1·C23·C45), 봇 가상계좌 6/9~10/7 28건 세전 −153,438원.
 *
 * 손익 = 이번 분기 확정 손익(매도 pnl_amount, 순손익) + 지금 들고 있는 개별주의 평가손익(종가 − 매수원금).
 * 평가손익을 넣는 이유: 손절 전에 크게 물려 있는 상태도 '잃고 있는 중'이다. 평가손익이 회복되면 다시 열린다.
 * 분모 = 시드 × 개별주 몫(기본 10%, 실험 계좌 100%). 지수(스윕)·ETF는 빼고 센다.
 * 매도(손절·익절)는 막지 않는다 — 새로 사는 것만 멈춘다.
 */
import { PORTFOLIO_TABLES } from "../db/portfolioSchema";
import { isExchangeTradedProduct } from "../lib/securitiesTax";
import { parseStrategyMemo } from "../lib/strategyMemo";
import { CASH_SWEEP_STRATEGY_ID } from "./virtualAutoTradeCashSweep";

type SupabaseClientAny = any;

export const QUARTER_STOCK_LOSS_LIMIT_PCT = -15;

export type QuarterLossGuard = {
  /** 분기 시작일 (KST, YYYY-MM-DD) */
  quarterStart: string;
  sleeveAmount: number;
  realizedPnl: number;
  unrealizedPnl: number;
  pnlPct: number;
  blocked: boolean;
};

/** KST 기준 이번 분기 시작 시각(UTC ISO)과 날짜 */
export function resolveKstQuarterStart(base = new Date()): { startIso: string; startDate: string } {
  const kst = new Date(base.getTime() + 9 * 60 * 60 * 1000);
  const year = kst.getUTCFullYear();
  const month = Math.floor(kst.getUTCMonth() / 3) * 3;
  const utcMs = Date.UTC(year, month, 1) - 9 * 60 * 60 * 1000;
  return {
    startIso: new Date(utcMs).toISOString(),
    startDate: `${year}-${String(month + 1).padStart(2, "0")}-01`,
  };
}

export function evaluateQuarterLossGuard(input: {
  seedCapital: number;
  capPct: number;
  realizedPnl: number;
  unrealizedPnl: number;
  quarterStart: string;
}): QuarterLossGuard {
  const sleeveAmount = Math.max(0, input.seedCapital) * (Math.max(0, input.capPct) / 100);
  const pnl = input.realizedPnl + input.unrealizedPnl;
  const pnlPct = sleeveAmount > 0 ? (pnl / sleeveAmount) * 100 : 0;
  return {
    quarterStart: input.quarterStart,
    sleeveAmount,
    realizedPnl: input.realizedPnl,
    unrealizedPnl: input.unrealizedPnl,
    pnlPct,
    blocked: sleeveAmount > 0 && pnlPct <= QUARTER_STOCK_LOSS_LIMIT_PCT,
  };
}

const isStockRow = (code: string, memo: unknown, name?: string | null) =>
  parseStrategyMemo(memo as string | null).strategyId !== CASH_SWEEP_STRATEGY_ID && !isExchangeTradedProduct(code, name);

/**
 * 조회 실패면 null — 손익을 모른 채 '한도 안'으로 보지 않는다. 호출측은 그 회차 개별주 매수를 쉰다.
 */
export async function fetchQuarterLossGuard(input: {
  supabase: SupabaseClientAny;
  chatId: number;
  seedCapital: number;
  capPct: number;
  now?: Date;
}): Promise<QuarterLossGuard | null> {
  const { startIso, startDate } = resolveKstQuarterStart(input.now);
  const [tradesRes, positionsRes] = await Promise.all([
    input.supabase
      .from(PORTFOLIO_TABLES.trades)
      .select("code, pnl_amount, memo")
      .eq("chat_id", input.chatId)
      .eq("side", "SELL")
      .is("broker_name", null)
      .is("account_name", null)
      .gte("traded_at", startIso)
      .limit(1000),
    input.supabase
      .from(PORTFOLIO_TABLES.positions)
      .select("code, quantity, invested_amount, memo")
      .eq("chat_id", input.chatId)
      .eq("status", "holding")
      .is("broker_name", null)
      .is("account_name", null),
  ]);
  if (tradesRes.error || positionsRes.error) return null;
  const trades = (tradesRes.data ?? []) as Record<string, unknown>[];
  // 1000행 캡에 걸리면 합계가 잘린다 — 분기 매도가 그만큼일 리 없지만, 걸리면 모르는 것으로 본다
  if (trades.length >= 1000) return null;
  const positions = ((positionsRes.data ?? []) as Record<string, unknown>[]).filter(
    (row) => Math.floor(Number(row.quantity) || 0) > 0
  );

  const codes = [...new Set([...trades, ...positions].map((row) => String(row.code ?? "").trim()).filter(Boolean))];
  const stockByCode = new Map<string, { name: string; close: number }>();
  if (codes.length) {
    const { data, error } = await input.supabase.from("stocks").select("code, name, close").in("code", codes);
    if (error) return null;
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      stockByCode.set(String(row.code ?? ""), { name: String(row.name ?? ""), close: Number(row.close) || 0 });
    }
  }

  let realizedPnl = 0;
  for (const row of trades) {
    const code = String(row.code ?? "").trim();
    if (!isStockRow(code, row.memo, stockByCode.get(code)?.name)) continue;
    realizedPnl += Number(row.pnl_amount) || 0;
  }
  let unrealizedPnl = 0;
  for (const row of positions) {
    const code = String(row.code ?? "").trim();
    const stock = stockByCode.get(code);
    if (!isStockRow(code, row.memo, stock?.name)) continue;
    const close = stock?.close ?? 0;
    if (!(close > 0)) continue;
    const qty = Math.floor(Number(row.quantity) || 0);
    const invested = Math.max(0, Number(row.invested_amount) || 0);
    unrealizedPnl += qty * close - invested;
  }

  return evaluateQuarterLossGuard({
    seedCapital: input.seedCapital,
    capPct: input.capPct,
    realizedPnl,
    unrealizedPnl,
    quarterStart: startDate,
  });
}
