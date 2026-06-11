/**
 * 관제 — 관찰·운영용 페이지 통합 (Phase 4)
 *
 * 탭 구성:
 *  - 검산: 가상매매 원장 정합성 일일 자가검증 결과 (integrity_audit_results, Phase 2)
 *  - 운영: 자동매매 실행 인사이트·의사결정 로그 (기존 운영 패널)
 *  - 데이터: DB 종목 뷰 + 동기화 (기존 dbview)
 *  - 유지보수: 포지션 수동 수정·복구 (기존 position-maintenance)
 */
import React, { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ShieldCheck, ShieldAlert, ChevronDown, ChevronUp } from 'lucide-react'
import { supabase, isSupabaseConfigured } from '../../lib/supabase'
import { formatKrw } from '../../lib/format'
import Button from '../../components/ui/Button'
import Skeleton from '../../components/Skeleton'

const OperationsPanel = lazy(() => import('../operations'))
const DataPanel = lazy(() => import('../dbView'))
const MaintenancePanel = lazy(() => import('../position-maintenance'))

const CONTROL_TABS = [
  { key: 'audit', label: '검산' },
  { key: 'operations', label: '운영' },
  { key: 'data', label: '데이터' },
  { key: 'maintenance', label: '유지보수' },
] as const

type ControlTabKey = typeof CONTROL_TABS[number]['key']

function normalizeTab(value: string | null): ControlTabKey {
  const found = CONTROL_TABS.find((tab) => tab.key === value)
  return found ? found.key : 'audit'
}

// ── 검산 탭 ──────────────────────────────────────────────────────

type LedgerIssue = {
  type: 'cash-mismatch' | 'quantity-mismatch' | 'oversell' | string
  code?: string
  detail: string
}

type ChatLedgerResult = {
  chatId: number
  seedCapital: number
  actualCash: number
  expectedCash: number
  cashDiff: number
  cashTolerance: number
  cashStatus: 'ok' | 'mismatch' | 'estimated'
  adjustCount: number
  tradeCount: number
  holdingCount: number
  issues: LedgerIssue[]
}

type FreshnessItem = {
  key: string
  label: string
  latestDate: string | null
  staleBizDays: number | null
  isStale: boolean
  maxBizDays: number
}

type AuditDetail = {
  results?: ChatLedgerResult[]
  staleHoldingCodes?: string[]
  freshness?: { isHealthy: boolean; staleItems: FreshnessItem[] }
}

type AuditRow = {
  id: number
  run_at: string
  audit_date: string
  is_healthy: boolean
  issue_count: number
  account_count: number
  summary: string
  detail: AuditDetail | null
}

