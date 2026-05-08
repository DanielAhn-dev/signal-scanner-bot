import React, { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../../lib/api'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import Checkbox from '../../components/ui/Checkbox'
import Skeleton from '../../components/Skeleton'
import { EmptyState, ErrorState } from '../../components/StateViews'

// ─── Types ────────────────────────────────────────────────────────────────────
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

type AutoTradeSettings = {
  is_enabled?: boolean
  selected_strategy?: string | null
  monday_buy_slots?: number
  max_positions?: number
  min_buy_score?: number
  take_profit_pct?: number
  stop_loss_pct?: number
  long_term_ratio?: number
}

const STRATEGY_OPTIONS = [
  {
    id: 'HOLD_SAFE',
    label: '안전 포지션',
    desc: '보수 운용 · 최대 2종목 제한 진입',
    color: '#3b82f6',
  },
  {
    id: 'REDUCE_TIGHT',
    label: '타이트 손절',
    desc: '손절 2% / 익절 4% · 적극적 리스크 컷',
    color: '#f59e0b',
  },
  {
    id: 'WAIT_AND_DIP_BUY',
    label: '저가 매수 대기',
    desc: '현금 보유 · 눌림목 진입 기회 대기',
    color: '#10b981',
  },
] as const

type Tab = 'overview' | 'settings' | 'growth'

export default function StrategyPage() {
  const [tab, setTab] = useState<Tab>('overview')

  // decisions
  const [rows, setRows] = useState<DecisionRow[]>([])
  const [decLoading, setDecLoading] = useState(true)
  const [decError, setDecError] = useState<string | null>(null)

  // settings
  const [settings, setSettings] = useState<AutoTradeSettings | null>(null)
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)

  const loadDecisions = async () => {
    setDecLoading(true)
    setDecError(null)
    try {
      const res = await apiFetch('/api/ui/decisions?pageSize=200', { cacheMs: 5_000 })
      setRows((res?.data ?? []) as DecisionRow[])
    } catch (e: any) {
      setDecError(e?.message || String(e))
    } finally {
      setDecLoading(false)
    }
  }

  const loadSettings = async () => {
    setSettingsLoading(true)
    try {
      const res = await apiFetch('/api/ui/settings', { cacheMs: 0, timeoutMs: 10_000 })
      setSettings(res?.data ?? null)
    } catch {
      // ignore
    } finally {
      setSettingsLoading(false)
    }
  }

  const saveSettings = async () => {
    if (!settings) return
    setSaving(true)
    setSaveStatus(null)
    try {
      const res = await apiFetch('/api/ui/settings', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 10_000,
        body: JSON.stringify(settings),
      })
      if (res?.error) setSaveStatus(`오류: ${res.error}`)
      else {
        setSettings(res?.data ?? settings)
        setSaveStatus('저장 완료')
      }
    } catch (e: any) {
      setSaveStatus(`오류: ${e?.message || String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    void loadDecisions()
    void loadSettings()
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

  // ─── 전략 성장 타임라인 ───────────────────────────────────────────────────
  const growthTimeline = useMemo(() => {
    const events: Array<{
      key: string
      time: string
      kind: 'version' | 'regime' | 'trigger'
      text: string
      subtitle: string
    }> = []
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
        events.push({
          key: `v-${row.id ?? Math.random()}`,
          time: created,
          kind: 'version',
          text: `전략 버전 전환 → ${version}`,
          subtitle: `${code} · ${action || '-'}`,
        })
        prevVersion = version
      }

      if (regime && regime !== prevRegime) {
        events.push({
          key: `r-${row.id ?? Math.random()}`,
          time: created,
          kind: 'regime',
          text: `시장 국면 전환 → ${regime}`,
          subtitle: `${code} · ${action || '-'}${trigger ? ` · ${trigger}` : ''}`,
        })
        prevRegime = regime
      }
    }

    return events.slice(0, 30)
  }, [rows])

  // ─── 현재 전략 레이블 ─────────────────────────────────────────────────────
  const currentStrategyInfo = useMemo(() => {
    const id = String(settings?.selected_strategy || 'HOLD_SAFE').toUpperCase()
    return STRATEGY_OPTIONS.find((s) => s.id === id) ?? STRATEGY_OPTIONS[0]
  }, [settings])

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: '현황' },
    { key: 'settings', label: '전략 설정' },
    { key: 'growth', label: '성장 기록' },
  ]

  return (
    <section className="container-app">
      {/* ─── Header ───────────────────────────────────────────────── */}
      <div className="flex-between mb-4">
        <h1 className="title-xl" style={{ marginBottom: 0 }}>전략 대시보드</h1>
        <Button
          variant="secondary"
          onClick={() => { void loadDecisions(); void loadSettings() }}
          disabled={decLoading || settingsLoading}
        >
          새로고침
        </Button>
      </div>

      {/* ─── Tab bar ──────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            className={`sector-tab-btn${tab === t.key ? ' sector-tab-btn--active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ════════════════════ TAB: 현황 ════════════════════ */}
      {tab === 'overview' && (
        <>
          {/* 현재 전략 상태 배너 */}
          <div
            className="card mb-4"
            style={{
              borderLeft: `4px solid ${currentStrategyInfo.color}`,
              background: `color-mix(in srgb, ${currentStrategyInfo.color} 6%, var(--color-surface-card))`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div className="caption" style={{ marginBottom: 2 }}>현재 운용 전략</div>
                <div
                  className="title-lg"
                  style={{ color: currentStrategyInfo.color }}
                >
                  {currentStrategyInfo.label}
                </div>
                <div className="muted" style={{ marginTop: 2 }}>{currentStrategyInfo.desc}</div>
              </div>
              <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                <div className="caption">자동매매</div>
                <div
                  className="title-md"
                  style={{ color: settings?.is_enabled ? '#10b981' : '#ef4444' }}
                >
                  {settingsLoading ? '…' : settings?.is_enabled ? '활성화' : '비활성화'}
                </div>
              </div>
            </div>
          </div>

          {/* 퀀트 파라미터 요약 */}
          {!settingsLoading && settings && (
            <div className="cards-list mb-4">
              <div className="card">
                <div className="caption">최소 매수 점수</div>
                <div className="title-lg">{settings.min_buy_score ?? 72}</div>
              </div>
              <div className="card">
                <div className="caption">익절 / 손절</div>
                <div className="title-lg">{settings.take_profit_pct ?? 8}% / {settings.stop_loss_pct ?? 4}%</div>
              </div>
              <div className="card">
                <div className="caption">최대 포지션</div>
                <div className="title-lg">{settings.max_positions ?? 10}종목</div>
              </div>
              <div className="card">
                <div className="caption">월요일 매수 슬롯</div>
                <div className="title-lg">{settings.monday_buy_slots ?? 2}개</div>
              </div>
            </div>
          )}

          {/* 의사결정 통계 */}
          {decError && <ErrorState message={decError} onRetry={loadDecisions} />}
          {decLoading && <div className="card mb-4"><Skeleton lines={4} height={14} /></div>}
          {!decLoading && !decError && rows.length > 0 && (
            <>
              <div className="cards-list mb-4">
                <div className="card">
                  <div className="caption">누적 의사결정</div>
                  <div className="title-lg">{summary.total}건</div>
                </div>
                <div className="card">
                  <div className="caption">시스템 자동 비중</div>
                  <div className="title-lg">{summary.autoRatio}%</div>
                  <div className="muted">({summary.autoCount}건)</div>
                </div>
                <div className="card">
                  <div className="caption">매수 / 매도</div>
                  <div className="title-lg">{summary.buyCount} / {summary.sellCount}</div>
                </div>
              </div>

              <div className="cards-list mb-4">
                {/* 트리거 빈도 */}
                <div className="card">
                  <div className="title-md" style={{ marginBottom: 'var(--space-2)' }}>주요 트리거 빈도</div>
                  {summary.topTriggers.length === 0 && <div className="muted">데이터 없음</div>}
                  {summary.topTriggers.map(([trigger, count]) => {
                    const maxCount = summary.topTriggers[0]?.[1] ?? 1
                    const pct = Math.round((count / maxCount) * 100)
                    return (
                      <div key={trigger} style={{ marginBottom: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                          <span className="caption">{trigger}</span>
                          <span className="caption">{count}건</span>
                        </div>
                        <div style={{ height: 5, background: 'var(--color-border-subtle)', borderRadius: 3 }}>
                          <div
                            style={{
                              height: '100%',
                              width: `${pct}%`,
                              background: 'var(--color-brand)',
                              borderRadius: 3,
                              transition: 'width 0.4s',
                            }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* 시장 국면 분포 */}
                <div className="card">
                  <div className="title-md" style={{ marginBottom: 'var(--space-2)' }}>시장 국면 분포</div>
                  {summary.topRegimes.length === 0 && <div className="muted">데이터 없음</div>}
                  {summary.topRegimes.map(([regime, count]) => {
                    const maxCount = summary.topRegimes[0]?.[1] ?? 1
                    const pct = Math.round((count / maxCount) * 100)
                    return (
                      <div key={regime} style={{ marginBottom: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                          <span className="caption">{regime}</span>
                          <span className="caption">{count}건</span>
                        </div>
                        <div style={{ height: 5, background: 'var(--color-border-subtle)', borderRadius: 3 }}>
                          <div
                            style={{
                              height: '100%',
                              width: `${pct}%`,
                              background: '#f59e0b',
                              borderRadius: 3,
                              transition: 'width 0.4s',
                            }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* 전략 버전 분포 */}
                <div className="card">
                  <div className="title-md" style={{ marginBottom: 'var(--space-2)' }}>전략 버전 분포</div>
                  {summary.topVersions.length === 0 && <div className="muted">데이터 없음</div>}
                  {summary.topVersions.map(([version, count]) => (
                    <div key={version} className="caption" style={{ marginBottom: 6 }}>
                      <span style={{ fontWeight: 600 }}>{version}</span>
                      <span className="muted"> · {count}건</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
          {!decLoading && !decError && rows.length === 0 && (
            <EmptyState
              title="의사결정 데이터 없음"
              description="자동매매가 실행되면 여기에 전략 현황이 표시됩니다."
            />
          )}
        </>
      )}

      {/* ════════════════════ TAB: 전략 설정 ════════════════════ */}
      {tab === 'settings' && (
        <div className="cards-list">
          {settingsLoading && <div className="card"><Skeleton lines={5} height={14} /></div>}
          {!settingsLoading && (
            <>
              {/* 운용 전략 선택 */}
              <div className="card">
                <div className="title-md" style={{ marginBottom: 'var(--space-3)' }}>운용 전략 선택</div>
                <div className="muted" style={{ marginBottom: 'var(--space-3)' }}>
                  시장 위험도와 현재 계좌 상황에 맞는 전략을 선택합니다. 변경 후 저장하면 다음 자동매매 사이클부터 적용됩니다.
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {STRATEGY_OPTIONS.map((opt) => {
                    const isActive = String(settings?.selected_strategy || 'HOLD_SAFE').toUpperCase() === opt.id
                    return (
                      <div
                        key={opt.id}
                        onClick={() => setSettings({ ...settings, selected_strategy: opt.id })}
                        style={{
                          padding: '14px 16px',
                          borderRadius: 'var(--radius-card)',
                          border: isActive
                            ? `2px solid ${opt.color}`
                            : '1.5px solid var(--color-border-default)',
                          background: isActive
                            ? `color-mix(in srgb, ${opt.color} 8%, var(--color-surface-card))`
                            : 'var(--color-surface-card)',
                          cursor: 'pointer',
                          transition: 'all 0.2s',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 12,
                        }}
                      >
                        <div
                          style={{
                            width: 16,
                            height: 16,
                            borderRadius: '50%',
                            border: `2px solid ${opt.color}`,
                            background: isActive ? opt.color : 'transparent',
                            flexShrink: 0,
                          }}
                        />
                        <div>
                          <div style={{ fontWeight: 600, color: isActive ? opt.color : 'inherit' }}>
                            {opt.label}
                          </div>
                          <div className="muted" style={{ marginTop: 2 }}>{opt.desc}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* 자동매매 활성화 */}
              <div className="card">
                <div className="title-md" style={{ marginBottom: 'var(--space-2)' }}>자동매매 제어</div>
                <Checkbox
                  label="자동매매 활성화"
                  checked={!!settings?.is_enabled}
                  onChange={(v) => setSettings({ ...settings, is_enabled: v })}
                />
                <div className="muted mt-2">
                  비활성화하면 스케줄 실행 시 매매 없이 분석만 수행합니다.
                </div>
              </div>

              {/* 퀀트 파라미터 */}
              <div className="card">
                <div className="title-md" style={{ marginBottom: 'var(--space-3)' }}>퀀트 파라미터</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <Input
                    label="최소 매수 점수"
                    type="number"
                    value={settings?.min_buy_score ?? 72}
                    onChange={(e: any) =>
                      setSettings({ ...settings, min_buy_score: Number(e.target.value) })
                    }
                  />
                  <Input
                    label="최대 포지션 수"
                    type="number"
                    value={settings?.max_positions ?? 10}
                    onChange={(e: any) =>
                      setSettings({ ...settings, max_positions: Number(e.target.value) })
                    }
                  />
                  <Input
                    label="익절 (%)"
                    type="number"
                    value={settings?.take_profit_pct ?? 8}
                    onChange={(e: any) =>
                      setSettings({ ...settings, take_profit_pct: Number(e.target.value) })
                    }
                  />
                  <Input
                    label="손절 (%)"
                    type="number"
                    value={settings?.stop_loss_pct ?? 4}
                    onChange={(e: any) =>
                      setSettings({ ...settings, stop_loss_pct: Number(e.target.value) })
                    }
                  />
                  <Input
                    label="월요일 매수 슬롯"
                    type="number"
                    value={settings?.monday_buy_slots ?? 2}
                    onChange={(e: any) =>
                      setSettings({ ...settings, monday_buy_slots: Number(e.target.value) })
                    }
                  />
                  <Input
                    label="장기 비중 (%)"
                    type="number"
                    value={settings?.long_term_ratio ?? 70}
                    onChange={(e: any) =>
                      setSettings({ ...settings, long_term_ratio: Number(e.target.value) })
                    }
                  />
                </div>
                <div className="muted mt-2" style={{ fontSize: '0.78rem' }}>
                  최소 매수 점수: 스캔 점수 미달 시 매수 제외 · 익절/손절은 가상 자동매매 기준 · 장기 비중은 장기 포지션 목표 비율
                </div>
              </div>

              {/* 저장 */}
              <div className="card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Button variant="primary" onClick={saveSettings} disabled={saving}>
                    {saving ? '저장 중…' : '설정 저장'}
                  </Button>
                  {saveStatus && (
                    <span
                      className="caption"
                      style={{
                        color: saveStatus.startsWith('오류') ? '#ef4444' : '#10b981',
                      }}
                    >
                      {saveStatus}
                    </span>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* ════════════════════ TAB: 성장 기록 ════════════════════ */}
      {tab === 'growth' && (
        <>
          {/* 성장 요약 내러티브 */}
          <div className="card mb-4" style={{ borderLeft: '4px solid var(--color-brand)' }}>
            <div className="title-md" style={{ marginBottom: 8 }}>전략 성장 요약</div>
            {decLoading && <Skeleton lines={3} height={12} />}
            {!decLoading && rows.length > 0 && (() => {
              const firstDate = rows[rows.length - 1]?.created_at
                ? new Date(rows[rows.length - 1]!.created_at!).toLocaleDateString('ko-KR')
                : '-'
              const lastDate = rows[0]?.created_at
                ? new Date(rows[0]!.created_at!).toLocaleDateString('ko-KR')
                : '-'
              const uniqueRegimes = new Set(rows.map((r) => r.market_regime).filter(Boolean)).size
              const uniqueVersions = new Set(rows.map((r) => r.strategy_version).filter(Boolean)).size
              return (
                <div style={{ lineHeight: 1.7, color: 'var(--color-text-secondary)' }}>
                  <span>{firstDate}</span>부터 <span>{lastDate}</span>까지{' '}
                  <strong style={{ color: 'var(--color-text-primary)' }}>{summary.total}건</strong>의 의사결정이 누적되었습니다.{' '}
                  이 중 자동 시스템이 판단한 비중은{' '}
                  <strong style={{ color: 'var(--color-brand)' }}>{summary.autoRatio}%</strong>이며,{' '}
                  <strong>{summary.buyCount}번</strong> 매수, <strong>{summary.sellCount}번</strong> 매도가 이루어졌습니다.
                  {uniqueVersions > 0 && (
                    <> 총 <strong>{uniqueVersions}개</strong>의 전략 버전이 관측되었고,</>
                  )}
                  {uniqueRegimes > 0 && (
                    <> <strong>{uniqueRegimes}가지</strong> 시장 국면을 경험했습니다.</>
                  )}
                  {' '}주요 판단 트리거는{' '}
                  <strong>{summary.topTriggers[0]?.[0] || '-'}</strong>{summary.topTriggers[0] ? `(${summary.topTriggers[0][1]}건)` : ''}입니다.
                </div>
              )
            })()}
            {!decLoading && rows.length === 0 && (
              <div className="muted">아직 데이터가 없습니다. 자동매매가 실행되면 기록이 쌓입니다.</div>
            )}
          </div>

          {/* 전략·국면 전환 타임라인 */}
          <div className="card mb-4">
            <div className="title-md" style={{ marginBottom: 'var(--space-2)' }}>전략 & 국면 전환 타임라인</div>
            <div className="muted" style={{ marginBottom: 12, fontSize: '0.8rem' }}>
              전략 버전 또는 시장 국면이 바뀐 시점을 시간 순으로 표시합니다.
            </div>
            {decLoading && <Skeleton lines={5} height={12} />}
            {!decLoading && growthTimeline.length === 0 && (
              <div className="muted">감지된 전환 없음</div>
            )}
            {!decLoading && growthTimeline.map((item) => (
              <div
                key={item.key}
                style={{
                  display: 'flex',
                  gap: 12,
                  padding: '10px 0',
                  borderBottom: '1px solid var(--color-border-subtle)',
                  alignItems: 'flex-start',
                }}
              >
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: item.kind === 'version' ? 'var(--color-brand)' : '#f59e0b',
                    marginTop: 4,
                    flexShrink: 0,
                  }}
                />
                <div>
                  <div style={{ fontWeight: 500 }}>{item.text}</div>
                  <div className="caption" style={{ marginTop: 2 }}>{item.subtitle}</div>
                  <div className="muted" style={{ fontSize: '0.75rem', marginTop: 2 }}>{item.time}</div>
                </div>
              </div>
            ))}
          </div>

          {/* 트리거 누적 분포 */}
          {!decLoading && summary.topTriggers.length > 0 && (
            <div className="card">
              <div className="title-md" style={{ marginBottom: 'var(--space-2)' }}>누적 트리거 분포</div>
              <div className="muted" style={{ marginBottom: 12, fontSize: '0.8rem' }}>
                어떤 조건에 의해 매매가 결정되었는지 누적 빈도를 보여줍니다.
              </div>
              {summary.topTriggers.map(([trigger, count]) => {
                const maxCount = summary.topTriggers[0]?.[1] ?? 1
                const pct = Math.round((count / maxCount) * 100)
                return (
                  <div key={trigger} style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: '0.88rem', fontWeight: 500 }}>{trigger}</span>
                      <span className="caption">{count}건 ({Math.round((count / summary.total) * 100)}%)</span>
                    </div>
                    <div style={{ height: 8, background: 'var(--color-border-subtle)', borderRadius: 4 }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${pct}%`,
                          background: 'var(--color-brand)',
                          borderRadius: 4,
                          transition: 'width 0.5s',
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </section>
  )
}
