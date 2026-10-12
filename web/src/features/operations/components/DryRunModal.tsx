import React from 'react'
import { formatKstDateTime } from '../../../lib/format'
import Modal from '../../../components/Modal'
import { classifyDryRunNote } from '../lib/memo'
import { getTimelineMeta, renderRunSummary, resolveTaskLabel } from '../lib/jobs'
import type { JobSnapshot } from '../types'

export type DryRunModalProps = {
  setSelectedDryRunJobId: React.Dispatch<React.SetStateAction<string | null>>
  selectedDryRunSnapshot: JobSnapshot | null
}

export default function DryRunModal({
  setSelectedDryRunJobId,
  selectedDryRunSnapshot,
}: DryRunModalProps) {
  return (
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
                      <span className="caption muted">{formatKstDateTime(event.ts)}</span>
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
  )
}
