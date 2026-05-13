import React, { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../../lib/api'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import Checkbox from '../../components/ui/Checkbox'
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

type AutoTradeSettings = {
  is_enabled?: boolean
  selected_strategy?: string | null
  monday_buy_slots?: number
  max_positions?: number
  min_buy_score?: number
  take_profit_pct?: number
  stop_loss_pct?: number
  long_term_ratio?: number
  // 동적 포지션 사이징
  use_dynamic_sizing?: boolean
  base_max_positions?: number
  bull_multiplier?: number
  bear_multiplier?: number
  min_confidence_pct?: number
  // 적응형 손익 조정
  use_adaptive_exit?: boolean
  stop_loss_range?: [number, number]
  take_profit_range?: [number, number]
  volatility_adjustment?: number
}

type ActivityRow = {
  id: string
  code: string
  stock_name?: string | null
  side: 'BUY' | 'SELL' | 'ADJUST'
  pnl_amount?: number | null
  created_at: string
  memo?: string | null
}

type AdaptiveFactorStat = {
  key: string
  factor: string
  label: string
  sampleCount: number
  winRatePct: number
  avgForwardReturnPct: number
  weight: number
}

type AdaptiveInsights = {
  latestTradeDate: string | null
  horizonBars: number
  sampleCount: number
  baseHitRatePct: number
  baseAvgReturnPct: number
  strengthScore: number
  todayBiasSummary: string
  topPositiveFactors: AdaptiveFactorStat[]
  topNegativeFactors: AdaptiveFactorStat[]
}

const STRATEGY_OPTIONS = [
  {
    id: 'HOLD_SAFE',
    label: '안전 포지션',
    desc: '보수 운용 · 최대 2종목 제한 진입',
    color: 'var(--color-brand)',
  },
  {
    id: 'REDUCE_TIGHT',
    label: '타이트 손절',
    desc: '손절 2% / 익절 4% · 적극적 리스크 컷',
    color: 'var(--color-warning)',
  },
  {
    id: 'WAIT_AND_DIP_BUY',
    label: '저가 매수 대기',
    desc: '현금 보유 · 눌림목 진입 기회 대기',
    color: 'var(--color-success)',
  },
] as const

const COLOR_POSITIVE = 'var(--color-success)'
const COLOR_NEGATIVE = 'var(--color-error)'
const COLOR_WARNING = 'var(--color-warning)'
const COLOR_POSITIVE_BG = 'var(--color-success-bg)'
const COLOR_NEGATIVE_BG = 'var(--color-error-bg)'

const TRIGGER_LABEL_MAP: Record<string, string> = {
  'add-on-buy': '추가 매수',
  'rebalance-buy': '리밸런싱 매수',
  'take-profit-partial': '분할 익절',
  'monday-score-candidate': '월요일 점수 후보 진입',
  'stop-loss': '손절 매도',
  'take-profit-final': '최종 익절',
  'take-profit': '익절 매도',
  'new-buy': '신규 매수',
  'rebalance-sell': '리밸런싱 매도',
  rebalance: '리밸런싱',
  manual: '수동 거래',
}

const MARKET_REGIME_LABEL_MAP: Record<string, string> = {
  bull: '상승장',
  bear: '하락장',
  bearish: '하락장',
  sideways: '횡보장',
  neutral: '중립',
  risk_off: '리스크 오프',
  risk_on: '리스크 온',
}

type Tab = 'overview' | 'settings' | 'growth'

function formatTriggerLabel(value: string): string {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return '-'
  return TRIGGER_LABEL_MAP[normalized] || normalized.replace(/-/g, ' ')
}

function formatMarketRegimeLabel(value: string): string {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return '-'
  return MARKET_REGIME_LABEL_MAP[normalized] || value
}

function formatKrwShort(value: number): string {
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  if (abs >= 100_000_000) return `${sign}${(abs / 100_000_000).toFixed(1)}억`
  if (abs >= 10_000) return `${sign}${Math.round(abs / 10_000).toLocaleString('ko-KR')}만`
  return `${sign}${Math.round(abs).toLocaleString('ko-KR')}원`
}

function buildLinePath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return ''
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
}

function calculateMovingAverage(values: number[], window: number): number[] {
  const result: number[] = []
  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - window + 1)
    const subset = values.slice(start, i + 1)
    const avg = subset.reduce((a, b) => a + b, 0) / subset.length
    result.push(avg)
  }
  return result
}

