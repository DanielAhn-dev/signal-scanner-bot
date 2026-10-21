import { useCallback, useEffect, useState } from 'react'
import { apiFetch, invalidateCache } from '../../../lib/api'
import { useCurrentChatId } from '../../../stores/profileStore'
import type { AccountCashRow } from '../../../../../src/lib/accountCash'

/**
 * 계좌별 예수금 — 값은 리밸런싱 가이드 파일(settings.cashByAccount)에 있고 여기서 보고 고친다(src/lib/accountCash.ts).
 * 키는 가이드 형식 "증권사|계좌"(guideCashKey). 매수·매도·분배금 기록이 자동으로 더하고 빼므로 보유를 다시 불러올 때 같이 새로 받는다.
 */
export function useAccountCash(reloadToken: unknown) {
  const chatId = useCurrentChatId()
  const [byKey, setByKey] = useState<Record<string, AccountCashRow>>({})
  const [loaded, setLoaded] = useState(false)

  const apply = (rows: AccountCashRow[] | undefined) => {
    setByKey(Object.fromEntries((rows ?? []).map((r) => [r.key, r])))
    setLoaded(true)
  }

  useEffect(() => {
    if (!chatId) return
    let active = true
    apiFetch('/api/ui/income-guide?cash=1', { cacheMs: 0, retries: 1 })
      .then((res) => { if (active) apply(res?.data?.accounts) })
      .catch(() => { /* 못 받으면 예수금 칸만 비운다(보유 화면은 그대로) */ })
    return () => { active = false }
  }, [chatId, reloadToken])

  /** 실제 잔액으로 맞춘다. 저장이 확인된 뒤에만 화면 값을 바꾼다 */
  const save = useCallback(async (key: string, amount: number): Promise<string | null> => {
    try {
      const res = await apiFetch('/api/ui/income-guide', {
        method: 'POST', cacheMs: 0, retries: 0, timeoutMs: 15_000,
        body: JSON.stringify({ action: 'cash-set', accountKey: key, amount }),
      })
      apply(res?.data?.accounts)
      invalidateCache('/api/ui/income-guide')
      return null
    } catch (e) {
      return e instanceof Error ? e.message : '저장하지 못했습니다.'
    }
  }, [])

  return { cashByKey: byKey, cashLoaded: loaded, saveCash: save }
}
