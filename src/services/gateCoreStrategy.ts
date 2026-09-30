/**
 * 실적 관문 코어 전략 — 전략 경쟁 측정(전향검증)과 봇 실행이 같은 규칙을 쓰도록 순수 함수로 둔다.
 *
 *   - 매달 첫 거래일에 교체: 점수 순서대로 실적 관문(fundamentalQualityGate) 통과 종목 중 상위 20개
 *   - 한 칸 예산(평가액의 90% ÷ 20)으로 1주도 못 사는 종목은 건너뛴다 (소액 시드에서도 실행 가능)
 *   - 코스피 50일선 아래면 새로 사지 않는다. 목록에서 빠진 종목은 판다. 빈 칸은 현금(→ 스윕)
 *   - 교체일 사이에는 손절·익절 없이 보유한다 (측정한 그대로)
 *
 * 근거와 한계 (2026-09-30 자기상관 보정·기간 분할 재검증, 2018-04~2026-06 월 100개):
 *   - 거래대금 10억+ 전 종목: 통과가 평균 대비 월 +0.42%(Newey-West t=4.9, 전반 +0.24·후반 +0.60, 부트스트랩 95% [+0.26,+0.60])
 *     → 효과의 실체는 "적자·이익 감소 종목 회피"(제외 쪽 월 -0.36%)이고 겹침·자기상관 때문에 부풀려진 값은 아니다.
 *   - 시총 상위 300: 통과 월 +0.09%(NW t=1.0, 부트스트랩 구간이 0을 포함) → 대형주에서는 유의하지 않다.
 *   봇 후보는 대형주 쪽이므로 "지수를 이기는 근거"가 아니라 "손실 종목을 피하는 저비용 관문"으로만 본다.
 *   (이전 주석의 "월 +0.66%(t=4.7)"은 유동성 종목 전체 기준이라 봇 후보에 그대로 적용할 수 없다.)
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
