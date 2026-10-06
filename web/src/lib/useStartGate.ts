import { useEffect, useState } from 'react'
import { apiFetch } from './api'

export const START_DONE_EVENT = 'start-wizard:done'

/**
 * 시작하기(/start)를 마쳤는지 확인한다. 마법사가 생기기 전부터 쓰던 사용자도 같은 기준으로 본다:
 * 가상 계좌 시드가 있고, 성향 답이 저장돼 있거나 올해·작년 시드 만들기에 수입 기록이 있으면 "마친 것".
 * 조회가 실패하면 막지 않는다(네트워크 오류로 멀쩡한 사용자를 가두지 않도록 확실히 없을 때만 true).
 */
export function useNeedsStart(enabled: boolean, clientId: string | null | undefined): boolean {
  const [needsStart, setNeedsStart] = useState(false)

  useEffect(() => {
    if (!enabled || !clientId) { setNeedsStart(false); return }
    let cancelled = false
    ;(async () => {
      try {
        const prefs = await apiFetch('/api/ui/investment-prefs', { cacheMs: 0, retries: 0 })
        const hasSeed = Number(prefs?.data?.virtual_seed_capital) > 0
        if (!hasSeed) { if (!cancelled) setNeedsStart(true); return }
        // 마법사를 마치면 성향 답이 서버에 남는다 — 수입을 건너뛴 사람도 다시 끌려오지 않게 이것을 먼저 본다
        const state = await apiFetch('/api/ui/user-state', { cacheMs: 0, retries: 0 })
        if (state?.data?.investorProfile?.value) { if (!cancelled) setNeedsStart(false); return }
        // 마법사 이전 사용자: 시드 만들기 수입 기록으로 판단. 연도만 보면 1월 1일에 모두 다시 끌려오므로 작년까지 본다
        const year = Number(new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 4))
        const hasIncome = async (y: number) => {
          const months = await apiFetch(`/api/ui/seed-builder?year=${y}`, { cacheMs: 0, retries: 0 })
          const rows: Array<{ ownIncome?: number }> = Array.isArray(months?.data) ? months.data : []
          return rows.some((m) => Number(m.ownIncome) > 0)
        }
        const done = (await hasIncome(year)) || (await hasIncome(year - 1))
        if (!cancelled) setNeedsStart(!done)
      } catch {
        if (!cancelled) setNeedsStart(false)
      }
    })()
    const onDone = () => setNeedsStart(false)
    window.addEventListener(START_DONE_EVENT, onDone)
    return () => { cancelled = true; window.removeEventListener(START_DONE_EVENT, onDone) }
  }, [enabled, clientId])

  return needsStart
}
