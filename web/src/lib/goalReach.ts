/**
 * 모아가기 4번 '목표에서 거꾸로' — 지금 계획으로 언제 닿나, 더 나은 선택지(넣는 돈 매년 늘리기·지금 더 넣기)로 몇 년 당겨지나.
 * 과거 이력은 15년까지라 그보다 긴 길은 "과거 적립 결과의 연평균(보통·운 나쁨)"으로 늘려 본 추정이다 — 화면에 그렇게 밝힌다.
 * 수익률은 고를 수 없지만 넣는 돈은 고를 수 있다는 점을 보여 주는 것이 목적(2026-10-19 사용자 요청).
 */

/** 매달 1씩 n개월 넣어 끝에 넣은 돈의 ratio배가 됐다면, 그에 맞는 연 수익률 */
export function impliedAnnualRate(ratio: number, months: number): number | null {
  if (!(ratio > 0) || months <= 0) return null
  const fv = (r: number) => {
    const m = Math.pow(1 + r, 1 / 12) - 1
    let v = 0
    for (let i = 0; i < months; i += 1) v = (v + 1) * (1 + m)
    return v / months
  }
  let lo = -0.5
  let hi = 1
  if (fv(lo) > ratio || fv(hi) < ratio) return null
  for (let k = 0; k < 80; k += 1) {
    const mid = (lo + hi) / 2
    if (fv(mid) < ratio) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

export type PathInput = {
  /** 지금 매달 넣는 돈 */
  monthly: number
  /** 연 수익률 (0.06 = 6%) */
  rate: number
  /** 넣는 돈을 해마다 늘리는 비율 (0.05 = 5%) */
  raisePct?: number
  /** 이미 가진 돈 */
  lump?: number
}

/**
 * months개월 뒤 평가금 — 매달 말에 넣고(서버 src/services/goalTracker.ts planValueAt·monthsToReach와 같은 규칙),
 * 12개월마다 넣는 돈을 raisePct만큼 늘린다. 목표 트래커의 예상 도달과 같은 달이 나와야 한다.
 */
export function projectValue(input: PathInput, months: number): number {
  const m = Math.pow(1 + input.rate, 1 / 12) - 1
  let v = Math.max(0, input.lump ?? 0)
  let c = input.monthly
  for (let i = 0; i < months; i += 1) {
    if (i > 0 && i % 12 === 0) c *= 1 + (input.raisePct ?? 0)
    v = v * (1 + m) + c
  }
  return v
}

/** 목표에 처음 닿는 개월 (maxMonths 안에 못 닿으면 null) — 서버 monthsToReach와 같은 식 */
export function monthsToTarget(input: PathInput, target: number, maxMonths = 600): number | null {
  if (!(target > 0)) return null
  const m = Math.pow(1 + input.rate, 1 / 12) - 1
  let v = Math.max(0, input.lump ?? 0)
  if (v >= target) return 0
  let c = input.monthly
  for (let i = 0; i < maxMonths; i += 1) {
    if (i > 0 && i % 12 === 0) c *= 1 + (input.raisePct ?? 0)
    v = v * (1 + m) + c
    if (v >= target) return i + 1
  }
  return null
}

/** n년 뒤 매달 넣는 돈 (해마다 raisePct씩) */
export function monthlyAfterYears(monthly: number, raisePct: number, years: number): number {
  return monthly * Math.pow(1 + raisePct, years)
}

/** 목표 이하 중간 목표 — 1억·3억·5억·10억·20억 중 목표보다 작은 것 + 목표 */
export function milestoneTargets(target: number): number[] {
  const steps = [100_000_000, 300_000_000, 500_000_000, 1_000_000_000, 2_000_000_000].filter((s) => s < target)
  return [...steps.slice(-3), target]
}

/** 개월 → "6년", "6년 4개월", "8개월" */
export function formatMonths(months: number): string {
  const y = Math.floor(months / 12)
  const m = months % 12
  if (y === 0) return `${m}개월`
  return m ? `${y}년 ${m}개월` : `${y}년`
}

/** 올해 기준 개월 뒤 연도 (KST 오늘 YYYY-MM-DD) */
export function yearAfterMonths(today: string, months: number): number {
  const y = Number(today.slice(0, 4))
  const m = Number(today.slice(5, 7)) - 1 + months
  return y + Math.floor(m / 12)
}
