/**
 * 실적 관문 코어 전략 — 전략 경쟁 측정(전향검증)과 봇 실행이 같은 규칙을 쓰도록 순수 함수로 둔다.
 *
 *   - 매달 첫 거래일에 교체: 점수 순서대로 실적 관문(fundamentalQualityGate) 통과 종목 중 상위 20개
 *   - 한 칸 예산(평가액의 90% ÷ 20)으로 1주도 못 사는 종목은 건너뛴다 (소액 시드에서도 실행 가능)
 *   - 코스피 50일선 아래면 새로 사지 않는다. 목록에서 빠진 종목은 판다. 빈 칸은 현금(→ 스윕)
 *   - 교체일 사이에는 손절·익절 없이 보유한다 (측정한 그대로)
 *
 * 근거: 생존편향 없는 8년 검증에서 실적 관문 통과 종목이 평균 대비 월 +0.66%(t=4.7).
 * 이 전략은 봇에 구현돼 있지만 기본은 꺼져 있다. 전향검증 판정이 승격 후보로 내고
 * 관리자가 승인해야 켜진다 (strategyPromotion.ts).
 */

export const GATE_CORE_STRATEGY = "gate-top20" as const;
export const GATE_CORE_SLOTS = 20;
/** 교체 때 현금으로 남기는 비율 — 유휴현금 스윕의 고정 예약분(10%)과 같다 */
export const GATE_CORE_RESERVE_PCT = 10;

export function resolveGateCoreSlotBudget(equity: number, slots: number = GATE_CORE_SLOTS): number {
  if (!(equity > 0) || !(slots > 0)) return 0;
  return (equity * (1 - GATE_CORE_RESERVE_PCT / 100)) / slots;
}

/** 점수 순서대로 관문 통과 + 1주 이상 살 수 있는 종목을 slots개까지 */
export function selectGateCoreTargets(input: {
  rankedCodes: string[];
  gatePass: Set<string>;
  prices: Map<string, number>;
  slotBudget: number;
  slots?: number;
}): string[] {
  const slots = input.slots ?? GATE_CORE_SLOTS;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const code of input.rankedCodes) {
    if (out.length >= slots) break;
    if (seen.has(code)) continue;
    seen.add(code);
    const price = input.prices.get(code) ?? 0;
    if (!input.gatePass.has(code) || !(price > 0) || price > input.slotBudget) continue;
    out.push(code);
  }
  return out;
}

/** 교체일 매매 계획: 목록에서 빠진 보유 종목은 매도, 50일선 위일 때만 새 종목 매수 */
export function planGateCoreRebalance(input: {
  heldCodes: string[];
  targets: string[];
  trendUp: boolean;
  slots?: number;
}): { sell: string[]; keep: string[]; buy: string[] } {
  const slots = input.slots ?? GATE_CORE_SLOTS;
  const target = new Set(input.targets);
  const keep = input.heldCodes.filter((c) => target.has(c));
  const sell = input.heldCodes.filter((c) => !target.has(c));
  const room = Math.max(0, slots - keep.length);
  const buy = input.trendUp ? input.targets.filter((c) => !keep.includes(c)).slice(0, room) : [];
  return { sell, keep, buy };
}

/** 이번 달에 아직 교체하지 않았으면 교체일 */
export function isGateCoreRebalanceDue(todayKey: string, lastRebalanceMonth: string | null | undefined): boolean {
  return String(lastRebalanceMonth ?? "") !== todayKey.slice(0, 7);
}
