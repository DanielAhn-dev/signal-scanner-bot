import type { Weights } from '../mix'

/**
 * 다른 화면 → 시뮬레이터로 지금 값을 채워 넘기기 (계획 5단계). 라우터 state로만 넘긴다 — 금액은 개인 정보에 가까워 URL에 싣지 않는다.
 * 넘긴 값은 이번 이동에만 쓰고 저장하지 않는다.
 */
export type SimPrefill = {
  /** 비교할 구성(앞에서부터 A·B·C, 최대 3개) */
  slots?: Array<{ label: string; weights: Weights }>
  /** 원 */
  monthly?: number
  lump?: number
  /** 해마다 매달 넣는 돈을 늘리는 비율(0.05 = 5%) */
  raisePct?: number
  /** 최근 n년 */
  years?: number
}

export const SIM_PATH = '/plan-sim'
const MAX_SLOTS = 3

export function simLinkState(p: SimPrefill): { simPrefill: SimPrefill } {
  return { simPrefill: p }
}

/** 내 계획 구성(지수·비중 0~1) → 시뮬레이터 비중(%) */
export function weightsFromPlan(mix: ReadonlyArray<{ index: string; weight: number }>): Weights {
  const out: Weights = {}
  for (const e of mix) if (e.weight > 0) out[e.index] = Math.round(e.weight * 1000) / 10
  return out
}

const money = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined)

/** location.state에서 꺼내며 모양을 검사한다 — 이상한 값은 버리고 나머지만 쓴다 */
export function readSimPrefill(state: unknown, knownAssets?: ReadonlySet<string>): SimPrefill | null {
  const raw = (state as { simPrefill?: unknown } | null)?.simPrefill
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const out: SimPrefill = {}
  if (Array.isArray(r.slots)) {
    const slots = r.slots
      .map((s) => {
        const w = (s as { weights?: unknown })?.weights
        if (!w || typeof w !== 'object') return null
        const weights: Weights = {}
        for (const [k, v] of Object.entries(w as Record<string, unknown>)) {
          if (typeof v === 'number' && Number.isFinite(v) && v > 0 && (!knownAssets || knownAssets.has(k))) weights[k] = v
        }
        if (!Object.keys(weights).length) return null
        const label = typeof (s as { label?: unknown }).label === 'string' ? String((s as { label: string }).label).slice(0, 40) : '넘겨받은 구성'
        return { label, weights }
      })
      .filter((s): s is { label: string; weights: Weights } => s != null)
      .slice(0, MAX_SLOTS)
    if (slots.length) out.slots = slots
  }
  const monthly = money(r.monthly)
  const lump = money(r.lump)
  if (monthly != null) out.monthly = monthly
  if (lump != null) out.lump = lump
  if (typeof r.raisePct === 'number' && r.raisePct >= 0 && r.raisePct <= 0.5) out.raisePct = r.raisePct
  if (typeof r.years === 'number' && Number.isInteger(r.years) && r.years >= 1 && r.years <= 40) out.years = r.years
  return Object.keys(out).length ? out : null
}
