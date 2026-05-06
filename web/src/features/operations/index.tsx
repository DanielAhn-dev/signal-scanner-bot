import React, { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { formatKrw, formatNumber } from '../../lib/format'
import Skeleton from '../../components/Skeleton'
import Button from '../../components/ui/Button'
import { useToast } from '../../components/ToastProvider'

type TradeRow = {
  id: string
  code: string
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

function sideBadge(side: string) {
  if (side === 'BUY') return <span style={{ color: 'var(--color-positive)', fontWeight: 600 }}>매수</span>
  if (side === 'SELL') return <span style={{ color: 'var(--color-negative)', fontWeight: 600 }}>매도</span>
  return <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>조정</span>
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

  const [autotriggerStatus, setAutotriggerStatus] = useState<OpStatus>('idle')
  const [autotriggerStep, setAutotriggerStep] = useState<'intraday' | 'ready'>('intraday')
  const [autotriggerResult, setAutotriggerResult] = useState<string | null>(null)

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
      const label = dryRun ? '점검(dry-run)' : '실행'
      setAutocycleResult(`자동사이클 ${label} 요청 완료 — job_id: ${json?.job_id ?? '-'}`)
      setAutocycleStatus('done')
      toast.show(`자동사이클 ${label} 등록 완료`)
      setTimeout(loadActivity, 2000)
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
      setAutotriggerResult(`순차트리거(${autotriggerStep}) 요청 완료 — job_id: ${json?.job_id ?? '-'}`)
      setAutotriggerStatus('done')
      toast.show('순차트리거 등록 완료')
    } catch (e: any) {
      setAutotriggerResult(String(e?.message || e))
      setAutotriggerStatus('error')
    }
  }

  return (
    <section className="container-app">
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <h1 className="title-xl">운영 패널</h1>
        <p className="muted">자동화 작업 실행 및 실행 이력을 확인합니다.</p>
      </div>

      {/* 운영 카드 3종 */}
      <div className="cards-list" style={{ marginBottom: 'var(--space-6)' }}>

        {/* Autocycle */}
        <div className="card card-lg">
          <div style={{ marginBottom: 'var(--space-3)' }}>
            <div className="title-lg">자동사이클 (autocycle)</div>
            <div className="muted caption" style={{ marginTop: 'var(--space-1)' }}>
              보유/관심 종목 점수 재평가 후 매수·매도 조건 충족 시 가상 거래를 실행합니다.
              점검 모드는 실제 거래 없이 결과만 미리 확인합니다.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <Button
              variant="secondary"
              onClick={() => runAutocycle(true)}
              disabled={autocycleStatus === 'loading'}
            >
              {autocycleStatus === 'loading' ? '처리 중…' : '점검 실행 (dry-run)'}
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
              {autotriggerStatus === 'loading' ? '처리 중…' : '트리거 요청'}
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
            {sellLoading ? '조회 중…' : '점검 조회'}
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
                <span className="font-medium">{row.code}</span>
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
