/**
 * 관제 — 사용자 비교 탭 (관리자 전용).
 * 시드·투자 성향·전략 방식·매도 시간대별로 가상 매매 성과를 묶어 보여 준다.
 * 표본이 적은 차이는 "참고 불가"로 표시해 전략에 바로 반영하지 않게 한다.
 */
import { formatKrwMan } from '../../lib/format'
import React, { useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api'
import Skeleton from '../../components/Skeleton'

type GroupStats = {
  label: string
  users: number
  sells: number
  winRatePct: number | null
  avgReturnPct: number | null
  stdErrPct: number | null
  reliable: boolean
  vsOverallPct: number | null
}

type UserRow = {
  chatId: number
  seedCapital: number
  riskProfile: string | null
  strategyMode: string | null
  sells: number
  winRatePct: number | null
  totalPnl: number
  returnOnSeedPct: number | null
}

type Report = {
  windowDays: number
  overall: GroupStats
  users: UserRow[]
  bySeed: GroupStats[]
  byRiskProfile: GroupStats[]
  byStrategyMode: GroupStats[]
  bySellHour: GroupStats[]
  caveats: string[]
}

const pct = (v: number | null, digits = 2, sign = false) =>
  v === null ? '—' : `${sign && v > 0 ? '+' : ''}${v.toFixed(digits)}%`
const man = (v: number) => (v > 0 ? formatKrwMan(v) : '미설정')
const color = (v: number | null) => (v === null || v === 0 ? undefined : v > 0 ? 'var(--color-stock-up)' : 'var(--color-stock-down)')
const maskId = (id: number) => `…${String(id).slice(-4)}`

const cell: React.CSSProperties = { padding: '6px 8px' }
const head: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', whiteSpace: 'nowrap' }

function GroupTable({ title, rows }: { title: string; rows: GroupStats[] }) {
  return (
    <div className="card" style={{ padding: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
      <div className="title-md" style={{ marginBottom: 'var(--space-2)' }}>{title}</div>
      {rows.length === 0 ? (
        <div className="muted">집계할 매도 기록이 없습니다.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="w-full text-sm">
            <thead>
              <tr>
                {['구분', '사용자', '매도 건수', '승률', '건당 평균 수익률', '오차(±)', '전체 대비', '판단'].map((h) => (
                  <th key={h} style={head}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <td style={{ ...cell, fontWeight: 600, whiteSpace: 'nowrap' }}>{r.label}</td>
                  <td style={cell}>{r.users}</td>
                  <td style={cell}>{r.sells}</td>
                  <td style={cell}>{pct(r.winRatePct, 0)}</td>
                  <td style={{ ...cell, color: color(r.avgReturnPct) }}>{pct(r.avgReturnPct, 2, true)}</td>
                  <td style={cell}>{r.stdErrPct === null ? '—' : `±${r.stdErrPct.toFixed(2)}`}</td>
                  <td style={{ ...cell, color: color(r.vsOverallPct) }}>
                    {r.vsOverallPct === null ? '—' : `${r.vsOverallPct > 0 ? '+' : ''}${r.vsOverallPct.toFixed(2)}%p`}
                  </td>
                  <td style={{ ...cell, whiteSpace: 'nowrap', color: r.reliable ? 'var(--color-brand)' : 'var(--color-text-tertiary)' }}>
                    {r.reliable ? '참고 가능' : '참고 불가(표본·오차)'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

export default function CohortPanel() {
  const [days, setDays] = useState(120)
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    apiFetch(`/api/ui/cohort-analysis?windowDays=${days}`, { cacheMs: 0, timeoutMs: 30_000 })
      .then((res: any) => {
        if (cancelled) return
        if (res?.data) setReport(res.data as Report)
        else setError(res?.error || '데이터를 불러오지 못했습니다.')
      })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [days])

  return (
    <div>
      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap', marginBottom: 'var(--space-3)' }}>
        <span className="muted">기간</span>
        {[30, 60, 120, 365].map((d) => (
          <button key={d} type="button" className={`tag${days === d ? ' active' : ''}`} onClick={() => setDays(d)}>
            최근 {d}일
          </button>
        ))}
      </div>

      {loading && <Skeleton lines={6} height={16} />}
      {!loading && error && <div className="card" style={{ color: 'var(--color-error)', padding: 'var(--space-3)' }}>{error}</div>}

      {!loading && report && (
        <>
          <div className="card" style={{ padding: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
            <div className="title-md">전체</div>
            <div className="muted" style={{ marginTop: 4 }}>
              최근 {report.windowDays}일 · 사용자 {report.overall.users}명 · 매도 {report.overall.sells}건 ·
              승률 {pct(report.overall.winRatePct, 0)} · 건당 평균 {pct(report.overall.avgReturnPct, 2, true)}
            </div>
            <ul className="muted" style={{ marginTop: 8, paddingLeft: 18, fontSize: 12, lineHeight: 1.6 }}>
              {report.caveats.map((c) => <li key={c}>{c}</li>)}
            </ul>
          </div>

          <GroupTable title="시드 규모별" rows={report.bySeed} />
          <GroupTable title="투자 성향별" rows={report.byRiskProfile} />
          <GroupTable title="전략 방식별" rows={report.byStrategyMode} />
          <GroupTable title="매도 체결 시간대별 (한국시간)" rows={report.bySellHour} />

          <div className="card" style={{ padding: 'var(--space-3)' }}>
            <div className="title-md" style={{ marginBottom: 'var(--space-2)' }}>사용자별</div>
            {report.users.length === 0 ? (
              <div className="muted">집계할 매도 기록이 없습니다.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      {['사용자', '시드', '성향', '방식', '매도', '승률', '실현손익', '시드 대비'].map((h) => (
                        <th key={h} style={head}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.users.map((u) => (
                      <tr key={u.chatId}>
                        <td style={cell}>{maskId(u.chatId)}</td>
                        <td style={cell}>{man(u.seedCapital)}</td>
                        <td style={cell}>{u.riskProfile ?? '—'}</td>
                        <td style={cell}>{u.strategyMode ?? '—'}</td>
                        <td style={cell}>{u.sells}</td>
                        <td style={cell}>{pct(u.winRatePct, 0)}</td>
                        <td style={{ ...cell, color: color(u.totalPnl) }}>{Math.round(u.totalPnl).toLocaleString('ko-KR')}원</td>
                        <td style={{ ...cell, color: color(u.returnOnSeedPct) }}>{pct(u.returnOnSeedPct, 2, true)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
