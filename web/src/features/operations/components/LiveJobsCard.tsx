import React from 'react'
import { formatKrw } from '../../../lib/format'
import Button from '../../../components/ui/Button'
import { resolveFailureCause } from '../lib/memo'
import { getTimelineMeta, normalizeJobState, progressFill, renderRunSummary, resolveTaskLabel } from '../lib/jobs'
import type { JobSnapshot, OpStatus } from '../types'

export type LiveJobsCardProps = {
  autocycleStatus: OpStatus
  autotriggerStatus: OpStatus
  setSelectedDryRunJobId: React.Dispatch<React.SetStateAction<string | null>>
  liveJobItems: JobSnapshot[]
  watchingJobIds: string[]
  refreshJobSnapshot: (jobId: string, silent?: boolean) => Promise<void>
  expandedJobIds: string[]
  setExpandedJobIds: React.Dispatch<React.SetStateAction<string[]>>
  retryJob: (snapshot: JobSnapshot) => Promise<void>
}

export default function LiveJobsCard({
  autocycleStatus,
  autotriggerStatus,
  setSelectedDryRunJobId,
  liveJobItems,
  watchingJobIds,
  refreshJobSnapshot,
  expandedJobIds,
  setExpandedJobIds,
  retryJob,
}: LiveJobsCardProps) {
  return (
    <div className="card card-lg" style={{ marginBottom: 'var(--space-6)' }}>
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
  )
}