export default function StrategyPage() {
  const [tab, setTab] = useState<Tab>('overview')
  const [rows, setRows] = useState<DecisionRow[]>([])
  const [decLoading, setDecLoading] = useState(true)
  const [decError, setDecError] = useState<string | null>(null)
  const [settings, setSettings] = useState<AutoTradeSettings | null>(null)
  const [settingsLoading, setSettingsLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)
  const [activityRows, setActivityRows] = useState<ActivityRow[]>([])
  const [activityLoading, setActivityLoading] = useState(true)
  const [adaptiveInsights, setAdaptiveInsights] = useState<AdaptiveInsights | null>(null)
  const [adaptiveLoading, setAdaptiveLoading] = useState(true)

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
      setSettings(null)
    } finally {
      setSettingsLoading(false)
    }
  }

  const loadActivity = async () => {
    setActivityLoading(true)
    try {
      const res = await apiFetch('/api/ui/operations?view=activity', { cacheMs: 0, timeoutMs: 15_000 })
      setActivityRows(Array.isArray(res?.data) ? (res.data as ActivityRow[]) : [])
    } catch {
      setActivityRows([])
    } finally {
      setActivityLoading(false)
    }
  }

  const loadAdaptiveInsights = async () => {
    setAdaptiveLoading(true)
    try {
      const res = await apiFetch('/api/ui/strategy-adaptive', { cacheMs: 60_000, timeoutMs: 20_000 })
      setAdaptiveInsights((res?.data ?? null) as AdaptiveInsights | null)
    } catch {
      setAdaptiveInsights(null)
    } finally {
      setAdaptiveLoading(false)
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
    void loadActivity()
    void loadAdaptiveInsights()
  }, [])

  const summary = useMemo(() => {
    const total = rows.length
    const autoCount = rows.filter((row) => !!row.is_auto).length
    const buyCount = rows.filter((row) => String(row.action || '').toUpperCase() === 'BUY').length
    const sellCount = rows.filter((row) => String(row.action || '').toUpperCase() === 'SELL').length

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

    return {
      total,
      autoCount,
      buyCount,
      sellCount,
      autoRatio: total > 0 ? Math.round((autoCount / total) * 100) : 0,
      topTriggers: Array.from(triggerCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8),
      topVersions: Array.from(versionCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5),
      topRegimes: Array.from(regimeCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5),
    }
  }, [rows])

  const growthTimeline = useMemo(() => {
    const events: Array<{ key: string; time: string; kind: 'version' | 'regime'; text: string; subtitle: string }> = []
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
          text: `시장 국면 전환 → ${formatMarketRegimeLabel(regime)}`,
          subtitle: `${code} · ${action || '-'}${trigger ? ` · ${formatTriggerLabel(trigger)}` : ''}`,
        })
        prevRegime = regime
      }
    }

    return events.slice(0, 30)
  }, [rows])

  const currentStrategyInfo = useMemo(() => {
    const id = String(settings?.selected_strategy || 'HOLD_SAFE').toUpperCase()
    return STRATEGY_OPTIONS.find((item) => item.id === id) ?? STRATEGY_OPTIONS[0]
  }, [settings])

  const profitTrend = useMemo(() => {
    const realizedRows = [...activityRows]
      .filter((row) => row.side === 'SELL' && Number.isFinite(Number(row.pnl_amount)))
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

    let cumulative = 0
    const series = realizedRows.map((row, index) => {
      cumulative += Number(row.pnl_amount || 0)
      return {
        id: row.id || `${row.code}-${index}`,
        label: row.stock_name || row.code || '-',
        date: new Date(row.created_at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }),
        value: cumulative,
      }
    })

    if (series.length === 0) {
      return {
        points: [] as Array<{ id: string; x: number; y: number; label: string; date: string; value: number }>,
        movingAvgPoints: [] as Array<{ x: number; y: number }>,
        path: '',
        maPath: '',
        baselineY: 84,
        lastValue: 0,
        fillSegments: [] as Array<{ start: number; end: number; color: string }>,
        segments: [] as Array<{ x1: number; y1: number; x2: number; y2: number; color: string }>,
        projectionPoints: [] as Array<{ x: number; y: number }>,
        tradeBars: [] as Array<{ x: number; amount: number; isPositive: boolean; barW: number; barH: number; barBaseY: number; label: string; date: string; rectY: number }>,
      }
    }

    const width = 560
    const height = 168
    const paddingX = 18
    const paddingY = 16
    const values = series.map((item) => item.value)
    const min = Math.min(0, ...values)
    const max = Math.max(0, ...values)
    const range = Math.max(1, max - min)

    const points = series.map((item, index) => {
      const x = series.length === 1
        ? width / 2
        : paddingX + (index / (series.length - 1)) * (width - paddingX * 2)
      const y = paddingY + ((max - item.value) / range) * (height - paddingY * 2)
      return { ...item, x, y }
    })

    // 이동평균선 (3-point MA)
    const maValues = calculateMovingAverage(values, Math.min(3, Math.max(1, Math.floor(series.length / 3))))
    const movingAvgPoints = series.map((item, index) => {
      const x = series.length === 1
        ? width / 2
        : paddingX + (index / (series.length - 1)) * (width - paddingX * 2)
      const y = paddingY + ((max - maValues[index]) / range) * (height - paddingY * 2)
      return { x, y }
    })

    // 구간별 배경색
    const fillSegments: Array<{ start: number; end: number; color: string }> = []
    for (let i = 0; i < points.length - 1; i++) {
      const currIsPositive = values[i] >= 0
      const nextIsPositive = values[i + 1] >= 0
      if (currIsPositive !== nextIsPositive) {
        // 경계 지점에서 컬러 전환
        const color = values[i + 1] >= 0 ? COLOR_POSITIVE_BG : COLOR_NEGATIVE_BG
        fillSegments.push({ start: i, end: i + 1, color })
      } else {
        const color = currIsPositive ? COLOR_POSITIVE_BG : COLOR_NEGATIVE_BG
        fillSegments.push({ start: i, end: i + 1, color })
      }
    }

    // 구간별 색상 세그먼트 (각 구간의 중간값 기준)
    const segments = points.slice(0, -1).map((p, i) => {
      const next = points[i + 1]!
      const midValue = (values[i] + values[i + 1]) / 2
      return { x1: p.x, y1: p.y, x2: next.x, y2: next.y, color: midValue >= 0 ? COLOR_POSITIVE : COLOR_NEGATIVE }
    })

    // 선형 추세 기반 예상선 (최근 3거래 전망)
    const projectionPoints: Array<{ x: number; y: number }> = []
    if (points.length >= 2) {
      const stepX = (points[points.length - 1]!.x - points[0]!.x) / Math.max(points.length - 1, 1)
      const avgDeltaVal = (values[values.length - 1] - values[0]) / Math.max(values.length - 1, 1)
      for (let i = 1; i <= 3; i++) {
        const projVal = values[values.length - 1] + avgDeltaVal * i
        const projY = paddingY + ((max - projVal) / range) * (height - paddingY * 2)
        projectionPoints.push({
          x: points[points.length - 1]!.x + stepX * i,
          y: Math.max(paddingY / 2, Math.min(height - paddingY / 2, projY)),
        })
      }
    }

    // 거래별 손익 막대 데이터
    const barBaseY = 44
    const barPad = 8
    const barMaxAbs = Math.max(1, ...realizedRows.map((r) => Math.abs(Number(r.pnl_amount || 0))))
    const barBandH = barBaseY - barPad
    const barW = Math.max(4, Math.min(14, ((width - paddingX * 2) / Math.max(realizedRows.length, 1)) * 0.65))
    const tradeBars = realizedRows.map((row, i) => {
      const x = realizedRows.length === 1
        ? width / 2
        : paddingX + (i / (realizedRows.length - 1)) * (width - paddingX * 2)
      const amount = Number(row.pnl_amount || 0)
      const isPositive = amount >= 0
      const barH = Math.max(2, (Math.abs(amount) / barMaxAbs) * barBandH)
      return {
        x, amount, isPositive, barW, barH, barBaseY,
        label: row.stock_name || row.code || '-',
        date: new Date(row.created_at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' }),
        rectY: isPositive ? barBaseY - barH : barBaseY,
      }
    })

    return {
      points,
      movingAvgPoints,
      path: buildLinePath(points),
      maPath: buildLinePath(movingAvgPoints),
      baselineY: paddingY + ((max - 0) / range) * (height - paddingY * 2),
      lastValue: points[points.length - 1]?.value ?? 0,
      fillSegments,
      segments,
      projectionPoints,
      tradeBars,
    }
  }, [activityRows])

  const rollingWinRate = useMemo(() => {
    const sellRows = [...activityRows]
      .filter((row) => row.side === 'SELL' && Number.isFinite(Number(row.pnl_amount)))
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    if (sellRows.length < 3) return { points: [] as Array<{ x: number; y: number; winRate: number }>, path: '', avgWinRate: 0 }
    const windowSize = Math.min(5, Math.max(2, Math.floor(sellRows.length / 2)))
    const wWidth = 560; const wPadX = 18; const wPadY = 8; const wH = 60
    const pts = sellRows.slice(windowSize - 1).map((_, i) => {
      const win = sellRows.slice(i, i + windowSize).filter((r) => Number(r.pnl_amount || 0) > 0).length
      const winRate = Math.round((win / windowSize) * 100)
      const tradeIdx = i + windowSize - 1
      const x = sellRows.length <= 1 ? wWidth / 2 : wPadX + (tradeIdx / (sellRows.length - 1)) * (wWidth - wPadX * 2)
      const y = wPadY + ((100 - winRate) / 100) * (wH - wPadY * 2)
      return { x, y, winRate }
    })
    const avgWinRate = pts.length > 0 ? Math.round(pts.reduce((s, p) => s + p.winRate, 0) / pts.length) : 0
    return { points: pts, path: buildLinePath(pts), avgWinRate }
  }, [activityRows])

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: '현황' },
    { key: 'settings', label: '전략 설정' },
    { key: 'growth', label: '성장 기록' },
  ]

  return (
    <section className="container-app">
      <div className="flex-between mb-4">
        <h1 className="title-xl" style={{ marginBottom: 0 }}>전략 대시보드</h1>
        <Button
          variant="secondary"
          onClick={() => {
            void loadDecisions()
            void loadSettings()
            void loadActivity()
            void loadAdaptiveInsights()
          }}
          disabled={decLoading || settingsLoading || activityLoading || adaptiveLoading}
        >
          새로고침
        </Button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {tabs.map((item) => (
          <button
            key={item.key}
            className={`sector-tab-btn${tab === item.key ? ' sector-tab-btn--active' : ''}`}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
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
                <div className="title-lg" style={{ color: currentStrategyInfo.color }}>
                  {currentStrategyInfo.label}
                </div>
                <div className="muted" style={{ marginTop: 2 }}>{currentStrategyInfo.desc}</div>
              </div>
              <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                <div className="caption">자동매매 상태</div>
                <div className="title-md" style={{ color: settings?.is_enabled ? COLOR_POSITIVE : COLOR_NEGATIVE }}>
                  {settingsLoading ? '…' : settings?.is_enabled ? '활성화' : '비활성화'}
                </div>
              </div>
            </div>
          </div>

          {!settingsLoading && settings && (
            <>
              <div className="cards-list mb-4">
                <div className="card">
                  <div className="caption">최소 매수 점수</div>
                  <div className="title-lg">{settings.min_buy_score ?? 72}</div>
                </div>
                <div className="card">
                  <div className="caption">익절 / 손절 기준</div>
                  <div className="title-lg">{settings.take_profit_pct ?? 8}% / {settings.stop_loss_pct ?? 4}%</div>
                </div>
                <div className="card">
                  <div className="caption">최대 보유 종목</div>
                  <div className="title-lg">{settings.max_positions ?? 10}종목</div>
                </div>
                <div className="card">
                  <div className="caption">월요일 매수 슬롯</div>
                  <div className="title-lg">{settings.monday_buy_slots ?? 2}개</div>
                </div>
              </div>

              {settings?.use_dynamic_sizing && (
                <div className="card mb-4" style={{ background: 'linear-gradient(135deg, rgba(59,130,246,0.05), rgba(16,185,129,0.05))' }}>
                  <div className="title-md" style={{ marginBottom: 'var(--space-3)' }}>
                    📊 동적 포지션 사이징 — 예상 범위
                  </div>
                  
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 'var(--space-3)' }}>
                    <div style={{ padding: 12, background: 'var(--color-stock-down-bg)', borderRadius: 'var(--radius-sm)' }}>
                      <div className="caption">약세장</div>
                      <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700, color: 'var(--color-stock-down)', marginTop: 4 }}>
                        {Math.round((settings.base_max_positions ?? 3) * (settings.bear_multiplier ?? 0.5))} ~ {Math.ceil((settings.base_max_positions ?? 3) * (settings.bear_multiplier ?? 0.5))}종목
                      </div>
                      <div className="muted" style={{ fontSize: 'var(--font-size-xs)', marginTop: 4 }}>현금 보유 우선</div>
                    </div>

                    <div style={{ padding: 12, background: 'var(--color-bg-sunken)', borderRadius: 'var(--radius-sm)' }}>
                      <div className="caption">중립/횡보장</div>
                      <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700, marginTop: 4 }}>
                        {settings.base_max_positions ?? 3}종목
                      </div>
                      <div className="muted" style={{ fontSize: 'var(--font-size-xs)', marginTop: 4 }}>기본 설정값</div>
                    </div>

                    <div style={{ padding: 12, background: 'var(--color-stock-up-bg)', borderRadius: 'var(--radius-sm)' }}>
                      <div className="caption">강세장</div>
                      <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700, color: 'var(--color-stock-up)', marginTop: 4 }}>
                        {Math.round((settings.base_max_positions ?? 3) * (settings.bull_multiplier ?? 1.5))} ~ {Math.ceil((settings.base_max_positions ?? 3) * (settings.bull_multiplier ?? 1.5))}종목
                      </div>
                      <div className="muted" style={{ fontSize: 'var(--font-size-xs)', marginTop: 4 }}>공격적 진입</div>
                    </div>
                  </div>

                  <div className="muted" style={{ fontSize: 'var(--font-size-sm)', lineHeight: 1.6, borderTop: '1px solid var(--color-border-default)', paddingTop: 12 }}>
                    <strong>동작 원리:</strong><br/>
                    시장 국면(최근 {summary.topRegimes.length > 0 ? formatMarketRegimeLabel(summary.topRegimes[0]?.[0] ?? '') : '감지 중'})과 신호 신뢰도를 반영하여, 위 범위 내에서 실제 진입 종목 수가 자동으로 조정됩니다. 신뢰도가 {settings.min_confidence_pct ?? 65}% 미만이면 진입을 제한합니다.
                  </div>
                </div>
              )}
            </>
          )}

          <div className="card mb-4">
            <div className="flex-between" style={{ alignItems: 'baseline', marginBottom: 'var(--space-2)' }}>
              <div className="title-md">적응형 전략 엔진</div>
              {adaptiveInsights?.latestTradeDate && <div className="caption">기준일 {adaptiveInsights.latestTradeDate}</div>}
            </div>
            <div className="muted" style={{ marginBottom: 12, fontSize: 'var(--font-size-sm)' }}>
              최근 눌림목 후보의 실제 {adaptiveInsights?.horizonBars ?? 3}거래일 성과를 기준으로, 현재 스캔/하이라이트 후보 정렬에 반영 중인 적응 가중치입니다.
            </div>
            {adaptiveLoading && <Skeleton lines={4} height={12} />}
            {!adaptiveLoading && adaptiveInsights && (
              <>
                <div className="cards-list" style={{ marginBottom: 16 }}>
                  <div className="card">
                    <div className="caption">적응 강도</div>
                    <div className="title-lg">{adaptiveInsights.strengthScore}</div>
                  </div>
                  <div className="card">
                    <div className="caption">최근 적중률</div>
                    <div className="title-lg">{adaptiveInsights.baseHitRatePct}%</div>
                  </div>
                  <div className="card">
                    <div className="caption">평균 {adaptiveInsights.horizonBars}일 수익률</div>
                    <div className="title-lg" style={{ color: adaptiveInsights.baseAvgReturnPct >= 0 ? COLOR_POSITIVE : COLOR_NEGATIVE }}>
                      {adaptiveInsights.baseAvgReturnPct > 0 ? '+' : ''}{adaptiveInsights.baseAvgReturnPct}%
                    </div>
                  </div>
                  <div className="card">
                    <div className="caption">현재 우위 패턴</div>
                    <div className="title-md">{adaptiveInsights.todayBiasSummary}</div>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div>
                    <div className="caption" style={{ marginBottom: 8 }}>강화 중인 기준</div>
                    {adaptiveInsights.topPositiveFactors.length === 0 && <div className="muted">강화 기준 없음</div>}
                    {adaptiveInsights.topPositiveFactors.map((item) => (
                      <div key={`${item.key}-${item.factor}`} style={{ marginBottom: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                          <span style={{ fontWeight: 500 }}>{item.label}</span>
                          <span style={{ color: COLOR_POSITIVE, fontWeight: 600 }}>+{item.weight}</span>
                        </div>
                        <div className="caption">승률 {item.winRatePct}% · 평균 {item.avgForwardReturnPct > 0 ? '+' : ''}{item.avgForwardReturnPct}% · 샘플 {item.sampleCount}</div>
                      </div>
                    ))}
                  </div>
                  <div>
                    <div className="caption" style={{ marginBottom: 8 }}>약화 중인 기준</div>
                    {adaptiveInsights.topNegativeFactors.length === 0 && <div className="muted">약화 기준 없음</div>}
                    {adaptiveInsights.topNegativeFactors.map((item) => (
                      <div key={`${item.key}-${item.factor}`} style={{ marginBottom: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                          <span style={{ fontWeight: 500 }}>{item.label}</span>
                          <span style={{ color: COLOR_NEGATIVE, fontWeight: 600 }}>{item.weight}</span>
                        </div>
                        <div className="caption">승률 {item.winRatePct}% · 평균 {item.avgForwardReturnPct > 0 ? '+' : ''}{item.avgForwardReturnPct}% · 샘플 {item.sampleCount}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
            {!adaptiveLoading && !adaptiveInsights && <div className="muted">적응형 전략 데이터를 아직 계산하지 못했습니다.</div>}
          </div>

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
                  <div className="caption">자동 의사결정 비중</div>
                  <div className="title-lg">{summary.autoRatio}%</div>
                  <div className="muted">({summary.autoCount}건)</div>
                </div>
                <div className="card">
                  <div className="caption">매수 / 매도 횟수</div>
                  <div className="title-lg">{summary.buyCount} / {summary.sellCount}</div>
                </div>
              </div>

              <div className="cards-list mb-4">
                <div className="card">
                  <div className="title-md" style={{ marginBottom: 'var(--space-2)' }}>주요 트리거 빈도</div>
                  {summary.topTriggers.length === 0 && <div className="muted">데이터 없음</div>}
                  {summary.topTriggers.map(([trigger, count]) => {
                    const maxCount = summary.topTriggers[0]?.[1] ?? 1
                    const pct = Math.round((count / maxCount) * 100)
                    return (
                      <div key={trigger} style={{ marginBottom: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                          <span className="caption">{formatTriggerLabel(trigger)}</span>
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

                <div className="card">
                  <div className="title-md" style={{ marginBottom: 'var(--space-2)' }}>시장 국면 분포</div>
                  {summary.topRegimes.length === 0 && <div className="muted">데이터 없음</div>}
                  {summary.topRegimes.map(([regime, count]) => {
                    const maxCount = summary.topRegimes[0]?.[1] ?? 1
                    const pct = Math.round((count / maxCount) * 100)
                    return (
                      <div key={regime} style={{ marginBottom: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                          <span className="caption">{formatMarketRegimeLabel(regime)}</span>
                          <span className="caption">{count}건</span>
                        </div>
                        <div style={{ height: 5, background: 'var(--color-border-subtle)', borderRadius: 3 }}>
                          <div
                            style={{
                              height: '100%',
                              width: `${pct}%`,
                              background: COLOR_WARNING,
                              borderRadius: 3,
                              transition: 'width 0.4s',
                            }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>

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

      {tab === 'settings' && (
        <div className="cards-list">
          {settingsLoading && <div className="card"><Skeleton lines={5} height={14} /></div>}
          {!settingsLoading && (
            <>
              <div className="card">
                <div className="title-md" style={{ marginBottom: 'var(--space-3)' }}>운용 전략 선택</div>
                <div className="muted" style={{ marginBottom: 'var(--space-3)' }}>
                  시장 위험도와 현재 계좌 상황에 맞는 전략을 선택합니다. 변경 후 저장하면 다음 자동매매 사이클부터 적용됩니다.
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {STRATEGY_OPTIONS.map((option) => {
                    const isActive = String(settings?.selected_strategy || 'HOLD_SAFE').toUpperCase() === option.id
                    return (
                      <div
                        key={option.id}
                        onClick={() => setSettings({ ...settings, selected_strategy: option.id })}
                        style={{
                          padding: '14px 16px',
                          borderRadius: 'var(--radius-card)',
                          border: isActive ? `2px solid ${option.color}` : '1.5px solid var(--color-border-default)',
                          background: isActive ? `color-mix(in srgb, ${option.color} 8%, var(--color-surface-card))` : 'var(--color-surface-card)',
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
                            border: `2px solid ${option.color}`,
                            background: isActive ? option.color : 'transparent',
                            flexShrink: 0,
                          }}
                        />
                        <div>
                          <div style={{ fontWeight: 600, color: isActive ? option.color : 'inherit' }}>{option.label}</div>
                          <div className="muted" style={{ marginTop: 2 }}>{option.desc}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="card">
                <div className="title-md" style={{ marginBottom: 'var(--space-2)' }}>자동매매 제어</div>
                <Checkbox
                  label="자동매매 활성화"
                  checked={!!settings?.is_enabled}
                  onChange={(value) => setSettings({ ...settings, is_enabled: value })}
                />
                <div className="muted mt-2">비활성화하면 스케줄 실행 시 매매 없이 분석만 수행합니다.</div>
              </div>

              <div className="card">
                <div className="title-md" style={{ marginBottom: 'var(--space-3)' }}>퀀트 파라미터</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <Input
                    label="최소 매수 점수"
                    type="number"
                    value={settings?.min_buy_score ?? 72}
                    onChange={(e: any) => setSettings({ ...settings, min_buy_score: Number(e.target.value) })}
                  />
                  <Input
                    label="최대 보유 종목 수"
                    type="number"
                    value={settings?.max_positions ?? 10}
                    onChange={(e: any) => setSettings({ ...settings, max_positions: Number(e.target.value) })}
                  />
                  <Input
                    label="익절 (%)"
                    type="number"
                    value={settings?.take_profit_pct ?? 8}
                    onChange={(e: any) => setSettings({ ...settings, take_profit_pct: Number(e.target.value) })}
                  />
                  <Input
                    label="손절 (%)"
                    type="number"
                    value={settings?.stop_loss_pct ?? 4}
                    onChange={(e: any) => setSettings({ ...settings, stop_loss_pct: Number(e.target.value) })}
                  />
                  <Input
                    label="월요일 매수 슬롯"
                    type="number"
                    value={settings?.monday_buy_slots ?? 2}
                    onChange={(e: any) => setSettings({ ...settings, monday_buy_slots: Number(e.target.value) })}
                  />
                  <Input
                    label="장기 포지션 비중 (%)"
                    type="number"
                    value={settings?.long_term_ratio ?? 70}
                    onChange={(e: any) => setSettings({ ...settings, long_term_ratio: Number(e.target.value) })}
                  />
                </div>
                <div className="muted mt-2" style={{ fontSize: 'var(--font-size-sm)' }}>
                  최소 매수 점수는 스캔 컷오프, 익절·손절은 가상 자동매매 기준, 장기 포지션 비중은 장기 보유 목표 비율입니다.
                </div>
              </div>

              <div className="card">
                <div className="title-md" style={{ marginBottom: 'var(--space-3)' }}>고급 설정 — 동적 포지션 사이징</div>
                <Checkbox
                  label="동적 포지션 사이징 사용"
                  checked={!!settings?.use_dynamic_sizing}
                  onChange={(value) => setSettings({ ...settings, use_dynamic_sizing: value })}
                />
                <div className="muted mt-2" style={{ marginBottom: 'var(--space-3)' }}>
                  활성화하면 시장 국면(강세/약세/횡보)에 따라 최대 보유 종목 수가 자동으로 조정됩니다.
                </div>

                {settings?.use_dynamic_sizing && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, background: 'var(--color-bg-sunken)', padding: 12, borderRadius: 'var(--radius-sm)', marginBottom: 'var(--space-3)' }}>
                    <Input
                      label="기본 최대 종목 수 (base)"
                      type="number"
                      value={settings?.base_max_positions ?? 3}
                      onChange={(e: any) => setSettings({ ...settings, base_max_positions: Number(e.target.value) })}
                    />
                    <Input
                      label="강세장 배수 (×)"
                      type="number"
                      step="0.1"
                      value={settings?.bull_multiplier ?? 1.5}
                      onChange={(e: any) => setSettings({ ...settings, bull_multiplier: Number(e.target.value) })}
                    />
                    <Input
                      label="약세장 배수 (×)"
                      type="number"
                      step="0.1"
                      value={settings?.bear_multiplier ?? 0.5}
                      onChange={(e: any) => setSettings({ ...settings, bear_multiplier: Number(e.target.value) })}
                    />
                    <Input
                      label="최소 신뢰도 임계 (%)"
                      type="number"
                      value={settings?.min_confidence_pct ?? 65}
                      onChange={(e: any) => setSettings({ ...settings, min_confidence_pct: Number(e.target.value) })}
                    />
                  </div>
                )}

                <Checkbox
                  label="적응형 손익 조정 사용"
                  checked={!!settings?.use_adaptive_exit}
                  onChange={(value) => setSettings({ ...settings, use_adaptive_exit: value })}
                />
                <div className="muted mt-2">
                  활성화하면 변동성과 신호 신뢰도에 따라 손절·익절이 동적으로 조정됩니다.
                </div>
              </div>

              <div className="card">
                <div className="title-md" style={{ marginBottom: 'var(--space-3)' }}>각 전략별 동작 방식</div>
                
                {STRATEGY_OPTIONS.map((option) => (
                  <div
                    key={option.id}
                    style={{
                      marginBottom: 16,
                      paddingBottom: 16,
                      borderBottom: '1px solid var(--color-border-default)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <div
                        style={{
                          width: 12,
                          height: 12,
                          borderRadius: '50%',
                          background: option.color,
                        }}
                      />
                      <div style={{ fontWeight: 600 }}>{option.label}</div>
                    </div>
                    
                    {option.id === 'HOLD_SAFE' && (
                      <div className="muted" style={{ fontSize: 'var(--font-size-sm)', lineHeight: 1.6 }}>
                        <strong>기본 전략:</strong> 보수적 진입<br/>
                        <strong>권장 설정:</strong> 기본(base) 2~3종목 | 강세장 ×1.3 | 약세장 ×0.7<br/>
                        <strong>동작:</strong> 신뢰도 높은 신호만 진입. 강세장이면 3~4종목, 약세장이면 1~2종목으로 조정
                      </div>
                    )}
                    {option.id === 'REDUCE_TIGHT' && (
                      <div className="muted" style={{ fontSize: 'var(--font-size-sm)', lineHeight: 1.6 }}>
                        <strong>기본 전략:</strong> 신속한 리스크 관리<br/>
                        <strong>권장 설정:</strong> 기본(base) 1~2종목 | 강세장 ×2.0 | 약세장 ×0.3<br/>
                        <strong>동작:</strong> 좋은 신호에서만 과감하게. 강세장 확인 시 2~4종목까지 진입, 약세장은 진입 제한
                      </div>
                    )}
                    {option.id === 'WAIT_AND_DIP_BUY' && (
                      <div className="muted" style={{ fontSize: 'var(--font-size-sm)', lineHeight: 1.6 }}>
                        <strong>기본 전략:</strong> 기회 대기형<br/>
                        <strong>권장 설정:</strong> 기본(base) 1~2종목 | 강세장 ×1.5 | 약세장 ×0.2<br/>
                        <strong>동작:</strong> 높은 신뢰도만 진입. 강세 확정 후 분할 진입, 약세 지속 시 현금 보유
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="card">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Button variant="primary" onClick={saveSettings} disabled={saving}>
                    {saving ? '저장 중…' : '설정 저장'}
                  </Button>
                  {saveStatus && (
                    <span className="caption" style={{ color: saveStatus.startsWith('오류') ? COLOR_NEGATIVE : COLOR_POSITIVE }}>
                      {saveStatus}
                    </span>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'growth' && (
        <>
          <div className="card mb-4" style={{ borderLeft: '4px solid var(--color-brand)' }}>
            <div className="title-md" style={{ marginBottom: 8 }}>전략 성장 요약</div>
            {decLoading && <Skeleton lines={3} height={12} />}
            {!decLoading && rows.length > 0 && (() => {
              const firstDate = rows[rows.length - 1]?.created_at ? new Date(rows[rows.length - 1]!.created_at!).toLocaleDateString('ko-KR') : '-'
              const lastDate = rows[0]?.created_at ? new Date(rows[0]!.created_at!).toLocaleDateString('ko-KR') : '-'
              const uniqueRegimes = new Set(rows.map((row) => row.market_regime).filter(Boolean)).size
              const uniqueVersions = new Set(rows.map((row) => row.strategy_version).filter(Boolean)).size
              return (
                <div style={{ lineHeight: 1.7, color: 'var(--color-text-secondary)' }}>
                  <span>{firstDate}</span>부터 <span>{lastDate}</span>까지 <strong style={{ color: 'var(--color-text-primary)' }}>{summary.total}건</strong>의 의사결정이 누적되었습니다. 이 중 자동 시스템이 판단한 비중은 <strong style={{ color: 'var(--color-brand)' }}>{summary.autoRatio}%</strong>이며, <strong>{summary.buyCount}번</strong> 매수, <strong>{summary.sellCount}번</strong> 매도가 이루어졌습니다.
                  {uniqueVersions > 0 && <> 총 <strong>{uniqueVersions}개</strong>의 전략 버전이 관측되었고,</>}
                  {uniqueRegimes > 0 && <> <strong>{uniqueRegimes}가지</strong> 시장 국면을 경험했습니다.</>}
                  {' '}주요 판단 트리거는 <strong>{formatTriggerLabel(summary.topTriggers[0]?.[0] || '-')}</strong>{summary.topTriggers[0] ? `(${summary.topTriggers[0][1]}건)` : ''}입니다.
                </div>
              )
            })()}
            {!decLoading && rows.length === 0 && <div className="muted">아직 데이터가 없습니다. 자동매매가 실행되면 기록이 쌓입니다.</div>}
          </div>

          {!adaptiveLoading && adaptiveInsights && (
            <div className="card mb-4">
              <div className="title-md" style={{ marginBottom: 8 }}>실시간 적응 메모</div>
              <div style={{ lineHeight: 1.7, color: 'var(--color-text-secondary)' }}>
                최근 {adaptiveInsights.sampleCount}개 샘플을 기준으로 <strong style={{ color: 'var(--color-text-primary)' }}>{adaptiveInsights.todayBiasSummary}</strong> 패턴이 상대적으로 우세합니다. 현재 엔진은 상위 강화 기준을 스캔/하이라이트 정렬에 반영하고 있으며, 최근 {adaptiveInsights.horizonBars}거래일 평균 성과는 <strong style={{ color: adaptiveInsights.baseAvgReturnPct >= 0 ? COLOR_POSITIVE : COLOR_NEGATIVE }}>{adaptiveInsights.baseAvgReturnPct > 0 ? '+' : ''}{adaptiveInsights.baseAvgReturnPct}%</strong>, 적중률은 <strong style={{ color: 'var(--color-text-primary)' }}>{adaptiveInsights.baseHitRatePct}%</strong>입니다.
              </div>
            </div>
          )}

          <div className="card mb-4">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', marginBottom: 'var(--space-2)', flexWrap: 'wrap' }}>
              <div>
                <div className="title-md">실현손익 추이</div>
                <div className="muted" style={{ marginTop: 4, fontSize: 'var(--font-size-sm)' }}>최근 매도 거래를 기준으로 누적 실현손익 흐름을 단순 선형 차트로 보여줍니다.</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div className="caption">현재 누적 실현손익</div>
                <div className="title-md" style={{ color: profitTrend.lastValue >= 0 ? COLOR_POSITIVE : COLOR_NEGATIVE }}>{formatKrwShort(profitTrend.lastValue)}</div>
              </div>
            </div>
            {activityLoading && <Skeleton lines={4} height={12} />}
            {!activityLoading && profitTrend.points.length === 0 && <div className="muted">실현손익 차트를 그릴 매도 데이터가 아직 없습니다.</div>}
            {!activityLoading && profitTrend.points.length > 0 && (
              <div>
                <svg viewBox="0 0 560 168" style={{ maxWidth: 720, width: '100%', height: 'auto', display: 'block', marginLeft: 'auto', marginRight: 'auto' }} aria-label="실현손익 추이 차트" role="img">
                  {/* 구간별 배경색 */}
                  {profitTrend.fillSegments.map((seg, idx) => {
                    if (profitTrend.points.length < 2) return null
                    const p1 = profitTrend.points[seg.start]
                    const p2 = profitTrend.points[seg.end]
                    if (!p1 || !p2) return null
                    return (
                      <rect
                        key={`fill-${idx}`}
                        x={Math.min(p1.x, p2.x) - 2}
                        y="12"
                        width={Math.abs(p2.x - p1.x) + 4}
                        height="144"
                        fill={seg.color}
                        opacity="0.4"
                      />
                    )
                  })}
                  {/* 기준선 */}
                  <line x1="18" x2="542" y1={profitTrend.baselineY} y2={profitTrend.baselineY} stroke="var(--color-border-subtle)" strokeDasharray="4 4" strokeWidth="0.8" />
                  {/* 이동평균선 (회색 점선) */}
                  <path
                    d={profitTrend.maPath}
                    fill="none"
                    stroke="var(--chart-ma-line)"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray="4 2"
                  />
                  {/* 예상 추세선 (보라색 점선) */}
                  {profitTrend.projectionPoints.length > 0 && (
                    <path
                      d={buildLinePath([profitTrend.points[profitTrend.points.length - 1]!, ...profitTrend.projectionPoints])}
                      fill="none"
                      stroke="var(--chart-projection-line)"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeDasharray="5 4"
                    />
                  )}
                  {/* 구간별 색상 세그먼트 메인 라인 */}
                  {profitTrend.segments.map((seg, idx) => (
                    <line
                      key={`seg-${idx}`}
                      x1={seg.x1} y1={seg.y1} x2={seg.x2} y2={seg.y2}
                      stroke={seg.color}
                      strokeWidth="3"
                      strokeLinecap="round"
                    />
                  ))}
                  {/* 데이터 포인트 (개별 색상) */}
                  {profitTrend.points.map((point) => (
                    <g key={point.id}>
                      <circle cx={point.x} cy={point.y} r="4" fill="white" stroke={point.value >= 0 ? COLOR_POSITIVE : COLOR_NEGATIVE} strokeWidth="2" style={{ cursor: 'pointer' }} />
                      <title>{`${point.label} · ${point.date} · ${formatKrwShort(point.value)}`}</title>
                    </g>
                  ))}
                </svg>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 8, fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)' }}>
                  <span>{profitTrend.points[0]?.date || '-'}</span>
                  <span style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}><span style={{ display: 'inline-block', width: 14, height: 3, background: COLOR_POSITIVE, borderRadius: 2 }} /> 실현손익</span>
                    <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}><span style={{ display: 'inline-block', width: 14, height: 2, background: 'var(--chart-ma-line)', backgroundImage: 'repeating-linear-gradient(90deg, var(--chart-ma-line) 0px, var(--chart-ma-line) 4px, transparent 4px, transparent 6px)' }} /> 이동평균</span>
                    {profitTrend.projectionPoints.length > 0 && <span style={{ display: 'flex', gap: 4, alignItems: 'center' }}><span style={{ display: 'inline-block', width: 14, height: 2, background: 'var(--chart-projection-line)', backgroundImage: 'repeating-linear-gradient(90deg, var(--chart-projection-line) 0px, var(--chart-projection-line) 5px, transparent 5px, transparent 9px)' }} /> 예상 추세</span>}
                  </span>
                  <span>{profitTrend.points[profitTrend.points.length - 1]?.date || '-'}</span>
                </div>
              </div>
            )}
          </div>

          {!activityLoading && profitTrend.tradeBars.length > 0 && (
            <div className="card mb-4">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', marginBottom: 'var(--space-2)', flexWrap: 'wrap' }}>
                <div>
                  <div className="title-md">거래별 손익 분포</div>
                  <div className="muted" style={{ marginTop: 4, fontSize: 'var(--font-size-sm)' }}>각 매도 거래의 개별 실현손익. 초록=수익, 빨강=손실</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="caption">전체 승률</div>
                  <div className="title-md" style={{ color: profitTrend.tradeBars.filter((b) => b.isPositive).length / profitTrend.tradeBars.length >= 0.5 ? COLOR_POSITIVE : COLOR_NEGATIVE }}>
                    {Math.round((profitTrend.tradeBars.filter((b) => b.isPositive).length / profitTrend.tradeBars.length) * 100)}%
                  </div>
                </div>
              </div>
              <svg viewBox="0 0 560 80" style={{ width: '100%', height: 'auto', display: 'block' }} aria-label="거래별 손익 바 차트">
                <line x1="10" x2="550" y1="44" y2="44" stroke="var(--color-border-subtle)" strokeWidth="0.8" />
                {profitTrend.tradeBars.map((bar, idx) => (
                  <g key={idx}>
                    <rect
                      x={bar.x - bar.barW / 2}
                      y={bar.rectY}
                      width={bar.barW}
                      height={bar.barH}
                      fill={bar.isPositive ? COLOR_POSITIVE : COLOR_NEGATIVE}
                      opacity="0.8"
                      rx="2"
                    />
                    <title>{`${bar.label} · ${bar.date} · ${formatKrwShort(bar.amount)}`}</title>
                  </g>
                ))}
              </svg>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginTop: 4 }}>
                <span>{profitTrend.tradeBars[0]?.date || '-'}</span>
                <span>{profitTrend.tradeBars[profitTrend.tradeBars.length - 1]?.date || '-'}</span>
              </div>
            </div>
          )}

          {!activityLoading && rollingWinRate.points.length > 0 && (
            <div className="card mb-4">
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', marginBottom: 'var(--space-2)', flexWrap: 'wrap' }}>
                <div>
                  <div className="title-md">롤링 승률 추이</div>
                  <div className="muted" style={{ marginTop: 4, fontSize: 'var(--font-size-sm)' }}>최근 거래 묶음 기준 승률 변화. 50% 위면 수익 우세</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="caption">평균 승률</div>
                  <div className="title-md" style={{ color: rollingWinRate.avgWinRate >= 50 ? COLOR_POSITIVE : COLOR_NEGATIVE }}>{rollingWinRate.avgWinRate}%</div>
                </div>
              </div>
              <svg viewBox="0 0 560 60" style={{ width: '100%', height: 'auto', display: 'block' }} aria-label="롤링 승률 차트">
                <line x1="18" x2="542" y1="30" y2="30" stroke="var(--color-border-subtle)" strokeDasharray="4 4" strokeWidth="0.8" />
                <path
                  d={rollingWinRate.path}
                  fill="none"
                  stroke={rollingWinRate.avgWinRate >= 50 ? COLOR_POSITIVE : COLOR_NEGATIVE}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {rollingWinRate.points.map((pt, idx) => (
                  <g key={idx}>
                    <circle cx={pt.x} cy={pt.y} r="3.5" fill="white" stroke={pt.winRate >= 50 ? COLOR_POSITIVE : COLOR_NEGATIVE} strokeWidth="1.5" />
                    <title>{`승률 ${pt.winRate}%`}</title>
                  </g>
                ))}
              </svg>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginTop: 4 }}>
                <span style={{ color: COLOR_POSITIVE }}>↑ 수익 우세</span>
                <span>50% 기준선</span>
                <span style={{ color: COLOR_NEGATIVE }}>손실 우세 ↓</span>
              </div>
            </div>
          )}

          <div className="card mb-4">
            <div className="title-md" style={{ marginBottom: 'var(--space-2)' }}>전략 & 국면 전환 타임라인</div>
            <div className="muted" style={{ marginBottom: 12, fontSize: 'var(--font-size-sm)' }}>전략 버전 또는 시장 국면이 바뀐 시점을 시간 순으로 표시합니다.</div>
            {decLoading && <Skeleton lines={5} height={12} />}
            {!decLoading && growthTimeline.length === 0 && <div className="muted">감지된 전환 없음</div>}
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
                    background: item.kind === 'version' ? 'var(--color-brand)' : COLOR_WARNING,
                    marginTop: 4,
                    flexShrink: 0,
                  }}
                />
                <div>
                  <div style={{ fontWeight: 500 }}>{item.text}</div>
                  <div className="caption" style={{ marginTop: 2 }}>{item.subtitle}</div>
                  <div className="muted" style={{ fontSize: 'var(--font-size-xs)', marginTop: 2 }}>{item.time}</div>
                </div>
              </div>
            ))}
          </div>

          {!decLoading && summary.topTriggers.length > 0 && (
            <div className="card">
              <div className="title-md" style={{ marginBottom: 'var(--space-2)' }}>누적 트리거 분포</div>
              <div className="muted" style={{ marginBottom: 12, fontSize: 'var(--font-size-sm)' }}>어떤 조건에 의해 매매가 결정되었는지 누적 빈도를 보여줍니다.</div>
              {summary.topTriggers.map(([trigger, count]) => {
                const maxCount = summary.topTriggers[0]?.[1] ?? 1
                const pct = Math.round((count / maxCount) * 100)
                return (
                  <div key={trigger} style={{ marginBottom: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>{formatTriggerLabel(trigger)}</span>
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
