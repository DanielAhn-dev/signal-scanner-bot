/**
 * 하락 때 할 일을 하락 전에 미리 정해 두는 계획(사전 서약).
 * 시스템이 판단을 대신하지 않는다 — 사용자가 차분할 때 적은 문장을, 하락이 왔을 때 다시 보여주기만 한다.
 */

/** short: 홈 하락 카드처럼 한 줄에 몰아 보여줄 때 쓰는 짧은 말 */
export const DROP_COMMITMENTS: Array<{ id: string; text: string; short: string }> = [
  { id: 'keep-dca', text: '하락 중에도 정한 금액의 적립을 멈추지 않는다', short: '적립 계속' },
  { id: 'rebalance-only', text: '정해 둔 비중으로 되돌리는 것 말고는, 그때 새로 판단하지 않는다', short: '비중 되돌리기 말고는 새 판단 안 함' },
  { id: 'check-weekly', text: '계좌와 시세 확인을 일주일에 한 번으로 줄인다', short: '확인은 일주일에 한 번' },
  { id: 'wait-a-day', text: '팔고 싶어지면 먼저 이 계획을 다시 읽고, 하루가 지난 뒤에 결정한다', short: '팔기 전 하루 기다림' },
]

export type DropPlan = {
  /** 저장한 날짜 YYYY-MM-DD */
  savedAt: string
  /** 이만큼 잃으면 팔고 싶어질 것 같다고 정한 선(%) */
  tolerancePct: number
  commitments: string[]
  /** 팔고 싶어지면 먼저 내가 할 일(직접 적은 문장) */
  ifTempted: string
}

const MAX_TEXT = 200
const KNOWN = new Set(DROP_COMMITMENTS.map((c) => c.id))

export function sanitizeDropPlan(raw: unknown): DropPlan | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const savedAt = typeof r.savedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.savedAt) ? r.savedAt : ''
  const tolerance = Number(r.tolerancePct)
  if (!savedAt || !Number.isFinite(tolerance) || tolerance <= 0 || tolerance > 100) return null
  const commitments = Array.isArray(r.commitments) ? [...new Set(r.commitments.filter((c): c is string => typeof c === 'string' && KNOWN.has(c)))] : []
  const ifTempted = typeof r.ifTempted === 'string' ? r.ifTempted.trim().slice(0, MAX_TEXT) : ''
  if (!commitments.length && !ifTempted) return null
  return { savedAt, tolerancePct: Math.round(tolerance), commitments, ifTempted }
}

/** 하락이 왔을 때 보여줄 문장들 */
export function dropPlanLines(plan: DropPlan): string[] {
  const lines = DROP_COMMITMENTS.filter((c) => plan.commitments.includes(c.id)).map((c) => c.text)
  if (plan.ifTempted) lines.push(`팔고 싶어지면 먼저: ${plan.ifTempted}`)
  return lines
}

/** 한 줄 요약 — 고른 항목의 짧은 말을 잇고, 직접 적은 문장은 길어서 '전체 보기'로 미룬다 */
export function dropPlanSummary(plan: DropPlan): string {
  const parts = DROP_COMMITMENTS.filter((c) => plan.commitments.includes(c.id)).map((c) => c.short)
  if (plan.ifTempted) parts.push('직접 적은 할 일 1개')
  return parts.join(' · ')
}

/**
 * 매도 창에서 계획을 보여줄지 — 손실 난 매도만. 수익 구간 매도는 계획이 권하는 리밸런싱일 수 있어 잔소리하지 않는다.
 * 가격·평균단가를 모르면 보여주지 않는다(틀린 경고보다 침묵).
 */
export function shouldRemindOnSell(sellPrice: number, avgPrice: number): boolean {
  return Number.isFinite(sellPrice) && Number.isFinite(avgPrice) && sellPrice > 0 && avgPrice > 0 && sellPrice < avgPrice
}

export function todayKst(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10)
}
