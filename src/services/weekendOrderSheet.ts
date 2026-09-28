/**
 * 금요일 장 마감 후 "다음 주 주문표" — 눌림목 리포트 후보를 MTS에 미리 걸 수 있는 형태로 정리한다.
 *   매수: 진입 밴드 상단 지정가 (호가단위 내림) — 밴드 안으로 내려와야 체결
 *   익절: 1차 목표가 감시매도 (호가단위 내림) / 손절: 손절가 감시매도 (호가단위 올림)
 * 수량은 계정 시드·가용현금(현금 스윕 포함) 기준 1차 분할 예산으로 다시 계산한다.
 */
import { roundToKrxTick } from "./mtsMirrorOrderService";

export type OrderSheetCandidate = {
  code: string;
  name: string;
  currentPrice: number;
  entryLow: number;
  entryHigh: number;
  stopPrice: number;
  target1: number;
  riskReward?: number | null;
  statusLabel?: string | null;
  trancheBudget: number;
};

export type OrderSheetLine = {
  code: string;
  name: string;
  limitPrice: number;
  quantity: number;
  amount: number;
  takeProfitPrice: number;
  takeProfitPct: number;
  stopPrice: number;
  stopPct: number;
  gapFromCurrentPct: number;
  riskReward: number;
};

export function buildOrderSheetLines(candidates: OrderSheetCandidate[], limit = 5): OrderSheetLine[] {
  const lines: OrderSheetLine[] = [];
  for (const c of candidates) {
    if (lines.length >= limit) break;
    const limitPrice = roundToKrxTick(Math.min(c.entryHigh, c.currentPrice || c.entryHigh), "floor");
    if (!(limitPrice > 0) || !(c.trancheBudget > 0)) continue;
    const quantity = Math.floor(c.trancheBudget / limitPrice);
    if (quantity <= 0) continue;
    const takeProfitPrice = roundToKrxTick(c.target1, "floor");
    const stopPrice = roundToKrxTick(c.stopPrice, "ceil");
    if (!(takeProfitPrice > limitPrice) || !(stopPrice > 0 && stopPrice < limitPrice)) continue;
    const pct = (p: number) => Number(((p / limitPrice - 1) * 100).toFixed(1));
    lines.push({
      code: c.code,
      name: c.name,
      limitPrice,
      quantity,
      amount: limitPrice * quantity,
      takeProfitPrice,
      takeProfitPct: pct(takeProfitPrice),
      stopPrice,
      stopPct: pct(stopPrice),
      gapFromCurrentPct: c.currentPrice > 0 ? Number(((limitPrice / c.currentPrice - 1) * 100).toFixed(1)) : 0,
      riskReward: Number(((takeProfitPrice - limitPrice) / (limitPrice - stopPrice)).toFixed(2)),
    });
  }
  return lines;
}

const won = (n: number) => `${Math.round(n).toLocaleString("ko-KR")}원`;

export function formatOrderSheetText(input: { dateLabel: string; cashLabel: string; lines: OrderSheetLine[] }): string {
  const head = [`📋 다음 주 주문표 (${input.dateLabel} 기준)`, `가용 ${input.cashLabel}`];
  if (!input.lines.length) return [...head, "", "조건에 맞는 주문 후보가 없습니다 — 다음 주는 현금 대기."].join("\n");
  const body = input.lines.map((l, i) =>
    [
      `${i + 1}. ${l.name}(${l.code})`,
      `   매수 지정가 ${won(l.limitPrice)} × ${l.quantity}주 = ${won(l.amount)} (현재가 대비 ${l.gapFromCurrentPct}%)`,
      `   익절 감시 ${won(l.takeProfitPrice)} (+${l.takeProfitPct}%) · 손절 감시 ${won(l.stopPrice)} (${l.stopPct}%) · 손익비 ${l.riskReward}`,
    ].join("\n")
  );
  return [
    ...head,
    "",
    ...body,
    "",
    "※ 지정가는 진입 밴드 상단 — 월요일 시초가가 위로 갭이면 체결되지 않는 게 정상입니다.",
    "※ 손익비 1 미만은 승률 50% 이상이어야 본전 — 전략 경쟁 측정(주문표 전략) 결과를 보고 판단하세요.",
    "※ 봇 자동매매와 같은 제외 기준(ETF·수급이탈·공시악재) 적용.",
  ].join("\n");
}
