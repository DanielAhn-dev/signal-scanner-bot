/**
 * 현금 스윕(CD금리 ETF) 보유분 조회 — 리포트·장전플랜 공용.
 *
 * 스윕 ETF는 "바로 꺼내 쓸 수 있는 대기자금"이다 (코스피 50일선 위면 KODEX 200, 아래면 CD금리 ETF). 자동매매는 매수에 현금이 필요하면 스윕을 팔아 쓰는데,
 * 리포트·장전플랜은 virtual_cash만 가용현금으로 보고 스윕 ETF를 보유 종목 1개로 세서
 * (2026-09-28 기준 현금 87만 + 스윕 1,900만원) 모든 후보가 "0주"로 나오고 슬롯도 하나 줄었다.
 */
import { CASH_SWEEP_CANDIDATE_CODES, CASH_SWEEP_STRATEGY_ID } from "./virtualAutoTradeCashSweep";
import { parseStrategyMemo } from "../lib/strategyMemo";

type SupabaseClientAny = any;

export type CashSweepHolding = {
  /** 스윕 ETF 평가금액 (최신 종가 기준, 없으면 매수가) */
  value: number;
  /** 보유 중인 스윕 ETF 코드 — 보유 종목 수·슬롯 계산에서 뺀다 */
  codes: Set<string>;
};

export function isCashSweepCode(code: string | null | undefined): boolean {
  return CASH_SWEEP_CANDIDATE_CODES.includes(String(code ?? "").trim());
}

export async function fetchCashSweepHolding(supabase: SupabaseClientAny, chatId: number): Promise<CashSweepHolding> {
  const { data } = await supabase
    .from("virtual_positions")
    .select("code, quantity, buy_price, status, memo, stock:stocks(close)")
    .eq("chat_id", chatId)
    .in("code", CASH_SWEEP_CANDIDATE_CODES);
  let value = 0;
  const codes = new Set<string>();
  for (const row of (data ?? []) as Array<{
    code: string;
    quantity: number | null;
    buy_price: number | null;
    status?: string | null;
    memo?: string | null;
    stock?: { close?: number | null } | Array<{ close?: number | null }> | null;
  }>) {
    const qty = Math.max(0, Math.floor(Number(row.quantity ?? 0)));
    if (qty <= 0 || String(row.status ?? "holding") === "closed") continue;
    // 사용자가 직접 산 같은 ETF(예: KODEX 200)는 스윕이 아니다
    if (parseStrategyMemo(row.memo ?? null).strategyId !== CASH_SWEEP_STRATEGY_ID) continue;
    const stock = Array.isArray(row.stock) ? row.stock[0] : row.stock;
    const price = Number(stock?.close ?? 0) > 0 ? Number(stock?.close) : Number(row.buy_price ?? 0);
    value += qty * Math.max(0, price);
    codes.add(String(row.code).trim());
  }
  return { value: Math.floor(value), codes };
}
