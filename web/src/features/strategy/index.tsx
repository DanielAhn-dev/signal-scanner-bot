import React, { useMemo, useState } from 'react'
import Button from '../../components/ui/Button'
import ForwardTestPanel from './components/ForwardTestPanel'
import OverviewTab from './components/OverviewTab'
import SettingsTab from './components/SettingsTab'
import GrowthTab from './components/GrowthTab'
import { STRATEGY_OPTIONS } from './constants'
import { useActivity } from './hooks/useActivity'
import { useAdaptiveInsights } from './hooks/useAdaptiveInsights'
import { useAutoTradeSettings } from './hooks/useAutoTradeSettings'
import { useDecisions } from './hooks/useDecisions'
import { usePreRallyReport } from './hooks/usePreRallyReport'
import type { Tab } from './types'
import { summarizeDecisions } from './lib/decisionSummary'
import { buildGrowthTimeline } from './lib/growthTimeline'
import { buildProfitTrend } from './lib/profitTrend'
import { buildRollingWinRate } from './lib/rollingWinRate'

export default function StrategyPage() {
  const [tab, setTab] = useState<Tab>('overview')
  const { rows, loading: decLoading, error: decError, load: loadDecisions } = useDecisions()
  const {
    settings,
    setSettings,
    loading: settingsLoading,
    saving,
    saveStatus,
    load: loadSettings,
    save: saveSettings,
  } = useAutoTradeSettings()
  const { rows: activityRows, loading: activityLoading, load: loadActivity } = useActivity()
  const { insights: adaptiveInsights, loading: adaptiveLoading, load: loadAdaptiveInsights } = useAdaptiveInsights()
  const {
    report: preRallyReport,
    loading: preRallyLoading,
    horizon: preRallyHorizon,
    setHorizon: setPreRallyHorizon,
    sortKey: preRallySortKey,
    setSortKey: setPreRallySortKey,
    investManwon: preRallyInvestManwon,
    setInvestManwon: setPreRallyInvestManwon,
    sortedPatterns: sortedPreRallyPatterns,
    load: loadPreRallyReport,
  } = usePreRallyReport()

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
