import React, { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../../lib/api'
import Button from '../../components/ui/Button'
import ForwardTestPanel from './ForwardTestPanel'
import OverviewTab from './components/OverviewTab'
import SettingsTab from './components/SettingsTab'
import GrowthTab from './components/GrowthTab'
import { STRATEGY_OPTIONS } from './constants'
import type {
  ActivityRow,
  AdaptiveInsights,
  AutoTradeSettings,
  DecisionRow,
  PreRallyReport,
  PreRallySortKey,
  Tab,
} from './types'
import { sortPreRallyPatterns } from './lib/preRally'
import { summarizeDecisions } from './lib/decisionSummary'
import { buildGrowthTimeline } from './lib/growthTimeline'
import { buildProfitTrend } from './lib/profitTrend'
import { buildRollingWinRate } from './lib/rollingWinRate'

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
  const [preRallyReport, setPreRallyReport] = useState<PreRallyReport | null>(null)
  const [preRallyLoading, setPreRallyLoading] = useState(true)
  const [preRallyHorizon, setPreRallyHorizon] = useState<20 | 40 | 60>(40)
  const [preRallySortKey, setPreRallySortKey] = useState<PreRallySortKey>('lift')
  const [preRallyInvestManwon, setPreRallyInvestManwon] = useState<number>(500)

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

  const loadPreRallyReport = async (horizon: number) => {
    setPreRallyLoading(true)
    try {
      const res = await apiFetch(`/api/ui/pre-rally-patterns?horizon=${horizon}`, { cacheMs: 60_000, timeoutMs: 20_000 })
      setPreRallyReport((res?.data ?? null) as PreRallyReport | null)
    } catch {
      setPreRallyReport(null)
    } finally {
      setPreRallyLoading(false)
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

  useEffect(() => {
    void loadPreRallyReport(preRallyHorizon)
  }, [preRallyHorizon])

  const sortedPreRallyPatterns = useMemo(
    () => sortPreRallyPatterns(preRallyReport?.stablePatterns ?? [], preRallySortKey),
    [preRallyReport, preRallySortKey],
  )

  const summary = useMemo(() => summarizeDecisions(rows), [rows])

  const growthTimeline = useMemo(() => buildGrowthTimeline(rows), [rows])

  const currentStrategyInfo = useMemo(() => {
    const id = String(settings?.selected_strategy || 'HOLD_SAFE').toUpperCase()
    return STRATEGY_OPTIONS.find((item) => item.id === id) ?? STRATEGY_OPTIONS[0]
  }, [settings])

  const profitTrend = useMemo(() => buildProfitTrend(activityRows), [activityRows])

  const rollingWinRate = useMemo(() => buildRollingWinRate(activityRows), [activityRows])

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
            void loadPreRallyReport(preRallyHorizon)
          }}
          disabled={decLoading || settingsLoading || activityLoading || adaptiveLoading || preRallyLoading}
        >
          새로고침
        </Button>
      </div>

      <ForwardTestPanel />

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
        <OverviewTab
          rows={rows}
          decLoading={decLoading}
          decError={decError}
          loadDecisions={loadDecisions}
          settings={settings}
          settingsLoading={settingsLoading}
          adaptiveInsights={adaptiveInsights}
          adaptiveLoading={adaptiveLoading}
          preRallyReport={preRallyReport}
          preRallyLoading={preRallyLoading}
          preRallyHorizon={preRallyHorizon}
          setPreRallyHorizon={setPreRallyHorizon}
          preRallySortKey={preRallySortKey}
          setPreRallySortKey={setPreRallySortKey}
          preRallyInvestManwon={preRallyInvestManwon}
          setPreRallyInvestManwon={setPreRallyInvestManwon}
          sortedPreRallyPatterns={sortedPreRallyPatterns}
          summary={summary}
          currentStrategyInfo={currentStrategyInfo}
        />
      )}

      {tab === 'settings' && (
        <SettingsTab
          settings={settings}
          settingsLoading={settingsLoading}
          setSettings={setSettings}
          saving={saving}
          saveStatus={saveStatus}
          saveSettings={saveSettings}
        />
      )}

      {tab === 'growth' && (
        <GrowthTab
          rows={rows}
          decLoading={decLoading}
          activityLoading={activityLoading}
          adaptiveInsights={adaptiveInsights}
          adaptiveLoading={adaptiveLoading}
          summary={summary}
          growthTimeline={growthTimeline}
          profitTrend={profitTrend}
          rollingWinRate={rollingWinRate}
        />
      )}
    </section>
  )
}
