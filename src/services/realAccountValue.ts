/**
 * [실제] 내 계좌 평가액 — 홈·모아가기 '내 모으기'와 목표 트래커가 같은 값을 쓴다.
 * 실계좌 보유(virtual_positions 중 증권사·계좌명이 있는 행) × 시세 + 리밸런싱 가이드에 적은 예수금.
 * 봇 가상 계좌는 넣지 않는다. 증권사 연동이 없으므로 사용자가 적은 보유·예수금 기준이다.
 */
import { fetchGuidePrices, loadAccountPositionRows, loadGuideFile, toGuideHoldings, type GuideFile } from "./incomeGuideStore";
import { totalCashBalance, type GuideHolding } from "../lib/incomeGuide";

export type RealAccountValue = {
  /** 보유 평가금 + 예수금 */
  total: number;
  holdings: number;
  cash: number;
  /** 매수가 기준 원금(예수금 제외) */
  cost: number;
  holdingCount: number;
  /** 계산에 쓴 보유 — 부르는 쪽이 세금 추정 등에 다시 쓴다 */
  guideHoldings: GuideHolding[];
};

/**
 * 목표 계산용 [실제] 자산 — 실계좌 기록(보유·예수금)이 하나도 없으면 null(가상 계좌로 계산하고 화면에 그렇게 알린다).
 * 조회 실패도 null이지만 실패를 0원으로 보지는 않는다.
 */
export async function realGoalEquity(supabase: any, chatId: string | number): Promise<{ total: number; principal: number } | null> {
  try {
    const r = await fetchRealAccountValue(supabase, chatId);
    if (r.holdingCount === 0 && r.cash <= 0) return null;
    return { total: r.total, principal: r.cost + r.cash };
  } catch (e) {
    console.warn("[realGoalEquity] 실계좌 평가액을 읽지 못해 가상 계좌로 계산", e);
    return null;
  }
}

/** 보유 조회가 실패하면 throw — 실패를 "보유 0"으로 보지 않는다(목표 진행이 0으로 떨어져 보이지 않게) */
export async function fetchRealAccountValue(
  supabase: any,
  chatId: string | number,
  /** 이미 읽은 가이드 파일(예수금) — 없으면 여기서 읽는다 */
  opts: { guide?: GuideFile | null } = {}
): Promise<RealAccountValue> {
  const rows = await loadAccountPositionRows(supabase, chatId);
  const { prices } = await fetchGuidePrices(supabase, rows.map((r) => r.code));
  const { holdings } = toGuideHoldings(rows, prices);
  const guide = opts.guide !== undefined ? opts.guide : await loadGuideFile(supabase, chatId);
  const cash = guide ? totalCashBalance(guide.settings) : 0;
  const cost = holdings.reduce((s, h) => s + h.quantity * (h.avgPrice ?? h.price), 0);
  const value = holdings.reduce((s, h) => s + h.quantity * h.price, 0);
  return {
    total: Math.round(value + cash),
    holdings: Math.round(value),
    cash: Math.round(cash),
    cost: Math.round(cost),
    holdingCount: holdings.length,
    guideHoldings: holdings,
  };
}
