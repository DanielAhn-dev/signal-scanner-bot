import React, { useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api'

type StrategyResult = {
  name: string
  label: string
  totalReturnPct: number
  maxDrawdownPct: number
  periods: number
}

type ForwardTestSnapshot = {
  startDate: string
  endDate: string
  generatedAt: string
  results: StrategyResult[]
  review?: { status: string; measuredDays: number; lines: string[] }
}

// 비교 기준 — 후보 전략이 현재 봇·KODEX 200·CD금리보다 모두 나아야 바꿀 이유가 있다
const BENCHMARKS = new Set(['kodex200-hold', 'cd-only', 'bot-account'])

const pct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`

/**
 * 전략 경쟁 측정(전향검증) — scripts/strategy_forward_test.ts 가 매일 저장한 최신 결과.
 * 봇 후보 전략을 KODEX 200 보유·CD금리와 같은 기간·같은 비용으로 비교한다.
 */
export default function ForwardTestPanel() {
  const [snap, setSnap] = useState<ForwardTestSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    apiFetch('/api/ui/forward-test', { cacheMs: 60_000 })
      .then((res: { data?: ForwardTestSnapshot | null }) => {
        if (alive) setSnap(res?.data ?? null)
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (alive) setLoaded(true)
      })
    return () => {
      alive = false
    }
  }, [])

  const box: React.CSSProperties = {
    border: '1px solid var(--color-border-default)',
    borderRadius: 6,
    padding: 12,
    marginBottom: 16,
    fontSize: 12,
  }

  if (!loaded) return <div style={box}>전략 비교 불러오는 중…</div>
  if (error) return <div style={box}>전략 비교를 불러오지 못했습니다: {error}</div>
  if (!snap || snap.results.length === 0) {
    return <div style={box}>전략 비교 결과가 아직 없습니다. 매일 배치(전향검증)가 돌면 채워집니다.</div>
  }

  const kodex = snap.results.find((r) => r.name === 'kodex200-hold')
  const cd = snap.results.find((r) => r.name === 'cd-only')
  const bot = snap.results.find((r) => r.name === 'bot-account')
  const verdict = (r: StrategyResult) => {
    if (BENCHMARKS.has(r.name)) return '기준'
    const parts: string[] = []
    if (bot) parts.push(r.totalReturnPct >= bot.totalReturnPct ? '봇 앞섬' : '봇 못 미침')
    if (kodex) parts.push(r.totalReturnPct >= kodex.totalReturnPct ? 'KODEX 200 앞섬' : 'KODEX 200 못 미침')
    if (cd) parts.push(r.totalReturnPct >= cd.totalReturnPct ? 'CD 앞섬' : 'CD 못 미침')
    return parts.join(' · ')
  }

  const th: React.CSSProperties = { textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--color-border-default)' }
  const td: React.CSSProperties = { padding: '4px 8px', borderBottom: '1px solid var(--color-border-subtle, var(--color-border-default))' }

  return (
    <div style={box}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>전략 비교 (전향검증)</div>
      <div style={{ color: 'var(--color-text-secondary)', marginBottom: 8, lineHeight: 1.5 }}>
        {snap.startDate} ~ {snap.endDate} · 매매비용 포함 · 측정 시작 뒤 실제로 지나간 기간만 씁니다.
        기간이 짧을수록 우연의 영향이 크니, 몇 달 쌓인 뒤 판단하세요.
      </div>
      {snap.review && (
        <div
          style={{
            marginBottom: 8,
            padding: '6px 8px',
            borderRadius: 4,
            lineHeight: 1.5,
            background:
              snap.review.status === 'propose' || snap.review.status === 'warn-bot'
                ? 'var(--color-warning-bg)'
                : 'var(--color-bg-sunken, rgba(0,0,0,0.03))',
          }}
        >
          <strong>승격·퇴출 판정</strong> (측정 {snap.review.measuredDays}거래일, 8주=40거래일부터 판정)
          {snap.review.lines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 480 }}>
          <thead>
            <tr>
              <th style={th}>전략</th>
              <th style={{ ...th, textAlign: 'right' }}>누적 수익</th>
              <th style={{ ...th, textAlign: 'right' }}>최대 낙폭</th>
              <th style={th}>기준 대비</th>
            </tr>
          </thead>
          <tbody>
            {snap.results.map((r) => (
              <tr key={r.name} style={BENCHMARKS.has(r.name) ? { color: 'var(--color-text-secondary)' } : undefined}>
                <td style={td}>{r.label}</td>
                <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{pct(r.totalReturnPct)}</td>
                <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.maxDrawdownPct.toFixed(2)}%</td>
                <td style={td}>{verdict(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
