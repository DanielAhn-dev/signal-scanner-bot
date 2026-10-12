import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { apiFetch } from '../../lib/api'
import Button from '../../components/ui/Button'
import { useToast } from '../../components/ToastProvider'
import type {
  AutoCycleInsights,
  JobSnapshot,
  OperationsKpi,
  OpStatus,
  SellCandidate,
  TradeRow,
} from './types'
import { normalizeJobState, normalizeStep, renderRunSummary } from './lib/jobs'
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

  const [activity, setActivity] = useState<TradeRow[]>([])
  const [activityLoading, setActivityLoading] = useState(true)

  const [sellCandidates, setSellCandidates] = useState<SellCandidate[]>([])
  const [sellLoading, setSellLoading] = useState(false)
  const [sellFetched, setSellFetched] = useState(false)

  const [autocycleStatus, setAutocycleStatus] = useState<OpStatus>('idle')
  const [autocycleResult, setAutocycleResult] = useState<string | null>(null)
  const [pendingDryRunApproval, setPendingDryRunApproval] = useState<{ jobId: string; summary: string } | null>(null)
  const [bannerDismissedForJobId, setBannerDismissedForJobId] = useState<string | null>(null)

  const [autotriggerStatus, setAutotriggerStatus] = useState<OpStatus>('idle')
  const [autotriggerStep, setAutotriggerStep] = useState<'intraday' | 'ready'>('intraday')
  const [autotriggerResult, setAutotriggerResult] = useState<string | null>(null)

  const [liveJobs, setLiveJobs] = useState<Record<string, JobSnapshot>>({})
  const [watchingJobIds, setWatchingJobIds] = useState<string[]>([])
  const [selectedDryRunJobId, setSelectedDryRunJobId] = useState<string | null>(null)
  const [expandedJobIds, setExpandedJobIds] = useState<string[]>([])

  const [dashboardKpi, setDashboardKpi] = useState<OperationsKpi | null>(null)
  const [dashboardLoading, setDashboardLoading] = useState(true)
  const [autocycleInsights, setAutocycleInsights] = useState<AutoCycleInsights | null>(null)
  const [autocycleInsightsLoading, setAutocycleInsightsLoading] = useState(true)
  const [insightTab, setInsightTab] = useState<'summary' | 'details'>('summary')
  const [expandedInsightRunIds, setExpandedInsightRunIds] = useState<number[]>([])
  const [latestCompareDecisionFilter, setLatestCompareDecisionFilter] = useState<'ALL' | 'BUY' | 'SKIP' | 'HOLD' | 'SELL' | 'ERROR'>('ALL')
  const [latestReasonCategoryFilter, setLatestReasonCategoryFilter] = useState<string>('ALL')
  const [runCompareDecisionFilterById, setRunCompareDecisionFilterById] = useState<Record<number, 'ALL' | 'BUY' | 'SKIP' | 'HOLD' | 'SELL' | 'ERROR'>>({})
  const [showAdvanced, setShowAdvanced] = useState(false)

  const loadActivity = useCallback(async () => {
    setActivityLoading(true)
    try {
      const json = await apiFetch('/api/ui/operations?view=activity', { cacheMs: 0, timeoutMs: 15_000 })
      setActivity(Array.isArray(json?.data) ? json.data : [])
    } catch (e: any) {
      toast.show('이력 조회 실패: ' + String(e?.message || e))
    } finally {
      setActivityLoading(false)
    }
  }, [toast])

  useEffect(() => { loadActivity() }, [loadActivity])

  const loadDashboard = useCallback(async () => {
    setDashboardLoading(true)
    try {
      const json = await apiFetch('/api/ui/operations?view=dashboard', { cacheMs: 0, timeoutMs: 15_000 })
      setDashboardKpi((json?.data || null) as OperationsKpi | null)
    } catch (e: any) {
      toast.show('운영 KPI 조회 실패: ' + String(e?.message || e))
    } finally {
      setDashboardLoading(false)
    }
  }, [toast])

  useEffect(() => { loadDashboard() }, [loadDashboard])

  const loadAutoCycleInsights = useCallback(async () => {
    setAutocycleInsightsLoading(true)
    try {
      const json = await apiFetch('/api/ui/operations?view=autocycle_insights', { cacheMs: 0, timeoutMs: 15_000 })
      setAutocycleInsights((json?.data || null) as AutoCycleInsights | null)
    } catch (e: any) {
      toast.show('자동매매 인사이트 조회 실패: ' + String(e?.message || e))
    } finally {
      setAutocycleInsightsLoading(false)
    }
  }, [toast])

  useEffect(() => { void loadAutoCycleInsights() }, [loadAutoCycleInsights])

  const addWatchingJob = useCallback((jobId: string) => {
    setWatchingJobIds(prev => (prev.includes(jobId) ? prev : [...prev, jobId]))
  }, [])

  const refreshJobSnapshot = useCallback(async (jobId: string, silent = false) => {
    try {
      const json = await apiFetch(`/api/ui/operations?view=job&job_id=${encodeURIComponent(jobId)}`, {
        cacheMs: 0,
        timeoutMs: 15_000,
      })
      const snapshot = (json?.data || null) as JobSnapshot | null
      if (!snapshot?.job) return

      setLiveJobs(prev => ({ ...prev, [jobId]: snapshot }))

      const state = normalizeJobState(snapshot.job.status)
      if (state === 'done' || state === 'failed') {
        setWatchingJobIds(prev => prev.filter(id => id !== jobId))
        setTimeout(loadActivity, 500)
        setTimeout(loadDashboard, 600)
        setTimeout(loadAutoCycleInsights, 700)

        if (state === 'failed' && !silent) {
          toast.show(`작업 실패: ${snapshot.job.error || '원인 미상'}`)
        }

        const payload = snapshot.job.payload || {}
        const isAutocycleDryRun = String(payload.task || '') === 'virtualAutoTrade' && payload.dry_run !== false
        if (state === 'done' && isAutocycleDryRun) {
          setPendingDryRunApproval(prev => {
            if (prev?.jobId === jobId) return prev
            return { jobId, summary: renderRunSummary(snapshot.latest_run) }
          })
        }
      }
    } catch (e: any) {
      if (!silent) {
        toast.show('실시간 상태 조회 실패: ' + String(e?.message || e))
      }
    }
  }, [loadActivity, loadAutoCycleInsights, loadDashboard, toast])

  useEffect(() => {
    if (watchingJobIds.length === 0) return
    const timer = window.setInterval(() => {
      for (const jobId of watchingJobIds) {
        void refreshJobSnapshot(jobId, true)
      }
    }, 2000)
    return () => window.clearInterval(timer)
  }, [refreshJobSnapshot, watchingJobIds])

  const fetchSellCandidates = async () => {
    setSellLoading(true)
    setSellFetched(false)
    try {
      const json = await apiFetch('/api/ui/operations?view=autosellcheck', { cacheMs: 0, timeoutMs: 15_000 })
      setSellCandidates(Array.isArray(json?.data) ? json.data : [])
      setSellFetched(true)
    } catch (e: any) {
      toast.show('자동매도 점검 실패: ' + String(e?.message || e))
    } finally {
      setSellLoading(false)
    }
  }

  const runAutocycle = async (dryRun: boolean, learning = false) => {
    setAutocycleStatus('loading')
    setAutocycleResult(null)
    try {
      const json = await apiFetch('/api/ui/operations', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 60_000,
        body: JSON.stringify({
          mode: 'autocycle',
          dry_run: dryRun,
          trigger_mode: learning ? 'learning' : 'auto',
        }),
      })
      if (json?.error) throw new Error(String(json.error))
      const jobId = String(json?.job_id || '').trim()
      if (!jobId) throw new Error('job_id가 비어 있습니다.')
      const label = `${learning ? '학습 ' : ''}${dryRun ? '점검(dry-run)' : '실행'}`
      if (json?.execution_error) {
        setAutocycleResult(`자동사이클 ${label} 실행 실패 - ${String(json.execution_error)}`)
        setAutocycleStatus('error')
      } else {
        setAutocycleResult(`자동사이클 ${label} 요청 등록 완료 - job_id: ${jobId}`)
        setAutocycleStatus('done')
      }
      if (!dryRun) setPendingDryRunApproval(null)
      if (dryRun && !learning) setBannerDismissedForJobId(null)
      addWatchingJob(jobId)
      void refreshJobSnapshot(jobId, false)
      toast.show(`자동사이클 ${label} 등록 완료`)
    } catch (e: any) {
      setAutocycleResult(String(e?.message || e))
      setAutocycleStatus('error')
    }
  }

  const runAutotrigger = async (stepOverride?: 'intraday' | 'ready') => {
    const stepToRun = stepOverride || autotriggerStep
    setAutotriggerStatus('loading')
    setAutotriggerResult(null)
    try {
      const json = await apiFetch('/api/ui/operations', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 60_000,
        body: JSON.stringify({ mode: 'autotrigger', step: stepToRun, dry_run: true }),
      })
      if (json?.error) throw new Error(String(json.error))
      const jobId = String(json?.job_id || '').trim()
      if (!jobId) throw new Error('job_id가 비어 있습니다.')
      if (json?.execution_error) {
        setAutotriggerResult(`순차트리거(${stepToRun}) 실행 실패 - ${String(json.execution_error)}`)
        setAutotriggerStatus('error')
      } else {
        setAutotriggerResult(`순차트리거(${stepToRun}) 요청 등록 완료 - job_id: ${jobId}`)
        setAutotriggerStatus('done')
      }
      addWatchingJob(jobId)
      void refreshJobSnapshot(jobId, false)
      toast.show('순차트리거 등록 완료')
    } catch (e: any) {
      setAutotriggerResult(String(e?.message || e))
      setAutotriggerStatus('error')
    }
  }

  const liveJobItems = useMemo(() => {
    return Object.values(liveJobs).sort((a, b) => {
      const left = Date.parse(String(a?.job?.created_at || '')) || 0
      const right = Date.parse(String(b?.job?.created_at || '')) || 0
      return right - left
    })
  }, [liveJobs])

  const selectedDryRunSnapshot = useMemo(() => {
    if (!selectedDryRunJobId) return null
    return liveJobs[selectedDryRunJobId] || null
  }, [liveJobs, selectedDryRunJobId])

  const retryJob = useCallback(async (snapshot: JobSnapshot) => {
    const payload = snapshot.job.payload || {}
    const task = String(payload.task || '')
    if (task === 'virtualAutoTrade') {
      const dryRun = payload.dry_run !== false
      await runAutocycle(dryRun, String(payload.trigger_mode || '').toLowerCase() === 'learning')
      return
    }
    if (task === 'virtualAutoTradeIntraday') {
      const step = normalizeStep(payload.step)
      setAutotriggerStep(step)
      await runAutotrigger(step)
      return
    }
    toast.show('재시도를 지원하지 않는 작업입니다.')
  }, [toast])

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
