import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { formatKrw, formatNumber } from '../../lib/format'
import Skeleton from '../../components/Skeleton'
import Button from '../../components/ui/Button'
import Modal from '../../components/Modal'
import { useToast } from '../../components/ToastProvider'

type TradeRow = {
  id: string
  code: string
  stock_name?: string | null
  side: 'BUY' | 'SELL' | 'ADJUST'
  price: number
  quantity: number
  gross_amount: number
  memo: string | null
  created_at: string
}

type SellCandidate = {
  code: string
  name: string
  quantity: number
  buy_price: number
  current_price: number
  pct_change: number
}

type OpStatus = 'idle' | 'loading' | 'done' | 'error'

type JobPayload = {
  task?: string
  dry_run?: boolean
  step?: string
  chat_id?: number
  [key: string]: unknown
}

type JobDetail = {
  id: string | number
  type: string
  status: string
  ok: boolean | null
  error: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  payload: JobPayload | null
}

type AutoTradeRun = {
  id: number
  run_type: string
  run_key: string
  status: 'SUCCESS' | 'SKIPPED' | 'FAILED'
  summary?: {
    buys?: number
    sells?: number
    skipped?: number
    errors?: number
    buyCount?: number
    sellCount?: number
    skippedCount?: number
    errorCount?: number
    notes?: string[]
    [key: string]: unknown
  } | null
  started_at: string
  finished_at: string | null
}

type TimelineEvent = {
  ts: string
  kind: 'queued' | 'running' | 'run_started' | 'trade' | 'run_finished' | 'job_finished'
  label: string
}

type DryRunDetails = {
  buys: number
  sells: number
  skipped: number
  errors: number
  notes: string[]
}

type JobSnapshot = {
  job: JobDetail
  latest_run: AutoTradeRun | null
  recent_runs: AutoTradeRun[]
  recent_trades: TradeRow[]
  timeline?: TimelineEvent[]
  dry_run_details?: DryRunDetails
}

type OperationsKpi = {
  asof: string
  buy_count: number
  sell_count: number
  adjust_count: number
  trade_amount: number
  run_total: number
  run_success: number
  run_skipped: number
  run_failed: number
  queue_waiting: number
  holding_count: number
  latest_failed_reason?: string | null
  latest_failed_at?: string | null
}

type ConsistencyIssue = {
  code: string
  name: string | null
  kind: 'mismatch' | 'missing_lots' | 'orphan_lots'
  position_id: number | null
  position_qty: number
  lot_qty: number
  detail: string
}

type ConsistencyReport = {
  checked_count: number
  issue_count: number
  issues: ConsistencyIssue[]
}

type LiveJobState = 'queued' | 'running' | 'done' | 'failed'

type NoteTag = {
  key: 'candidate' | 'reject' | 'risk' | 'policy' | 'execution' | 'other'
  label: string
  color: string
  bg: string
}

function sideBadge(side: string) {
  if (side === 'BUY') return <span style={{ color: 'var(--color-positive)', fontWeight: 600 }}>매수</span>
  if (side === 'SELL') return <span style={{ color: 'var(--color-negative)', fontWeight: 600 }}>매도</span>
  return <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>조정</span>
}

function normalizeJobState(raw: string): LiveJobState {
  const value = String(raw || '').toLowerCase()
  if (value === 'running') return 'running'
  if (value === 'done') return 'done'
  if (value === 'failed') return 'failed'
  return 'queued'
}

function resolveTaskLabel(payload: JobPayload | null): string {
  const task = String(payload?.task || '')
  if (task === 'virtualAutoTrade') {
    return payload?.dry_run === false ? '자동사이클 실제 실행' : '자동사이클 점검(dry-run)'
  }
  if (task === 'virtualAutoTradeIntraday') return '순차트리거(장중)'
  return task ? `작업: ${task}` : '작업'
}

