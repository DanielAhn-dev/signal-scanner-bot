import { useEffect, useRef, useState } from 'react'
import AccountTag from '../../components/ui/AccountTag'
import { apiFetch } from '../../lib/api'
import { formatKrwMan } from '../../lib/format'
import { EMPTY_STATE, type AccumulateState } from '../../lib/accumulate'
import { useUserState } from '../../lib/userState'
import { kstToday } from '../../lib/monthTask'
import { useCurrentChatId } from '../../stores/profileStore'
import './month-task.css'

/** 내 계획 금액이 바뀌면 홈 '이번 달 할 일'이 다시 읽는다 */
export const PLAN_CHANGED_EVENT = 'nexora:plan-changed'

/** 1월이고, 늘리기를 작년 이전에 정했고, 올해 아직 답하지 않았을 때만 */
export function raiseDue(raise: AccumulateState['raise'], today: string): boolean {
  if (!raise || !(raise.pct > 0)) return false
  const year = Number(today.slice(0, 4))
  return today.slice(5, 7) === '01' && raise.since < `${year}-01` && raise.appliedYear !== year
}

/**
 * 홈 — 모아가기 4번에서 '넣는 돈 해마다 늘리기'를 정했으면 해마다 1월에 한 번 알린다.
 * 증권사 자동이체는 앱이 바꿀 수 없으므로, 내 계획 금액만 바꾸고 이체 금액은 사용자가 직접 바꾼다고 적는다.
 */
export default function RaiseNudge() {
  const chatId = useCurrentChatId()
  const { value: accRaw, set: setAcc } = useUserState<AccumulateState>('accumulate')
  const acc: AccumulateState = { ...EMPTY_STATE, ...(accRaw ?? {}) }
  const [monthly, setMonthly] = useState<number | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const busyRef = useRef(false)
  const today = kstToday()
  const due = raiseDue(acc.raise, today)

  useEffect(() => {
    if (!chatId || !due) return
    let active = true
    apiFetch('/api/ui/investment-prefs', { cacheMs: 60_000, retries: 1 })
      .then((res) => { if (active) setMonthly(Number(res?.data?.plan?.monthly) || 0) })
      .catch(() => { /* 못 읽으면 알리지 않는다 */ })
    return () => { active = false }
  }, [chatId, due])

  if (!due || !acc.raise || !monthly) return null
  const year = Number(today.slice(0, 4))
  const next = Math.round((monthly * (1 + acc.raise.pct)) / 10_000) * 10_000
  const answer = () => setAcc({ ...acc, raise: { ...acc.raise!, appliedYear: year } })

  const apply = async () => {
    if (busyRef.current) return
    busyRef.current = true
    setMsg(null)
    try {
      const res = await apiFetch('/api/ui/investment-prefs', { method: 'POST', cacheMs: 0, timeoutMs: 15_000, body: JSON.stringify({ plan: { monthly: next } }) })
      if (res?.error) throw new Error(String(res.error))
      answer()
      window.dispatchEvent(new Event(PLAN_CHANGED_EVENT))
    } catch (e) {
      setMsg(`바꾸지 못했습니다: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      busyRef.current = false
    }
  }

  return (
    <section className="mt" aria-label="넣는 돈 늘리기">
      <div className="mt__head"><AccountTag kind="real" /><strong>올해는 넣는 돈을 {Math.round(acc.raise.pct * 100)}% 늘리기로 했어요</strong></div>
      <p className="mt__main">매달 {formatKrwMan(monthly)} → <strong>{formatKrwMan(next)}</strong></p>
      <p className="mt__muted">내 계획 금액을 바꾸면 할 일과 가상 계좌 입금이 새 금액을 따릅니다. 증권사 자동이체 금액은 직접 바꿔 주세요.</p>
      <div className="mt__actions">
        <button type="button" className="mt__primary" onClick={() => void apply()}>{formatKrwMan(next)}으로 바꾸기</button>
        <button type="button" className="mt__secondary" onClick={answer}>올해는 그대로</button>
      </div>
      {msg && <p className="mt__error" role="alert">{msg}</p>}
    </section>
  )
}
