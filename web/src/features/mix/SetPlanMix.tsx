import { useRef, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { normalize, type Weights } from '../../lib/mix'
import { MIX_INDEX_LABEL, mixLabel, type MixEntry, type MixIndex } from '../../lib/planMix'
import { PLAN_CHANGED_EVENT } from '../month-task/RaiseNudge'

const PLAN_INDEXES = Object.keys(MIX_INDEX_LABEL) as MixIndex[]

/**
 * 섞어보기 비중 → 내 계획 구성(plan.mix) — 화면 지도 6단계.
 * 구성은 코스피200·S&P500·나스닥100만 담는다(채권·금은 실험용으로 남긴다, docs/plan-screen-map-2026-10-19.md 3절).
 * 지수마다 이미 고른 상품·계좌는 그대로 둔다 — 저장 직전에 지금 구성을 다시 읽어 합친다.
 */
export function planMixFromWeights(weights: Weights, keepFrom: MixEntry[] = []): MixEntry[] | null {
  const w = normalize(weights)
  const ids = Object.keys(w)
  if (ids.length === 0 || ids.some((id) => !PLAN_INDEXES.includes(id as MixIndex))) return null
  // 서버는 합 1(1%p 오차까지)을 받는다 — 0.0001 단위로 맞추고 마지막 줄이 나머지를 받는다
  let rest = 1
  return PLAN_INDEXES.filter((i) => w[i] > 0).map((index, k, arr) => {
    const weight = k === arr.length - 1 ? Math.round(rest * 10_000) / 10_000 : Math.round(w[index] * 10_000) / 10_000
    rest -= weight
    const prev = keepFrom.find((e) => e.index === index)
    return { index, weight, product: prev?.product ?? null, account: prev?.account ?? null }
  })
}

export default function SetPlanMix({ weights }: { weights: Weights }) {
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const preview = planMixFromWeights(weights)

  if (Object.keys(normalize(weights)).length === 0) return null
  if (!preview) {
    return <p className="acc-note">채권·금이 섞인 비중은 내 계획 구성으로 정할 수 없어요. 내 계획 구성에는 코스피200·S&P500·나스닥100만 담습니다. 이 화면은 실험용으로 보세요.</p>
  }

  const save = async () => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setMsg(null)
    try {
      // 지금 구성의 상품·계좌를 잃지 않게 다시 읽어 합친다. 읽기 실패를 "구성 없음"으로 보지 않는다
      const cur = await apiFetch('/api/ui/investment-prefs', { cacheMs: 0, timeoutMs: 15_000, retries: 1 })
      if (!cur?.data?.plan) throw new Error('내 계획을 읽지 못했습니다')
      const keep = Array.isArray(cur.data.plan.mix) ? (cur.data.plan.mix as MixEntry[]) : []
      const mix = planMixFromWeights(weights, keep)!
      const res = await apiFetch('/api/ui/investment-prefs', { method: 'POST', cacheMs: 0, timeoutMs: 15_000, body: JSON.stringify({ plan: { mix } }) })
      if (res?.error) throw new Error(String(res.error))
      window.dispatchEvent(new Event(PLAN_CHANGED_EVENT))
      setMsg(`내 계획 구성을 '${mixLabel(mix)}'(으)로 정했어요. 지수마다 살 상품은 모아가기 1번에서, 이번 달 살 주수는 홈 '이번 달 할 일'에서 볼 수 있어요.`)
    } catch (e) {
      setMsg(`정하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  return (
    <div className="acc-plan-save">
      <button type="button" className="acc-primary" disabled={busy} onClick={() => void save()}>{busy ? '정하는 중…' : `이 비중을 내 계획 구성으로 정하기 (${mixLabel(preview)})`}</button>
      <p className="acc-note">과거에 좋았던 비중을 고르기 쉽습니다. 위 결과보다 아래 &lsquo;하락이 왔다고 가정해보기&rsquo;에서 버틸 수 있는지를 먼저 보세요. 가상 계좌는 아직 코스피200만 삽니다.</p>
      {msg && <p className="acc-note" role="status">{msg}</p>}
    </div>
  )
}
