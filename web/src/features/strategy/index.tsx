import React, { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../../lib/api'
import Button from '../../components/ui/Button'
import Skeleton from '../../components/Skeleton'
import { EmptyState, ErrorState } from '../../components/StateViews'

type DecisionRow = {
  id?: number
  code?: string
  stock_name?: string
  action?: string
  created_at?: string
  strategy_version?: string | null
  market_regime?: string | null
  reason_summary?: string
  trigger_label?: string
  detail_lines?: string[]
  is_auto?: boolean
}

export default function StrategyPage() {
  const [rows, setRows] = useState<DecisionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch('/api/ui/decisions?pageSize=120', { cacheMs: 5_000 })
      setRows((res?.data ?? []) as DecisionRow[])
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const summary = useMemo(() => {
    const total = rows.length
    const autoCount = rows.filter((r) => !!r.is_auto).length
    const buyCount = rows.filter((r) => String(r.action || '').toUpperCase() === 'BUY').length
    const sellCount = rows.filter((r) => String(r.action || '').toUpperCase() === 'SELL').length

    const triggerCount = new Map<string, number>()
    const versionCount = new Map<string, number>()
    const regimeCount = new Map<string, number>()

    for (const row of rows) {
      const trigger = String(row.trigger_label || '').trim()
      const version = String(row.strategy_version || '').trim()
      const regime = String(row.market_regime || '').trim()

      if (trigger) triggerCount.set(trigger, (triggerCount.get(trigger) || 0) + 1)
      if (version) versionCount.set(version, (versionCount.get(version) || 0) + 1)
      if (regime) regimeCount.set(regime, (regimeCount.get(regime) || 0) + 1)
    }

    const topTriggers = Array.from(triggerCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)

    const topVersions = Array.from(versionCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)

    const topRegimes = Array.from(regimeCount.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)

    return {
      total,
      autoCount,
      buyCount,
      sellCount,
      autoRatio: total > 0 ? Math.round((autoCount / total) * 100) : 0,
      topTriggers,
      topVersions,
      topRegimes,
    }
  }, [rows])

  const stateChanges = useMemo(() => {
    const changes: Array<{ key: string; time: string; text: string; subtitle: string }> = []
    let prevVersion = ''
    let prevRegime = ''

    for (const row of rows) {
      const created = row.created_at ? new Date(row.created_at).toLocaleString('ko-KR') : '-'
      const version = String(row.strategy_version || '').trim()
      const regime = String(row.market_regime || '').trim()
      const action = String(row.action || '').toUpperCase()
      const code = row.stock_name || row.code || '-'
      const trigger = String(row.trigger_label || '').trim()

      if (version && version !== prevVersion) {
        changes.push({
          key: `v-${row.id ?? Math.random()}`,
          time: created,
          text: `전략 버전 변경: ${version}`,
          subtitle: `${code} · ${action || '-'}${trigger ? ` · ${trigger}` : ''}`,
        })
        prevVersion = version
      }

      if (regime && regime !== prevRegime) {
        changes.push({
          key: `r-${row.id ?? Math.random()}`,
          time: created,
          text: `시장 국면 변경: ${regime}`,
          subtitle: `${code} · ${action || '-'}${trigger ? ` · ${trigger}` : ''}`,
        })
        prevRegime = regime
      }

      if (trigger) {
        changes.push({
          key: `t-${row.id ?? Math.random()}`,
          time: created,
          text: `전략 트리거: ${trigger}`,
          subtitle: `${code} · ${action || '-'}${row.reason_summary ? ` · ${row.reason_summary}` : ''}`,
        })
      }

      if (changes.length >= 25) break
    }

    return changes
  }, [rows])

  return (
    <section className="container-app">
      <div className="flex-between mb-4">
        <h1 className="title-xl" style={{ marginBottom: 0 }}>전략 대시보드</h1>
        <Button variant="secondary" onClick={load} disabled={loading}>새로고침</Button>
      </div>

      <div className="card mb-4">
        <div className="muted">자동매매 의사결정 로그를 기준으로 전략 상태 변화, 트리거 빈도, 버전/시장국면 흐름을 요약합니다.</div>
      </div>

      {error && <ErrorState message={error} onRetry={load} />}
      {loading && <div className="card"><Skeleton lines={7} height={14} /></div>}
      {!loading && !error && rows.length === 0 && <EmptyState title="전략 데이터 없음" description="의사결정 로그가 쌓이면 전략 상태를 분석할 수 있습니다." />}

      {!loading && !error && rows.length > 0 && (
        <>
          <div className="cards-list mb-4">
            <div className="card">
              <div className="caption">최근 의사결정</div>
              <div className="title-lg">{summary.total}건</div>
            </div>
            <div className="card">
              <div className="caption">시스템 자동 비중</div>
              <div className="title-lg">{summary.autoRatio}% ({summary.autoCount}건)</div>
            </div>
            <div className="card">
              <div className="caption">BUY / SELL</div>
              <div className="title-lg">{summary.buyCount} / {summary.sellCount}</div>
            </div>
          </div>

          <div className="cards-list mb-4">
            <div className="card">
              <div className="title-md" style={{ marginBottom: 'var(--space-2)' }}>주요 트리거</div>
              {summary.topTriggers.length === 0 && <div className="muted">트리거 데이터 없음</div>}
              {summary.topTriggers.map(([trigger, count]) => (
                <div key={trigger} className="caption" style={{ marginBottom: 'var(--space-1)' }}>
                  {trigger}: {count}건
                </div>
              ))}
            </div>
            <div className="card">
              <div className="title-md" style={{ marginBottom: 'var(--space-2)' }}>전략 버전 분포</div>
              {summary.topVersions.length === 0 && <div className="muted">버전 데이터 없음</div>}
              {summary.topVersions.map(([version, count]) => (
                <div key={version} className="caption" style={{ marginBottom: 'var(--space-1)' }}>
                  {version}: {count}건
                </div>
              ))}
            </div>
            <div className="card">
              <div className="title-md" style={{ marginBottom: 'var(--space-2)' }}>시장 국면 분포</div>
              {summary.topRegimes.length === 0 && <div className="muted">국면 데이터 없음</div>}
              {summary.topRegimes.map(([regime, count]) => (
                <div key={regime} className="caption" style={{ marginBottom: 'var(--space-1)' }}>
                  {regime}: {count}건
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="title-md" style={{ marginBottom: 'var(--space-2)' }}>최근 전략 상태 변화</div>
            {stateChanges.length === 0 && <div className="muted">감지된 변화 없음</div>}
            {stateChanges.map((item) => (
              <div key={item.key} style={{ padding: '8px 0', borderBottom: '1px solid var(--color-border-subtle)' }}>
                <div className="caption" style={{ marginBottom: 2 }}>{item.time}</div>
                <div style={{ fontWeight: 'var(--font-weight-medium)' }}>{item.text}</div>
                <div className="muted">{item.subtitle}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