function formatRunAt(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function healthBadge(healthy: boolean) {
  return healthy
    ? { label: '정상', color: '#0F766E', bg: '#E8F7F3', icon: <ShieldCheck size={14} /> }
    : { label: '이상', color: '#B42318', bg: '#FFF0F1', icon: <ShieldAlert size={14} /> }
}

function cashStatusBadge(status: ChatLedgerResult['cashStatus']) {
  if (status === 'ok') return { label: '일치', color: '#0F766E', bg: '#E8F7F3' }
  if (status === 'estimated') return { label: '참고용(ADJUST 이력)', color: '#92400E', bg: '#FFF4E5' }
  return { label: '불일치', color: '#B42318', bg: '#FFF0F1' }
}

function IntegrityAuditPanel() {
  const [rows, setRows] = useState<AuditRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [missingTable, setMissingTable] = useState(false)
  const [expandedId, setExpandedId] = useState<number | null>(null)

  const load = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) {
      setError('Supabase 설정이 없어 검산 결과를 조회할 수 없습니다.')
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    setMissingTable(false)
    try {
      const { data, error: queryError } = await supabase
        .from('integrity_audit_results')
        .select('id, run_at, audit_date, is_healthy, issue_count, account_count, summary, detail')
        .order('run_at', { ascending: false })
        .limit(14)
      if (queryError) {
        // PGRST205: 테이블이 스키마 캐시에 없음 = 마이그레이션 미적용
        if (queryError.code === 'PGRST205' || /schema cache/i.test(queryError.message)) {
          setMissingTable(true)
          return
        }
        throw new Error(queryError.message)
      }
      setRows((data ?? []) as AuditRow[])
    } catch (e: any) {
      setError(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const latest = rows[0] ?? null
  const history = useMemo(() => rows.slice(1), [rows])

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: 'var(--space-3)' }}>
        <div>
          <div className="title-lg">원장 정합성 검산</div>
          <div className="caption muted" style={{ marginTop: 4 }}>
            현금 원장·종목 수량·오버셀·데이터 신선도를 매 영업일 자동 검산한 결과입니다.
          </div>
        </div>
        <Button variant="ghost" onClick={() => void load()} disabled={loading}>
          {loading ? '조회 중...' : '새로고침'}
        </Button>
      </div>

      {loading && <Skeleton lines={6} height={16} />}

      {!loading && missingTable && (
        <div className="card" style={{ borderColor: 'var(--color-warning, #F59E0B)' }}>
          <div className="title-md" style={{ marginBottom: 'var(--space-2)' }}>검산 테이블이 아직 생성되지 않았습니다</div>
          <div className="caption" style={{ color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
            Supabase에 <code>integrity_audit_results</code> 테이블 마이그레이션이 적용되지 않은 상태입니다.
            <br />Supabase 대시보드 → SQL Editor에서 아래 파일 내용을 한 번 실행해 주세요:
            <br /><code>supabase/migrations/20260612_create_integrity_audit_results.sql</code>
            <br />적용 후 이 화면을 새로고침하면 검산 결과가 표시됩니다. (결과 적재는 평일 16:10 KST 자동 검산
            또는 <code>pnpm cron:trigger:integrity</code> 수동 실행)
          </div>
        </div>
      )}

      {!loading && error && (
        <div className="card" style={{ borderColor: 'var(--color-error)', color: 'var(--color-error)' }}>
          검산 결과 조회 실패: {error}
        </div>
      )}

      {!loading && !missingTable && !error && rows.length === 0 && (
        <div className="card muted">
          아직 저장된 검산 결과가 없습니다. 평일 16:10(KST) 자동 검산이 돌거나, <code>pnpm cron:trigger:integrity</code>로 수동 실행하면 여기에 쌓입니다.
        </div>
      )}

      {!loading && !error && latest && (
        <>
          {(() => {
            const badge = healthBadge(latest.is_healthy)
            return (
              <div className="card" style={{ marginBottom: 'var(--space-4)', borderColor: latest.is_healthy ? undefined : 'var(--color-error)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  <div>
                    <div className="caption muted">최신 검산 · {latest.audit_date} ({formatRunAt(latest.run_at)})</div>
                    <div className="title-md" style={{ marginTop: 4 }}>
                      계정 {latest.account_count}개 · 이슈 {latest.issue_count}건
                    </div>
                  </div>
                  <span className="caption" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, borderRadius: 999, padding: '4px 12px', background: badge.bg, color: badge.color, fontWeight: 700 }}>
                    {badge.icon}{badge.label}
                  </span>
                </div>

                {latest.detail?.results && latest.detail.results.length > 0 && (
                  <div style={{ marginTop: 'var(--space-3)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 'var(--space-2)' }}>
                    {latest.detail.results.map((account) => {
                      const tone = cashStatusBadge(account.cashStatus)
                      return (
                        <div key={account.chatId} className="card" style={{ padding: 'var(--space-3)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                            <div className="caption muted">계정 {account.chatId}</div>
                            <span className="caption" style={{ borderRadius: 999, padding: '2px 8px', background: tone.bg, color: tone.color, fontWeight: 700 }}>
                              현금 {tone.label}
                            </span>
                          </div>
                          <div className="caption" style={{ marginTop: 6, color: 'var(--color-text-secondary)' }}>
                            잔액 {formatKrw(account.actualCash)} · 기대 {formatKrw(account.expectedCash)}
                            {account.cashStatus !== 'ok' && ` · 차이 ${formatKrw(account.cashDiff)}`}
                          </div>
                          <div className="caption muted" style={{ marginTop: 4 }}>
                            거래 {account.tradeCount}건 · 보유 {account.holdingCount}종목
                            {account.adjustCount > 0 && ` · 조정 ${account.adjustCount}건`}
                          </div>
                          {account.issues.length > 0 && (
                            <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {account.issues.map((issue, idx) => (
                                <div key={idx} className="caption" style={{ color: 'var(--color-error)' }}>
                                  {issue.code ? `[${issue.code}] ` : ''}{issue.detail}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                {latest.detail?.staleHoldingCodes && latest.detail.staleHoldingCodes.length > 0 && (
                  <div className="caption" style={{ marginTop: 'var(--space-2)', color: '#92400E' }}>
                    최근 7일 시세 없는 보유 종목: {latest.detail.staleHoldingCodes.join(', ')}
                  </div>
                )}

                {latest.detail?.freshness && !latest.detail.freshness.isHealthy && (
                  <div style={{ marginTop: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {latest.detail.freshness.staleItems.map((item) => (
                      <div key={item.key} className="caption" style={{ color: '#92400E' }}>
                        {item.label}: 최신 {item.latestDate ?? '없음'} ({item.staleBizDays ?? '?'}영업일 경과, 허용 {item.maxBizDays}일)
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })()}

          <div className="title-md" style={{ marginBottom: 'var(--space-2)' }}>최근 검산 이력</div>
          {history.length === 0 ? (
            <div className="caption muted">이전 이력이 없습니다.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {history.map((row) => {
                const badge = healthBadge(row.is_healthy)
                const expanded = expandedId === row.id
                return (
                  <div key={row.id} className="card" style={{ padding: 'var(--space-3)' }}>
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : row.id)}
                      style={{ display: 'flex', width: '100%', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left' }}
                    >
                      <span className="caption" style={{ color: 'var(--color-text-secondary)' }}>
                        {row.audit_date} · 계정 {row.account_count} · 이슈 {row.issue_count}
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <span className="caption" style={{ borderRadius: 999, padding: '2px 8px', background: badge.bg, color: badge.color, fontWeight: 700 }}>
                          {badge.label}
                        </span>
                        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </span>
                    </button>
                    {expanded && (
                      <pre className="caption" style={{ marginTop: 'var(--space-2)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit', color: 'var(--color-text-secondary)' }}>
                        {row.summary}
                      </pre>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── 메인 페이지 ──────────────────────────────────────────────────

export default function ControlPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = normalizeTab(searchParams.get('tab'))

  const selectTab = useCallback((tab: ControlTabKey) => {
    setSearchParams(tab === 'audit' ? {} : { tab }, { replace: true })
  }, [setSearchParams])

  return (
    <div>
      <section className="container-app" style={{ paddingBottom: 0 }}>
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <h1 className="title-xl">관제</h1>
          <p className="muted">검산·운영·데이터·유지보수를 한 화면에서 점검합니다.</p>
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
          {CONTROL_TABS.map((tab) => (
            <Button
              key={tab.key}
              variant={activeTab === tab.key ? 'primary' : 'ghost'}
              onClick={() => selectTab(tab.key)}
            >
              {tab.label}
            </Button>
          ))}
        </div>

        {activeTab === 'audit' && <IntegrityAuditPanel />}
      </section>

      {/* 운영/데이터/유지보수 탭은 기존 페이지를 그대로 호스팅 (자체 container-app 포함) */}
      {activeTab !== 'audit' && (
        <Suspense fallback={<section className="container-app"><Skeleton lines={8} height={16} /></section>}>
          {activeTab === 'operations' && <OperationsPanel />}
          {activeTab === 'data' && <DataPanel />}
          {activeTab === 'maintenance' && <MaintenancePanel />}
        </Suspense>
      )}
    </div>
  )
}
