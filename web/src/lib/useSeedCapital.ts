import { useEffect, useState } from 'react'
import { apiFetch } from './api'
import { useCurrentChatId } from '../stores/profileStore'

/**
 * 내 가상 계좌 시드와 조회 완료 여부. `loaded`는 조회가 끝났거나(성공·실패·설정 없음) 계정이 없어 조회할 게 없을 때 true.
 * 시드로 수량을 계산하는 자동 동작은 `loaded`를 기다려야 기본값(1천만원)으로 먼저 계산되지 않는다.
 */
export function useSeedCapitalState(): { seed: number | null; loaded: boolean } {
  const chatId = useCurrentChatId()
  // 값과 완료 여부를 한 번에 바꾼다(따로 바꾸면 '완료인데 값은 아직'인 렌더가 생긴다)
  const [state, setState] = useState<{ seed: number | null; loadedFor: string | null }>({ seed: null, loadedFor: null })
  useEffect(() => {
    if (!chatId) return
    let alive = true
    apiFetch('/api/ui/investment-prefs', { cacheMs: 30_000, timeoutMs: 10_000 })
      .then((res) => {
        const v = Number(res?.data?.virtual_seed_capital ?? res?.data?.capital_krw)
        return Number.isFinite(v) && v > 0 ? v : null
      })
      .catch(() => null)
      .then((v) => {
        if (alive) setState((prev) => ({ seed: v ?? prev.seed, loadedFor: chatId }))
      })
    return () => {
      alive = false
    }
  }, [chatId])
  return { seed: state.seed, loaded: !chatId || state.loadedFor === chatId }
}

/**
 * 내 가상 계좌 시드(설정 > 시드 자본금). 집행우선·시뮬레이터가 투자금 기본값으로 쓴다.
 * 예전엔 두 화면 다 1천만원으로 고정이라 시드를 100만원으로 바꿔도 계획이 1천만원 기준으로 잡혔다.
 * 아직 못 불러왔거나 설정이 없으면 null.
 */
export function useSeedCapital(): number | null {
  return useSeedCapitalState().seed
}
