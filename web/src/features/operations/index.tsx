import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { formatKrw, formatNumber } from '../../lib/format'
import Skeleton from '../../components/Skeleton'
import Button from '../../components/ui/Button'
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
    buyCount?: number
    sellCount?: number
    skippedCount?: number
    errorCount?: number
    [key: string]: unknown
  } | null
  started_at: string
  finished_at: string | null
}

type JobSnapshot = {
  job: JobDetail
  latest_run: AutoTradeRun | null
  recent_runs: AutoTradeRun[]
  recent_trades: TradeRow[]
}

type LiveJobState = 'queued' | 'running' | 'done' | 'failed'

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
  const buys = Number(summary.buyCount || 0)
  const sells = Number(summary.sellCount || 0)
  const skipped = Number(summary.skippedCount || 0)
  const errors = Number(summary.errorCount || 0)
  return `매수 ${buys} · 매도 ${sells} · 스킵 ${skipped} · 오류 ${errors}`
}

function progressFill(status: LiveJobState): string {
  if (status === 'queued') return '24%'
  if (status === 'running') return '66%'
  return '100%'
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

  const [autotriggerStatus, setAutotriggerStatus] = useState<OpStatus>('idle')
  const [autotriggerStep, setAutotriggerStep] = useState<'intraday' | 'ready'>('intraday')
  const [autotriggerResult, setAutotriggerResult] = useState<string | null>(null)

  const [liveJobs, setLiveJobs] = useState<Record<string, JobSnapshot>>({})
  const [watchingJobIds, setWatchingJobIds] = useState<string[]>([])

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
  }, [loadActivity, toast])

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
        timeoutMs: 20_000,
        body: JSON.stringify({ mode: 'autocycle', dry_run: dryRun }),
      })
      if (json?.error) throw new Error(String(json.error))
      const jobId = String(json?.job_id || '').trim()
      if (!jobId) throw new Error('job_id가 비어 있습니다.')
      const label = dryRun ? '점검(dry-run)' : '실행'
      setAutocycleResult(`자동사이클 ${label} 요청 등록 완료 - job_id: ${jobId}`)
      setAutocycleStatus('done')
      if (!dryRun) setPendingDryRunApproval(null)
      addWatchingJob(jobId)
      void refreshJobSnapshot(jobId, true)
      toast.show(`자동사이클 ${label} 등록 완료`)
    } catch (e: any) {
      setAutocycleResult(String(e?.message || e))
      setAutocycleStatus('error')
    }
  }

  const runAutotrigger = async () => {
    setAutotriggerStatus('loading')
    setAutotriggerResult(null)
    try {
      const json = await apiFetch('/api/ui/operations', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 20_000,
        body: JSON.stringify({ mode: 'autotrigger', step: autotriggerStep, dry_run: true }),
      })
      if (json?.error) throw new Error(String(json.error))
      const jobId = String(json?.job_id || '').trim()
      if (!jobId) throw new Error('job_id가 비어 있습니다.')
      setAutotriggerResult(`순차트리거(${autotriggerStep}) 요청 등록 완료 - job_id: ${jobId}`)
      setAutotriggerStatus('done')
      addWatchingJob(jobId)
      void refreshJobSnapshot(jobId, true)
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

  return (
    <section className="container-app">
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <h1 className="title-xl">운영 패널</h1>
        <p className="muted">가상매수/매도 자동화의 실시간 진행 상태, 실행 요약, 최근 결과를 한 화면에서 확인합니다.</p>
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
              const running = state === 'running'
              const failed = state === 'failed'
              return (
                <div key={String(item.job.id)} className="card" style={{ borderColor: failed ? 'var(--color-border-error)' : 'var(--color-border-default)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                    <div className="font-medium">{resolveTaskLabel(item.job.payload)}</div>
                    <div className="caption" style={{ color: failed ? 'var(--color-error)' : running ? 'var(--color-brand)' : 'var(--color-text-tertiary)', fontWeight: 700 }}>
                      {failed ? '실패' : running ? '실행 중' : state === 'done' ? '완료' : '대기 중'}
                    </div>
                  </div>

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

                  {item.recent_trades.length > 0 && (
                    <div style={{ marginTop: 'var(--space-2)', display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                      {item.recent_trades.slice(0, 3).map(trade => (
                        <span key={trade.id} className="caption" style={{ padding: '4px 8px', borderRadius: 999, background: 'var(--color-gray-50)', color: 'var(--color-text-secondary)' }}>
                          {(trade.stock_name || trade.code)} {trade.side === 'BUY' ? '매수' : trade.side === 'SELL' ? '매도' : '조정'} {trade.quantity}주
                        </span>
                      ))}
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
              onClick={runAutotrigger}
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