function renderRunSummary(run: AutoTradeRun | null): string {
  if (!run) return '실행 요약 대기 중'
  const summary = run.summary || {}
  const buys = Number(summary.buys ?? summary.buyCount ?? 0)
  const sells = Number(summary.sells ?? summary.sellCount ?? 0)
  const skipped = Number(summary.skipped ?? summary.skippedCount ?? 0)
  const errors = Number(summary.errors ?? summary.errorCount ?? 0)
  return `매수 ${buys} · 매도 ${sells} · 스킵 ${skipped} · 오류 ${errors}`
}

function progressFill(status: LiveJobState): string {
  if (status === 'queued') return '24%'
  if (status === 'running') return '66%'
  return '100%'
}

function getTimelineMeta(event: TimelineEvent): { icon: string; color: string; bg: string } {
  if (event.kind === 'queued') return { icon: 'Q', color: '#6B7280', bg: '#F3F4F6' }
  if (event.kind === 'running' || event.kind === 'run_started') return { icon: 'R', color: '#0052DB', bg: '#EBF3FF' }
  if (event.kind === 'trade') return { icon: 'T', color: '#0F766E', bg: '#E8F7F3' }
  const failed = /실패|error/i.test(event.label)
  if (failed) return { icon: '!', color: '#D0313E', bg: '#FFF0F1' }
  return { icon: 'D', color: '#2563EB', bg: '#EDF4FF' }
}

function classifyDryRunNote(note: string): NoteTag {
  const normalized = String(note || '').toLowerCase()
  if (/후보|점수|진입|매수/i.test(note)) {
    return { key: 'candidate', label: '후보', color: '#0B57D0', bg: '#EBF3FF' }
  }
  if (/탈락|보류|스킵|없음|불가|제외/i.test(note)) {
    return { key: 'reject', label: '제외', color: '#92400E', bg: '#FFF4E5' }
  }
  if (/손절|익절|리스크|변동성|연속손실|오류|실패|timeout|fail/i.test(normalized)) {
    return { key: 'risk', label: '리스크', color: '#B42318', bg: '#FFF0F1' }
  }
  if (/전략|게이트|정책|비중|페이싱|프로필|기준/i.test(note)) {
    return { key: 'policy', label: '정책', color: '#4338CA', bg: '#EEF2FF' }
  }
  if (/실행|체결|매도|매수|반영/i.test(note)) {
    return { key: 'execution', label: '실행', color: '#0F766E', bg: '#E8F7F3' }
  }
  return { key: 'other', label: '기타', color: '#475467', bg: '#F5F7FA' }
}

function resolveFailureCause(snapshot: JobSnapshot): string {
  const direct = String(snapshot.job.error || '').trim()
  if (direct) return translateOperationMessage(direct)

  const notes = snapshot.dry_run_details?.notes || []
  const noteHit = notes.find((note) => /오류|실패|error|fail|timeout/i.test(note))
  if (noteHit) return translateOperationMessage(noteHit)

  return '실패 원인 상세가 아직 수집되지 않았습니다.'
}

function translateOperationMessage(message: string): string {
  const text = String(message || '').trim()
  if (!text) return '실패 원인 상세가 아직 수집되지 않았습니다.'

  const fifoLotMatch = text.match(/FIFO lots are insufficient for\s+([0-9A-Z]+):\s+need\s+(\d+),\s+left\s+(\d+)/i)
  if (fifoLotMatch) {
    const [, code, needRaw, leftRaw] = fifoLotMatch
    const need = Number(needRaw || 0)
    const left = Number(leftRaw || 0)
    return `${code} 매도 주문 수량이 현재 FIFO 기준 보유 수량보다 많아 실행하지 못했습니다. ${need}주를 매도하려 했지만 실제로 추적 가능한 잔량은 ${left}주입니다. 보유수량 조정, 이전 매도 반영 누락, 수동 수정 이력을 확인해 주세요.`
  }

  if (/timeout/i.test(text)) {
    return `작업 처리 시간이 초과되었습니다. 잠시 후 다시 시도하거나, 데이터/보유 상태를 먼저 점검해 주세요. 원문: ${text}`
  }

  if (/unsupported cron_dispatch task/i.test(text)) {
    return `지원하지 않는 작업 유형이라 실행할 수 없습니다. 운영패널 연결 작업명을 확인해 주세요.`
  }

  return text
}

