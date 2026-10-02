import { apiFetch } from './api'
import { readUserState, writeUserState } from './userState'

/** 자동매매 방식을 바꾼 기록 — 내 선택 돌아보기(/choices)가 "안 바꿨다면"을 계산하는 출발점. src/services/choiceReview.ts SwitchEvent와 같은 모양 */
export type SwitchEvent = {
  id: string
  date: string
  from: string
  to: string
  value: number
  cash: number
  holdings: Array<{ code: string; qty: number }>
}

const MAX_EVENTS = 6
const MAX_HOLDINGS = 12
const todayKst = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })

export function readSwitchHistory(): SwitchEvent[] {
  const saved = readUserState<SwitchEvent[]>('switchHistory')
  return Array.isArray(saved) ? saved : []
}

/**
 * 방식을 바꾸기 직전의 가상 계좌 보유를 기록한다. 기록에 실패해도 방식 변경은 막지 않는다.
 * 같은 날 여러 번 바꿨다면 그날의 첫 기록(진짜 "바꾸기 전" 상태)만 남긴다.
 */
export async function recordSwitch(from: string, to: string): Promise<void> {
  try {
    const date = todayKst()
    const history = readSwitchHistory()
    if (history.some((e) => e.date === date)) return

    const params = new URLSearchParams({ page: '1', pageSize: '50', includeLots: '0', positionType: 'holding' })
    const [posRes, prefsRes] = await Promise.all([
      apiFetch(`/api/ui/positions?${params}`, { cacheMs: 0, retries: 0, timeoutMs: 15_000 }),
      apiFetch('/api/ui/investment-prefs', { cacheMs: 0, retries: 0 }),
    ])
    const rows: any[] = (Array.isArray(posRes?.data) ? (posRes.data as any[]) : []).filter((r: any) => r?.account_kind === 'virtual')
    const holdings = rows
      .map((r) => ({ code: String(r.code ?? ''), qty: Math.floor(Number(r.quantity) || 0), value: (Number(r.quantity) || 0) * (Number(r.current_price) || 0) }))
      .filter((h) => h.code && h.qty > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, MAX_HOLDINGS)
    const cash = Math.max(0, Number(prefsRes?.data?.virtual_cash) || 0)
    const value = Math.round(holdings.reduce((a, h) => a + h.value, 0) + cash)
    if (!(value > 0)) return

    const event: SwitchEvent = { id: `${date}-${to}`, date, from, to, value, cash: Math.round(cash), holdings: holdings.map(({ code, qty }) => ({ code, qty })) }
    writeUserState('switchHistory', [...history, event].slice(-MAX_EVENTS))
  } catch { /* 기록은 부가 기능 */ }
}
