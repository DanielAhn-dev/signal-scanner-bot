import React, { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api'
import Button from '../../components/ui/Button'

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
  review?: { status: string; measuredDays: number; lines: string[]; candidates?: string[] }
}

type Activation = {
  active: string | null
  approvedPendingImplementation: string[]
  decisions: Array<{ strategy: string; action: string; at: string; source: string }>
}

// 비교 기준 — 후보 전략이 현재 봇·KODEX 200·CD금리보다 모두 나아야 바꿀 이유가 있다
const BENCHMARKS = new Set(['kodex200-hold', 'cd-only', 'bot-account'])

const pct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`

/**
 * 전략 경쟁 측정(전향검증) — scripts/strategy_forward_test.ts 가 매일 저장한 최신 결과.
 * 봇 후보 전략을 봇 실제 계좌·KODEX 200·CD금리와 같은 기간·같은 비용으로 비교하고,
 * 판정이 승격 후보를 내면 관리자가 승인·보류한다 (텔레그램 버튼과 같은 기록, strategyPromotion.ts).
 */
export default function ForwardTestPanel() {
  const [snap, setSnap] = useState<ForwardTestSnapshot | null>(null)
  const [activation, setActivation] = useState<Activation | null>(null)
  const [canDecide, setCanDecide] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/ui/forward-test', { cacheMs: 0 })
      setSnap(res?.data ?? null)
      setActivation(res?.activation ?? null)
      setCanDecide(Boolean(res?.canDecide))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const decide = async (strategy: string, action: 'approve' | 'defer' | 'deactivate') => {
    setBusy(true)
    setNotice(null)
    try {
      const res = await apiFetch('/api/ui/forward-test', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 15_000,
        body: JSON.stringify({ strategy, action }),
      })
      setNotice(res?.message ?? res?.error ?? '처리됨')
      await load()
    } catch (e: unknown) {
      setNotice(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

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

  const labelOf = (name: string) => snap.results.find((r) => r.name === name)?.label ?? name
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
  const candidates = snap.review?.status === 'propose' ? snap.review.candidates ?? [] : []

  const th: React.CSSProperties = { textAlign: 'left', padding: '4px 8px', borderBottom: '1px solid var(--color-border-default)' }
  const td: React.CSSProperties = { padding: '4px 8px', borderBottom: '1px solid var(--color-border-subtle, var(--color-border-default))' }

  return (
    <div style={box}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>전략 비교 (전향검증)</div>
      <div style={{ color: 'var(--color-text-secondary)', marginBottom: 8, lineHeight: 1.5 }}>
        {snap.startDate} ~ {snap.endDate} · 매매비용 포함 · 측정 시작 뒤 실제로 지나간 기간만 씁니다.
        기간이 짧을수록 우연의 영향이 크니, 몇 달 쌓인 뒤 판단하세요.
      </div>

      <div style={{ marginBottom: 8, lineHeight: 1.6 }}>
        <strong>봇이 따르는 전략</strong>:{' '}
        {activation?.active ? (
          <>
            {labelOf(activation.active)} (승격 승인됨){' '}
            {canDecide && (
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void decide(activation.active!, 'deactivate')}>
                해제 — 기존 방식으로
              </Button>
            )}
          </>
        ) : (
          '기존 봇 방식 (점수 후보 + 실적 관문 + 50일선 + 매도 규칙)'
        )}
        {activation?.approvedPendingImplementation?.length ? (
          <div style={{ color: 'var(--color-text-secondary)' }}>
            승인됐지만 봇 구현 대기: {activation.approvedPendingImplementation.map(labelOf).join(', ')}
          </div>
        ) : null}
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
          {candidates.map((name) => (
            <div key={name} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
              <span>{labelOf(name)}</span>
              {canDecide ? (
                <>
                  <Button size="sm" disabled={busy || activation?.active === name} onClick={() => void decide(name, 'approve')}>
                    승인
                  </Button>
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => void decide(name, 'defer')}>
                    보류
                  </Button>
                </>
              ) : (
                <span style={{ color: 'var(--color-text-tertiary)' }}>승인은 관리자만</span>
              )}
            </div>
          ))}
          {!candidates.length && (
            <div style={{ color: 'var(--color-text-tertiary)', marginTop: 4 }}>
              승인 버튼은 판정 규칙을 통과한 후보가 있을 때만 나타납니다.
            </div>
          )}
        </div>
      )}
      {notice && <div style={{ marginBottom: 8, color: 'var(--color-brand)' }}>{notice}</div>}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 480 }}>
          <thead>
            <tr>
              <th style={th}>전략</th>
              <th style={{ ...th, textAlign: 'right' }}>누적 수익</th>
              <th style={{ ...th, textAlign: 'right' }}>최대 낙폭</th>
              <th style={{ ...th, textAlign: 'right' }}>측정 기간</th>
              <th style={th}>기준 대비</th>
            </tr>
          </thead>
          <tbody>
            {snap.results.map((r) => (
              <tr key={r.name} style={BENCHMARKS.has(r.name) ? { color: 'var(--color-text-secondary)' } : undefined}>
                <td style={td}>
                  {r.label}
                  {activation?.active === r.name ? ' · 봇 적용 중' : ''}
                </td>
                <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{pct(r.totalReturnPct)}</td>
                <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.maxDrawdownPct.toFixed(2)}%</td>
                <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                  {r.periods}일{r.periods < 40 ? ' · 표본 부족' : ''}
                </td>
                <td style={td}>{verdict(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
