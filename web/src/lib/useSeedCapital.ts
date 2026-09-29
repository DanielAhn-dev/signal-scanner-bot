import { useEffect, useState } from 'react'
import { apiFetch } from './api'
import { useCurrentChatId } from '../stores/profileStore'

/**
 * 내 가상 계좌 시드(설정 > 시드 자본금). 집행우선·시뮬레이터가 투자금 기본값으로 쓴다.
 * 예전엔 두 화면 다 1천만원으로 고정이라 시드를 100만원으로 바꿔도 계획이 1천만원 기준으로 잡혔다.
 * 아직 못 불러왔거나 설정이 없으면 null.
 */
export function useSeedCapital(): number | null {
  const chatId = useCurrentChatId()
  const [seed, setSeed] = useState<number | null>(null)
  useEffect(() => {
    if (!chatId) return
    let alive = true
    apiFetch('/api/ui/investment-prefs', { cacheMs: 30_000, timeoutMs: 10_000 })
      .then((res) => {
        const v = Number(res?.data?.virtual_seed_capital ?? res?.data?.capital_krw)
        if (alive && Number.isFinite(v) && v > 0) setSeed(v)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [chatId])
  return seed
}
