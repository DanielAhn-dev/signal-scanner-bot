/**
 * 하락 때 할 일을 하락 전에 미리 정해 두는 계획(사전 서약).
 * 시스템이 판단을 대신하지 않는다 — 사용자가 차분할 때 적은 문장을, 하락이 왔을 때 다시 보여주기만 한다.
 */

export const DROP_COMMITMENTS: Array<{ id: string; text: string }> = [
  { id: 'keep-dca', text: '하락 중에도 정한 금액의 적립을 멈추지 않는다' },
  { id: 'rebalance-only', text: '정해 둔 비중으로 되돌리는 것 말고는, 그때 새로 판단하지 않는다' },
  { id: 'check-weekly', text: '계좌와 시세 확인을 일주일에 한 번으로 줄인다' },
  { id: 'wait-a-day', text: '팔고 싶어지면 먼저 이 계획을 다시 읽고, 하루가 지난 뒤에 결정한다' },
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

export function todayKst(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10)
}
