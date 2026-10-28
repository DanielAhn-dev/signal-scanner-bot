/**
 * 보유 ETF 다음 분배 일정 — 홈 한 줄과 시장 캘린더 표가 같은 데이터·같은 문구를 쓴다.
 * 서버(/api/ui/income-guide?schedule=1)가 저장된 분배 이력에서 추정한 값이라 확정 공시가 아니다(estimated).
 */
import { useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { useCurrentChatId } from '../../stores/profileStore'

export type DistributionScheduleItem = {
  code: string
  name: string
  quantity: number
  recordDate: string
  exDate: string
  lastBuyDate: string
  payDate: string | null
  intervalMonths: 1 | 3 | 6 | 12
  estimated: boolean
}

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']

/** 2026-10-30 → "10/30(금)" */
export function fmtScheduleDate(key: string | null): string {
  if (!key) return '—'
  const [y, m, d] = key.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return '—'
  return `${m}/${d}(${WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`
}

/** 오늘 기준 며칠 남았는지 — 0이면 오늘이 마지막 매수일 */
export function daysUntil(todayKey: string, key: string): number {
  return Math.round((Date.parse(key.slice(0, 10)) - Date.parse(todayKey.slice(0, 10))) / 86_400_000)
}

export function intervalLabel(m: DistributionScheduleItem['intervalMonths']): string {
  return m === 1 ? '월분배' : m === 3 ? '분기분배' : m === 6 ? '반기분배' : '연분배'
}

export function useDistributionSchedule(): { today: string; items: DistributionScheduleItem[] } | null {
  const chatId = useCurrentChatId()
  const [data, setData] = useState<{ today: string; items: DistributionScheduleItem[] } | null>(null)
  useEffect(() => {
    if (!chatId) return
    let alive = true
    apiFetch('/api/ui/income-guide?schedule=1', { cacheMs: 300_000, timeoutMs: 15_000, retries: 0 })
      .then((res) => {
        if (alive && res?.ok && res.data && Array.isArray(res.data.items)) setData(res.data)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [chatId])
  return data
}

/** 시장 캘린더용 표 — 보유 종목별 기준일·분배락·마지막 매수일·지급일 */
export function DistributionScheduleTable() {
  const data = useDistributionSchedule()
  if (!data || data.items.length === 0) return null
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontWeight: 700, fontSize: 12, padding: '6px 8px' }}>내 ETF 분배 일정</div>
      <table className="xls-table" style={{ width: '100%' }}>
        <thead>
          <tr className="xls-header-row">
            <th>종목</th>
            <th>분배 받으려면 이 날까지 보유</th>
            <th>분배락일</th>
            <th>지급일</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((it) => {
            const left = daysUntil(data.today, it.lastBuyDate)
            return (
              <tr key={it.code} className="xls-row">
                <td className="xls-cell" style={{ whiteSpace: 'normal' }}>
                  {it.name} <span style={{ color: 'var(--color-text-tertiary)', fontSize: 10 }}>{intervalLabel(it.intervalMonths)}</span>
                </td>
                <td className="xls-cell">
                  {fmtScheduleDate(it.lastBuyDate)} 매수까지 <span style={{ color: 'var(--color-text-tertiary)', fontSize: 10 }}>({left === 0 ? '오늘' : `${left}일 뒤`})</span>
                </td>
                <td className="xls-cell">{fmtScheduleDate(it.exDate)}</td>
                <td className="xls-cell">{it.payDate ? fmtScheduleDate(it.payDate) : '미확인'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', padding: '4px 8px', whiteSpace: 'normal', lineHeight: 1.5 }}>
        지난 분배 날짜 규칙으로 추정한 값이며 운용사 공시로 바뀔 수 있어요. 분배락일엔 분배금만큼 가격이 내려가서 시작하므로, 분배를 받으려고 사는 것이 이득이라는 뜻은 아닙니다.
      </div>
    </div>
  )
}