function normalizeStep(value: unknown): 'intraday' | 'ready' {
  return String(value || '').toLowerCase() === 'ready' ? 'ready' : 'intraday'
}

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
  const [consistency, setConsistency] = useState<ConsistencyReport | null>(null)
  const [consistencyLoading, setConsistencyLoading] = useState(false)
  const [consistencyRepairing, setConsistencyRepairing] = useState(false)

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

  const loadConsistency = useCallback(async () => {
    setConsistencyLoading(true)
    try {
      const json = await apiFetch('/api/ui/operations?view=consistency', { cacheMs: 0, timeoutMs: 20_000 })
      setConsistency((json?.data || null) as ConsistencyReport | null)
    } catch (e: any) {
      toast.show('정합성 점검 조회 실패: ' + String(e?.message || e))
    } finally {
      setConsistencyLoading(false)
    }
  }, [toast])

  useEffect(() => { void loadConsistency() }, [loadConsistency])

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
        setTimeout(loadConsistency, 800)

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
  }, [loadActivity, loadConsistency, loadDashboard, toast])

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

  const runAutocycle = async (dryRun: boolean) => {
    setAutocycleStatus('loading')
    setAutocycleResult(null)
    try {
      const json = await apiFetch('/api/ui/operations', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 60_000,
        body: JSON.stringify({ mode: 'autocycle', dry_run: dryRun }),
      })
      if (json?.error) throw new Error(String(json.error))
      const jobId = String(json?.job_id || '').trim()
      if (!jobId) throw new Error('job_id가 비어 있습니다.')
      const label = dryRun ? '점검(dry-run)' : '실행'
      if (json?.execution_error) {
        setAutocycleResult(`자동사이클 ${label} 실행 실패 - ${String(json.execution_error)}`)
        setAutocycleStatus('error')
      } else {
        setAutocycleResult(`자동사이클 ${label} 요청 등록 완료 - job_id: ${jobId}`)
        setAutocycleStatus('done')
      }
      if (!dryRun) setPendingDryRunApproval(null)
      if (dryRun) setBannerDismissedForJobId(null)
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
      await runAutocycle(dryRun)
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

  const repairConsistency = useCallback(async (code?: string) => {
    setConsistencyRepairing(true)
    try {
      const json = await apiFetch('/api/ui/operations', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 60_000,
        body: JSON.stringify({ mode: 'consistency_repair', code: code || null }),
      })
      if (json?.error) throw new Error(String(json.error))
      const repaired = Number(json?.data?.repaired_count || 0)
      toast.show(repaired > 0 ? `정합성 복구 완료: ${repaired}건` : '복구할 항목이 없습니다.')
      await loadConsistency()
      await loadDashboard()
    } catch (e: any) {
      toast.show('정합성 복구 실패: ' + String(e?.message || e))
    } finally {
      setConsistencyRepairing(false)
    }
  }, [loadConsistency, loadDashboard, toast])

  return (
    <section className="container-app">
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <h1 className="title-xl">운영 패널</h1>
        <p className="muted">가상매수/매도 자동화의 실시간 진행 상태, 실행 요약, 최근 결과를 한 화면에서 확인합니다.</p>
      </div>

      {showStickyDryRunBanner && pendingDryRunApproval && (
        <div
          className="card"
          style={{
            marginBottom: 'var(--space-4)',
            borderColor: 'var(--color-blue-200)',
            background: 'linear-gradient(120deg, var(--color-blue-50), #FFFFFF 70%)',
            position: 'sticky',
            top: 72,
            zIndex: 220,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <div>
              <div className="title-md">드라이런 검토 완료: 실행 여부를 선택하세요</div>
              <div className="caption muted" style={{ marginTop: 4 }}>job_id: {pendingDryRunApproval.jobId} · {pendingDryRunApproval.summary}</div>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <Button variant="primary" onClick={() => runAutocycle(false)} disabled={autocycleStatus === 'loading'}>
                결과 수락 후 실제 실행
              </Button>
              <Button
                variant="ghost"
                onClick={() => setSelectedDryRunJobId(pendingDryRunApproval.jobId)}
              >
                상세 보기
              </Button>
              <Button
                variant="ghost"
                onClick={() => setBannerDismissedForJobId(pendingDryRunApproval.jobId)}
              >
                닫기
              </Button>
            </div>
          </div>
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-6)',
        }}
      >
        {dashboardLoading && <Skeleton lines={2} height={16} />}
        {!dashboardLoading && dashboardKpi && (
          <>
            <div className="card" style={{ background: 'linear-gradient(150deg, #FFFFFF, #F7FBFF)' }}>
              <div className="caption muted">오늘 체결</div>
              <div className="title-lg" style={{ marginTop: 'var(--space-1)' }}>{dashboardKpi.buy_count + dashboardKpi.sell_count}건</div>
              <div className="caption muted" style={{ marginTop: 'var(--space-1)' }}>매수 {dashboardKpi.buy_count} · 매도 {dashboardKpi.sell_count}</div>
            </div>
            <div className="card" style={{ background: 'linear-gradient(150deg, #FFFFFF, #F6FAF9)' }}>
              <div className="caption muted">오늘 거래금액</div>
              <div className="title-lg" style={{ marginTop: 'var(--space-1)' }}>{formatKrw(dashboardKpi.trade_amount)}</div>
              <div className="caption muted" style={{ marginTop: 'var(--space-1)' }}>기준일 {dashboardKpi.asof}</div>
            </div>
            <div className="card" style={{ background: 'linear-gradient(150deg, #FFFFFF, #FAF8FF)' }}>
              <div className="caption muted">자동사이클 실행</div>
              <div className="title-lg" style={{ marginTop: 'var(--space-1)' }}>{dashboardKpi.run_total}회</div>
              <div className="caption muted" style={{ marginTop: 'var(--space-1)' }}>성공 {dashboardKpi.run_success} · 실패 {dashboardKpi.run_failed}</div>
              {dashboardKpi.run_failed > 0 && dashboardKpi.latest_failed_reason && (
                <div className="caption" style={{ marginTop: 'var(--space-1)', color: 'var(--color-error)' }}>
                  최근 실패: {translateOperationMessage(dashboardKpi.latest_failed_reason)}
                </div>
              )}
            </div>
            <div className="card" style={{ background: 'linear-gradient(150deg, #FFFFFF, #FFF9F5)' }}>
              <div className="caption muted">큐 대기/보유</div>
              <div className="title-lg" style={{ marginTop: 'var(--space-1)' }}>{dashboardKpi.queue_waiting} / {dashboardKpi.holding_count}</div>
              <div className="caption muted" style={{ marginTop: 'var(--space-1)' }}>대기작업 / 보유종목</div>
            </div>
          </>
        )}
      </div>

      <div className="card card-lg" style={{ marginBottom: 'var(--space-6)', background: 'linear-gradient(135deg, #FFFDFC, #FFFFFF 58%, #F8FBFF)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap', marginBottom: 'var(--space-3)' }}>
          <div>
            <div className="title-lg">FIFO 정합성 점검/복구</div>
            <div className="caption muted" style={{ marginTop: 'var(--space-1)' }}>
              보유수량과 FIFO lot 잔량이 다를 때 자동매도 실패가 발생할 수 있습니다.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <Button variant="ghost" onClick={() => { void loadConsistency() }} disabled={consistencyLoading || consistencyRepairing}>
              {consistencyLoading ? '점검 중...' : '정합성 점검'}
            </Button>
            <Button variant="secondary" onClick={() => { void repairConsistency() }} disabled={consistencyLoading || consistencyRepairing}>
              {consistencyRepairing ? '복구 중...' : '전체 복구'}
            </Button>
          </div>
        </div>

        {consistency && (
          <div style={{ marginBottom: 'var(--space-3)' }}>
            <div className="caption muted">점검 대상 {consistency.checked_count}건 · 이슈 {consistency.issue_count}건</div>
          </div>
        )}

        {!consistencyLoading && consistency && consistency.issue_count === 0 && (
          <div className="card" style={{ background: '#F7FCF9', borderColor: '#CBEAD9' }}>
            <div className="caption" style={{ color: '#0F766E' }}>현재 보유수량과 FIFO lot 잔량이 일치합니다.</div>
          </div>
        )}

        {!consistencyLoading && consistency && consistency.issue_count > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {consistency.issues.map((issue) => (
              <div key={`${issue.kind}-${issue.code}-${issue.position_id ?? 'none'}`} className="card" style={{ borderColor: issue.kind === 'orphan_lots' ? '#FFD6D9' : '#FFE1B3' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  <div>
                    <div className="font-medium">{issue.name || issue.code}{issue.name ? ` (${issue.code})` : ''}</div>
                    <div className="caption muted" style={{ marginTop: 4 }}>{issue.detail}</div>
                    <div className="caption muted" style={{ marginTop: 4 }}>보유 {issue.position_qty}주 · lot {issue.lot_qty}주</div>
                  </div>
                  <div>
                    <Button variant="ghost" onClick={() => { void repairConsistency(issue.code) }} disabled={consistencyRepairing}>
                      이 종목 복구
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card card-lg" style={{ marginBottom: 'var(--space-6)', background: 'linear-gradient(130deg, #F8FBFF 0%, #FFFFFF 52%, #F5F7FA 100%)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap', marginBottom: 'var(--space-3)' }}>
          <div>
            <div className="title-lg">실시간 실행 보드</div>
            <div className="caption muted" style={{ marginTop: 'var(--space-1)' }}>
              큐 등록 - 실행 중 - 완료 단계를 2초 간격으로 자동 갱신합니다.
            </div>
          </div>
          <Button variant="ghost" onClick={() => {
            for (const jobId of watchingJobIds) void refreshJobSnapshot(jobId, true)
          }}>
            지금 갱신
          </Button>
        </div>

        {liveJobItems.length === 0 ? (
          <div className="caption muted">현재 추적 중인 작업이 없습니다. 상단 작업을 실행하면 이 보드에 상태가 표시됩니다.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {liveJobItems.slice(0, 6).map((item) => {
              const state = normalizeJobState(item.job.status)
              const jobId = String(item.job.id)
              const running = state === 'running'
              const failed = state === 'failed'
              const expanded = failed || expandedJobIds.includes(jobId)
              return (
                <div key={jobId} className="card" style={{ borderColor: failed ? 'var(--color-border-error)' : 'var(--color-border-default)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                    <div className="font-medium">{resolveTaskLabel(item.job.payload)}</div>
                    <div className="caption" style={{ color: failed ? 'var(--color-error)' : running ? 'var(--color-brand)' : 'var(--color-text-tertiary)', fontWeight: 700 }}>
                      {failed ? '실패' : running ? '실행 중' : state === 'done' ? '완료' : '대기 중'}
                    </div>
                  </div>

                  {failed && (
                    <div style={{ marginTop: 'var(--space-2)', padding: '8px 10px', borderRadius: 8, background: '#FFF0F1', border: '1px solid #FFD6D9' }}>
                      <div className="caption" style={{ color: '#B42318', fontWeight: 700 }}>실패 원인</div>
                      <div className="caption" style={{ color: '#7A271A', marginTop: 4 }}>{resolveFailureCause(item)}</div>
                      <div style={{ marginTop: 8 }}>
                        <Button
                          variant="ghost"
                          onClick={() => { void retryJob(item) }}
                          disabled={autocycleStatus === 'loading' || autotriggerStatus === 'loading'}
                        >
                          동일 조건 재시도
                        </Button>
                      </div>
                    </div>
                  )}

                  <div style={{ marginTop: 'var(--space-2)', height: 8, borderRadius: 999, background: 'var(--color-gray-100)', overflow: 'hidden' }}>
                    <div
                      style={{
                        width: progressFill(state),
                        height: '100%',
                        background: failed ? 'var(--color-error)' : 'linear-gradient(90deg, #63A0FF 0%, #0060FF 100%)',
                        transition: 'width var(--duration-normal) var(--ease-out)',
                      }}
                    />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--space-2)' }}>
                    <span className="caption muted">요청 {new Date(item.job.created_at).toLocaleTimeString('ko-KR')}</span>
                    <span className="caption muted">job_id: {String(item.job.id)}</span>
                  </div>

                  <div className="caption" style={{ marginTop: 'var(--space-2)', color: failed ? 'var(--color-error)' : 'var(--color-text-secondary)' }}>
                    {failed ? (item.job.error || '오류 상세가 없습니다.') : renderRunSummary(item.latest_run)}
                  </div>

                  {Array.isArray(item.timeline) && item.timeline.length > 0 && (
                    <div style={{ marginTop: 'var(--space-3)', borderTop: '1px dashed var(--color-border-default)', paddingTop: 'var(--space-2)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-1)' }}>
                        <div className="caption muted">실행 타임라인</div>
                        {!failed && (
                          <button
                            className="caption"
                            style={{ border: 'none', background: 'transparent', color: 'var(--color-brand)', cursor: 'pointer', fontWeight: 600 }}
                            onClick={() => {
                              setExpandedJobIds(prev => prev.includes(jobId) ? prev.filter(id => id !== jobId) : [...prev, jobId])
                            }}
                          >
                            {expanded ? '접기' : '전체 보기'}
                          </button>
                        )}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                        {(expanded ? item.timeline : item.timeline.slice(-4)).map((event, index) => {
                          const meta = getTimelineMeta(event)
                          return (
                          <div key={`${String(item.job.id)}-timeline-${index}`} style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', alignItems: 'center' }}>
                            <span className="caption" style={{ color: 'var(--color-text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ width: 18, height: 18, borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: meta.bg, color: meta.color, fontSize: 10, fontWeight: 700 }}>{meta.icon}</span>
                              {event.label}
                            </span>
                            <span className="caption muted">{new Date(event.ts).toLocaleTimeString('ko-KR')}</span>
                          </div>
                        )})}
                      </div>
                    </div>
                  )}

                  {item.recent_trades.length > 0 && (
                    <div style={{ marginTop: 'var(--space-2)', display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                      {item.recent_trades.slice(0, 3).map(trade => (
                        <span key={trade.id} className="caption" style={{ padding: '4px 8px', borderRadius: 999, background: 'var(--color-gray-50)', color: 'var(--color-text-secondary)' }}>
                          {(trade.stock_name || trade.code)} {trade.side === 'BUY' ? '매수' : trade.side === 'SELL' ? '매도' : '조정'} {trade.quantity}주 @{formatKrw(trade.price)}
                        </span>
                      ))}
                    </div>
                  )}

                  {item.job.payload?.dry_run !== false && (
                    <div style={{ marginTop: 'var(--space-2)' }}>
                      <Button
                        variant="ghost"
                        onClick={() => setSelectedDryRunJobId(String(item.job.id))}
                      >
                        드라이런 상세 보기
                      </Button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {pendingDryRunApproval && (
        <div className="card card-lg" style={{ marginBottom: 'var(--space-6)', borderColor: 'var(--color-blue-200)', background: 'linear-gradient(120deg, var(--color-blue-50), #FFFFFF 70%)' }}>
          <div className="title-lg">드라이런 결과 검토 완료</div>
          <div className="muted" style={{ marginTop: 'var(--space-1)' }}>
            job_id: {pendingDryRunApproval.jobId}
          </div>
          <div className="caption muted" style={{ marginTop: 'var(--space-2)' }}>
            {pendingDryRunApproval.summary}
          </div>
          <div style={{ marginTop: 'var(--space-3)', display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <Button
              variant="primary"
              onClick={() => runAutocycle(false)}
              disabled={autocycleStatus === 'loading'}
            >
              결과 수락 후 실제 실행
            </Button>
            <Button
              variant="ghost"
              onClick={() => setPendingDryRunApproval(null)}
            >
              보류
            </Button>
          </div>
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 'var(--space-4)',
          marginBottom: 'var(--space-6)',
        }}
      >

        {/* Autocycle */}
        <div className="card card-lg">
          <div style={{ marginBottom: 'var(--space-3)' }}>
            <div className="title-lg">자동사이클 (autocycle)</div>
            <div className="muted caption" style={{ marginTop: 'var(--space-1)' }}>
              보유/관심 종목 점수 재평가 후 매수/매도 조건 충족 시 가상 거래를 실행합니다.
              점검 모드는 실제 체결 없이 결과만 먼저 확인합니다.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <Button
              variant="secondary"
              onClick={() => runAutocycle(true)}
              disabled={autocycleStatus === 'loading'}
            >
              {autocycleStatus === 'loading' ? '요청 중...' : '점검 실행 (dry-run)'}
            </Button>
            <Button
              variant="ghost"
              onClick={() => runAutocycle(false)}
              disabled={autocycleStatus === 'loading'}
            >
              실제 실행
            </Button>
          </div>
          {autocycleResult && (
            <div
              className={autocycleStatus === 'error' ? 'state-error' : 'caption muted'}
              style={{ marginTop: 'var(--space-3)' }}
            >
              {autocycleResult}
            </div>
          )}
        </div>

        {/* Autotrigger */}
        <div className="card card-lg">
          <div style={{ marginBottom: 'var(--space-3)' }}>
            <div className="title-lg">순차트리거 (autotrigger)</div>
            <div className="muted caption" style={{ marginTop: 'var(--space-1)' }}>
              장중/장전 단계별 순차 트리거를 실행합니다. 단계를 선택 후 요청하세요.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              className="input"
              style={{ width: 'auto', minWidth: 120 }}
              value={autotriggerStep}
              onChange={e => setAutotriggerStep(e.target.value as 'intraday' | 'ready')}
            >
              <option value="intraday">장중 (intraday)</option>
              <option value="ready">장전 (ready)</option>
            </select>
            <Button
              variant="secondary"
              onClick={() => { void runAutotrigger() }}
              disabled={autotriggerStatus === 'loading'}
            >
              {autotriggerStatus === 'loading' ? '요청 중...' : '트리거 요청'}
            </Button>
          </div>
          {autotriggerResult && (
            <div
              className={autotriggerStatus === 'error' ? 'state-error' : 'caption muted'}
              style={{ marginTop: 'var(--space-3)' }}
            >
              {autotriggerResult}
            </div>
          )}
        </div>

        {/* Autosellcheck */}
        <div className="card card-lg">
          <div style={{ marginBottom: 'var(--space-3)' }}>
            <div className="title-lg">자동매도 점검 (autosellcheck)</div>
            <div className="muted caption" style={{ marginTop: 'var(--space-1)' }}>
              현재 보유 종목의 현재가 기준 수익률을 조회합니다. 하락 순으로 정렬됩니다.
            </div>
          </div>
          <Button
            variant="secondary"
            onClick={fetchSellCandidates}
            disabled={sellLoading}
          >
            {sellLoading ? '조회 중...' : '점검 조회'}
          </Button>
          {sellFetched && (
            <div style={{ marginTop: 'var(--space-3)' }}>
              {sellCandidates.length === 0 ? (
                <div className="caption muted">보유 포지션 없음</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  {sellCandidates.map(c => (
                    <div key={c.code} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <span className="font-medium">{c.name || c.code}</span>
                        <span className="caption muted"> ({c.code}) · {c.quantity}주</span>
                      </div>
                      <div className="text-right">
                        <span
                          className={c.pct_change < 0 ? 'negative' : 'positive'}
                          style={{ fontWeight: 600 }}
                        >
                          {c.pct_change > 0 ? '+' : ''}{formatNumber(c.pct_change, 2)}%
                        </span>
                        <div className="caption muted">
                          {formatKrw(c.current_price)} / 평균 {formatKrw(c.buy_price)}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <Modal
        isOpen={!!selectedDryRunSnapshot}
        title="드라이런 상세 리포트"
        onClose={() => setSelectedDryRunJobId(null)}
        size="lg"
      >
        {selectedDryRunSnapshot && (
          <div style={{ padding: 'var(--space-4)' }}>
            <div className="caption muted">job_id: {String(selectedDryRunSnapshot.job.id)}</div>
            <div className="title-lg" style={{ marginTop: 'var(--space-2)' }}>
              {resolveTaskLabel(selectedDryRunSnapshot.job.payload)}
            </div>
            <div className="caption muted" style={{ marginTop: 'var(--space-1)' }}>
              {selectedDryRunSnapshot.dry_run_details
                ? `매수 ${selectedDryRunSnapshot.dry_run_details.buys} · 매도 ${selectedDryRunSnapshot.dry_run_details.sells} · 스킵 ${selectedDryRunSnapshot.dry_run_details.skipped} · 오류 ${selectedDryRunSnapshot.dry_run_details.errors}`
                : renderRunSummary(selectedDryRunSnapshot.latest_run)}
            </div>

            <div style={{ marginTop: 'var(--space-3)' }}>
              <div className="title-md" style={{ marginBottom: 'var(--space-2)' }}>단계별 로그</div>
              {selectedDryRunSnapshot.timeline && selectedDryRunSnapshot.timeline.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  {selectedDryRunSnapshot.timeline.map((event, index) => (
                    <div key={`modal-timeline-${index}`} className="card" style={{ padding: 'var(--space-3)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)' }}>
                        <span className="font-medium" style={{ fontSize: '0.9rem', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          {(() => {
                            const meta = getTimelineMeta(event)
                            return <span style={{ width: 18, height: 18, borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: meta.bg, color: meta.color, fontSize: 10, fontWeight: 700 }}>{meta.icon}</span>
                          })()}
                          {event.label}
                        </span>
                        <span className="caption muted">{new Date(event.ts).toLocaleString('ko-KR')}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="caption muted">타임라인 데이터 없음</div>
              )}
            </div>

            <div style={{ marginTop: 'var(--space-3)' }}>
              <div className="title-md" style={{ marginBottom: 'var(--space-2)' }}>매수 후보/제외 사유 요약</div>
              {selectedDryRunSnapshot.dry_run_details?.notes?.length ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', maxHeight: 260, overflowY: 'auto' }}>
                  {selectedDryRunSnapshot.dry_run_details.notes.map((note, index) => (
                    <div key={`dryrun-note-${index}`} className="card" style={{ padding: 'var(--space-3)', background: '#FAFCFF' }}>
                      {(() => {
                        const tag = classifyDryRunNote(note)
                        return (
                          <span className="caption" style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 999, padding: '2px 8px', background: tag.bg, color: tag.color, fontWeight: 700, marginBottom: 6 }}>
                            {tag.label}
                          </span>
                        )
                      })()}
                      <div className="caption" style={{ color: 'var(--color-text-secondary)' }}>{note}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="caption muted">상세 노트가 없습니다.</div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* 최근 실행 이력 */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
          <h2 className="title-lg">최근 실행 이력 (최근 20건)</h2>
          <Button variant="ghost" onClick={loadActivity} disabled={activityLoading}>새로고침</Button>
        </div>
        {activityLoading && <Skeleton lines={5} height={18} />}
        {!activityLoading && activity.length === 0 && (
          <div className="card"><div className="muted">실행 이력 없음</div></div>
        )}
        {!activityLoading && activity.map(row => (
          <div key={row.id} className="card" style={{ marginBottom: 'var(--space-2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <span className="font-medium">{row.stock_name || row.code}</span>
                {row.stock_name && (
                  <span className="caption muted" style={{ marginLeft: 'var(--space-2)' }}>({row.code})</span>
                )}
                <span style={{ marginLeft: 'var(--space-2)' }}>{sideBadge(row.side)}</span>
                <span className="caption muted" style={{ marginLeft: 'var(--space-2)' }}>
                  {row.quantity}주 · {formatKrw(row.price)}
                </span>
              </div>
              <div className="caption muted">{new Date(row.created_at).toLocaleString('ko-KR')}</div>
            </div>
            {row.memo && (
              <div className="caption muted" style={{ marginTop: 'var(--space-1)' }}>
                {row.memo}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
