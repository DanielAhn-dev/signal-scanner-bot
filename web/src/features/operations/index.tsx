import React, { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import Button from '../../components/ui/Button'
import { useToast } from '../../components/ToastProvider'
import { useAutoRuns } from './hooks/useAutoRuns'
import { useJobWatcher } from './hooks/useJobWatcher'
import { useOperationsData } from './hooks/useOperationsData'
import TradeNowCard from './components/TradeNowCard'
import DryRunBanner from './components/DryRunBanner'
import KpiCards from './components/KpiCards'
import LiveJobsCard from './components/LiveJobsCard'
import DryRunApprovalCard from './components/DryRunApprovalCard'
import ActivityList from './components/ActivityList'
import LearningRunCard from './components/LearningRunCard'
import SellCheckCard from './components/SellCheckCard'
import InsightsCard from './components/InsightsCard'
import DryRunModal from './components/DryRunModal'

export default function OperationsPage() {
  const toast = useToast()

  // 화면 안에서만 쓰는 상태(인사이트 탭·필터·고급 진단 토글)
  const [insightTab, setInsightTab] = useState<'summary' | 'details'>('summary')
  const [expandedInsightRunIds, setExpandedInsightRunIds] = useState<number[]>([])
  const [latestCompareDecisionFilter, setLatestCompareDecisionFilter] = useState<'ALL' | 'BUY' | 'SKIP' | 'HOLD' | 'SELL' | 'ERROR'>('ALL')
  const [latestReasonCategoryFilter, setLatestReasonCategoryFilter] = useState<string>('ALL')
  const [runCompareDecisionFilterById, setRunCompareDecisionFilterById] = useState<Record<number, 'ALL' | 'BUY' | 'SKIP' | 'HOLD' | 'SELL' | 'ERROR'>>({})
  const [showAdvanced, setShowAdvanced] = useState(false)

  // 훅 호출 순서 = 효과 실행 순서: 조회 3종(마운트) → 작업 감시(폴링)
  const {
    activity, activityLoading, loadActivity, dashboardKpi, dashboardLoading, loadDashboard,
    autocycleInsights, autocycleInsightsLoading, loadAutoCycleInsights,
    sellCandidates, sellLoading, sellFetched, fetchSellCandidates,
  } = useOperationsData(toast)
  const {
    pendingDryRunApproval, setPendingDryRunApproval, bannerDismissedForJobId, setBannerDismissedForJobId,
    watchingJobIds, addWatchingJob, refreshJobSnapshot, liveJobItems,
    setSelectedDryRunJobId, selectedDryRunSnapshot, expandedJobIds, setExpandedJobIds,
  } = useJobWatcher({ loadActivity, loadDashboard, loadAutoCycleInsights, toast })
  const {
    autocycleStatus, autotriggerStatus, autotriggerStep, setAutotriggerStep, autotriggerResult,
    runAutocycle, runAutotrigger, retryJob,
  } = useAutoRuns({ toast, addWatchingJob, refreshJobSnapshot, setPendingDryRunApproval, setBannerDismissedForJobId })

  const showStickyDryRunBanner = Boolean(
    pendingDryRunApproval
    && pendingDryRunApproval.jobId !== bannerDismissedForJobId
  )

  return (
    <section className="container-app operations-page">
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <h1 className="title-xl">운영 패널</h1>
        <p className="muted">지금 매매를 확인하고, 실행 상태와 최근 체결을 빠르게 따라갑니다.</p>
      </div>

      {/* 지금 매매 체크 — 핵심 CTA를 최상단으로 */}
      <TradeNowCard
        autotriggerStatus={autotriggerStatus}
        autotriggerStep={autotriggerStep}
        setAutotriggerStep={setAutotriggerStep}
        autotriggerResult={autotriggerResult}
        runAutotrigger={runAutotrigger}
      />

      {showStickyDryRunBanner && pendingDryRunApproval && (
        <DryRunBanner
          autocycleStatus={autocycleStatus}
          runAutocycle={runAutocycle}
          pendingDryRunApproval={pendingDryRunApproval}
          setBannerDismissedForJobId={setBannerDismissedForJobId}
          setSelectedDryRunJobId={setSelectedDryRunJobId}
        />
      )}

      <KpiCards
        dashboardKpi={dashboardKpi}
        dashboardLoading={dashboardLoading}
      />

      <LiveJobsCard
        autocycleStatus={autocycleStatus}
        autotriggerStatus={autotriggerStatus}
        setSelectedDryRunJobId={setSelectedDryRunJobId}
        liveJobItems={liveJobItems}
        watchingJobIds={watchingJobIds}
        refreshJobSnapshot={refreshJobSnapshot}
        expandedJobIds={expandedJobIds}
        setExpandedJobIds={setExpandedJobIds}
        retryJob={retryJob}
      />

      {pendingDryRunApproval && (
        <DryRunApprovalCard
          autocycleStatus={autocycleStatus}
          runAutocycle={runAutocycle}
          pendingDryRunApproval={pendingDryRunApproval}
          setPendingDryRunApproval={setPendingDryRunApproval}
        />
      )}

      {/* 최근 실행 이력 */}
      <ActivityList
        activity={activity}
        activityLoading={activityLoading}
        loadActivity={loadActivity}
      />

      {/* 고급 진단 — 검증/디버깅용 지표. 기본 접힘. 일상적인 매매 팔로우에는 필요 없음 */}
      <div style={{ marginBottom: 'var(--space-3)' }}>
        <Button variant="ghost" onClick={() => setShowAdvanced((v) => !v)}>
          {showAdvanced ? <>고급 진단 접기 <ChevronUp size={14} aria-hidden /></> : <>고급 진단 보기 (실행 인사이트 · 자동매도 점검 · 학습 실행) <ChevronDown size={14} aria-hidden /></>}
        </Button>
      </div>

      {showAdvanced && (
        <>
          <LearningRunCard
            autocycleStatus={autocycleStatus}
            runAutocycle={runAutocycle}
          />

          <SellCheckCard
            sellCandidates={sellCandidates}
            sellLoading={sellLoading}
            sellFetched={sellFetched}
            fetchSellCandidates={fetchSellCandidates}
          />

          <InsightsCard
            autocycleInsights={autocycleInsights}
            autocycleInsightsLoading={autocycleInsightsLoading}
            loadAutoCycleInsights={loadAutoCycleInsights}
            insightTab={insightTab}
            setInsightTab={setInsightTab}
            expandedInsightRunIds={expandedInsightRunIds}
            setExpandedInsightRunIds={setExpandedInsightRunIds}
            latestCompareDecisionFilter={latestCompareDecisionFilter}
            setLatestCompareDecisionFilter={setLatestCompareDecisionFilter}
            latestReasonCategoryFilter={latestReasonCategoryFilter}
            setLatestReasonCategoryFilter={setLatestReasonCategoryFilter}
            runCompareDecisionFilterById={runCompareDecisionFilterById}
            setRunCompareDecisionFilterById={setRunCompareDecisionFilterById}
          />
        </>
      )}

      <DryRunModal
        setSelectedDryRunJobId={setSelectedDryRunJobId}
        selectedDryRunSnapshot={selectedDryRunSnapshot}
      />
    </section>
  )
}
