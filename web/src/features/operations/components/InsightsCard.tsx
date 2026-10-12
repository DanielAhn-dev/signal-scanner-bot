import React from 'react'
import { formatKstDateTime } from '../../../lib/format'
import Button from '../../../components/ui/Button'
import { decisionTone, estimateMissingReason, filterLatestCompareRows, filterRunCompareRows, normalizeDecisionFilter, runStatusLabel, runStatusTone } from '../lib/insights'
import type { AutoCycleInsights } from '../types'

export type InsightsCardProps = {
  autocycleInsights: AutoCycleInsights | null
  autocycleInsightsLoading: boolean
  loadAutoCycleInsights: () => void | Promise<void>
  insightTab: 'summary' | 'details'
  setInsightTab: React.Dispatch<React.SetStateAction<'summary' | 'details'>>
  expandedInsightRunIds: number[]
  setExpandedInsightRunIds: React.Dispatch<React.SetStateAction<number[]>>
  latestCompareDecisionFilter: 'ALL' | 'BUY' | 'SKIP' | 'HOLD' | 'SELL' | 'ERROR'
  setLatestCompareDecisionFilter: React.Dispatch<React.SetStateAction<'ALL' | 'BUY' | 'SKIP' | 'HOLD' | 'SELL' | 'ERROR'>>
  latestReasonCategoryFilter: string
  setLatestReasonCategoryFilter: React.Dispatch<React.SetStateAction<string>>
  runCompareDecisionFilterById: Record<number, 'ALL' | 'BUY' | 'SKIP' | 'HOLD' | 'SELL' | 'ERROR'>
  setRunCompareDecisionFilterById: React.Dispatch<React.SetStateAction<Record<number, 'ALL' | 'BUY' | 'SKIP' | 'HOLD' | 'SELL' | 'ERROR'>>>
}

export default function InsightsCard({
  autocycleInsights,
  autocycleInsightsLoading,
  loadAutoCycleInsights,
  insightTab,
  setInsightTab,
  expandedInsightRunIds,
  setExpandedInsightRunIds,
  latestCompareDecisionFilter,
  setLatestCompareDecisionFilter,
  latestReasonCategoryFilter,
  setLatestReasonCategoryFilter,
  runCompareDecisionFilterById,
  setRunCompareDecisionFilterById,
}: InsightsCardProps) {
  return (
    <div className="card card-lg" style={{ marginBottom: 'var(--space-6)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap', marginBottom: 'var(--space-3)' }}>
        <div>
          <div className="title-lg">자동매매 실행 인사이트</div>
          <div className="caption muted" style={{ marginTop: 'var(--space-1)' }}>
            후보 생성부터 최종 체결까지, 왜 매수가 없었는지 퍼널과 게이트 사유를 시각적으로 보여줍니다.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
          <Button variant={insightTab === 'summary' ? 'primary' : 'ghost'} onClick={() => setInsightTab('summary')}>
            요약
          </Button>
          <Button variant={insightTab === 'details' ? 'primary' : 'ghost'} onClick={() => setInsightTab('details')}>
            상세
          </Button>
          <Button variant="ghost" onClick={() => { void loadAutoCycleInsights() }} disabled={autocycleInsightsLoading}>
            {autocycleInsightsLoading ? '조회 중...' : '새로고침'}
          </Button>
        </div>
      </div>

      {!autocycleInsightsLoading && !autocycleInsights?.latest && (
        <div className="caption muted">최근 실행 데이터가 없습니다. 자동사이클을 한 번 실행하면 인사이트가 생성됩니다.</div>
      )}

      {!autocycleInsightsLoading && autocycleInsights?.latest && (
        <>
          {insightTab === 'summary' && (
          <div className="card" style={{ marginBottom: 'var(--space-3)', background: '#FAFCFF' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <div>
                <div className="font-medium">최신 실행: {autocycleInsights.latest.run_type} · {autocycleInsights.latest.run_key}</div>
                <div className="caption muted" style={{ marginTop: 4 }}>{formatKstDateTime(autocycleInsights.latest.started_at)}</div>
              </div>
              {(() => {
                const tone = runStatusTone(autocycleInsights.latest.status)
                return (
                  <span className="caption" style={{ borderRadius: 999, padding: '4px 10px', background: tone.bg, color: tone.color, fontWeight: 700 }}>
                    {runStatusLabel(autocycleInsights.latest.status)}
                  </span>
                )
              })()}
            </div>

            <div className="caption" style={{ marginTop: 'var(--space-2)', color: 'var(--color-text-secondary)' }}>
              매수 {autocycleInsights.latest.buys} · 매도 {autocycleInsights.latest.sells} · 스킵 {autocycleInsights.latest.skipped} · 오류 {autocycleInsights.latest.errors}
            </div>

            <div className="card" style={{ marginTop: 'var(--space-2)', padding: 'var(--space-2)', background: '#F7FAFF', borderColor: '#D7E6FF' }}>
              <div className="caption muted" style={{ marginBottom: 4 }}>한줄 진단</div>
              <div className="caption" style={{ color: 'var(--color-text-secondary)', fontWeight: 600 }}>
                {autocycleInsights.latest.diagnosis_line || '진단 데이터가 아직 없습니다.'}
              </div>
            </div>

            {autocycleInsights.latest.diagnosis_breakdown.length > 0 && (
              <div className="card" style={{ marginTop: 'var(--space-2)', padding: 'var(--space-2)' }}>
                <div className="caption muted" style={{ marginBottom: 6 }}>원인 비중 (클릭하면 아래 비교표 필터)</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {autocycleInsights.latest.diagnosis_breakdown.map((item, idx) => (
                    <button
                      key={`diag-breakdown-${idx}`}
                      onClick={() => {
                        setLatestReasonCategoryFilter((prev) => prev === item.label ? 'ALL' : item.label)
                        setLatestCompareDecisionFilter('ALL')
                      }}
                      style={{
                        border: latestReasonCategoryFilter === item.label ? '1px solid #2563EB' : '1px solid #E4E7EC',
                        borderRadius: 8,
                        background: latestReasonCategoryFilter === item.label ? '#EFF6FF' : '#fff',
                        padding: '6px 8px',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span className="caption" style={{ color: 'var(--color-text-secondary)' }}>{item.label}</span>
                        <span className="caption muted">{item.ratio.toFixed(1)}% ({item.count})</span>
                      </div>
                      <div style={{ marginTop: 4, height: 6, borderRadius: 999, background: '#EDF2F7', overflow: 'hidden' }}>
                        <div style={{ width: `${Math.max(3, Math.min(100, item.ratio))}%`, height: '100%', background: '#3B82F6' }} />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {autocycleInsights.latest.funnel && (
              <div style={{ marginTop: 'var(--space-3)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 'var(--space-2)' }}>
                <div className="card" style={{ padding: 'var(--space-2)' }}>
                  <div className="caption muted">초기</div>
                  <div className="font-medium">{autocycleInsights.latest.funnel.initial}</div>
                </div>
                <div className="card" style={{ padding: 'var(--space-2)' }}>
                  <div className="caption muted">정책 통과</div>
                  <div className="font-medium">{autocycleInsights.latest.funnel.policy}</div>
                </div>
                <div className="card" style={{ padding: 'var(--space-2)' }}>
                  <div className="caption muted">기본 필터</div>
                  <div className="font-medium">{autocycleInsights.latest.funnel.base}</div>
                </div>
                <div className="card" style={{ padding: 'var(--space-2)' }}>
                  <div className="caption muted">후보 풀</div>
                  <div className="font-medium">{autocycleInsights.latest.funnel.pool}</div>
                </div>
                <div className="card" style={{ padding: 'var(--space-2)' }}>
                  <div className="caption muted">최종 후보</div>
                  <div className="font-medium">{autocycleInsights.latest.funnel.selected}</div>
                </div>
              </div>
            )}

            {(autocycleInsights.latest.key_gate_reasons.length > 0 || autocycleInsights.latest.top_reject_reasons.length > 0) && (
              <div style={{ marginTop: 'var(--space-3)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 'var(--space-2)' }}>
                <div className="card" style={{ padding: 'var(--space-2)' }}>
                  <div className="caption muted" style={{ marginBottom: 6 }}>왜 매수가 없었나(게이트)</div>
                  {autocycleInsights.latest.key_gate_reasons.length > 0 ? (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {autocycleInsights.latest.key_gate_reasons.map((reason, idx) => (
                        <span key={`gate-${idx}`} className="caption" style={{ borderRadius: 999, padding: '2px 8px', background: '#FFF4E5', color: '#92400E', fontWeight: 700 }}>{reason}</span>
                      ))}
                    </div>
                  ) : (
                    <div className="caption muted">주요 게이트 차단 신호 없음</div>
                  )}
                </div>
                <div className="card" style={{ padding: 'var(--space-2)' }}>
                  <div className="caption muted" style={{ marginBottom: 6 }}>탈락 상위 사유</div>
                  {autocycleInsights.latest.top_reject_reasons.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {autocycleInsights.latest.top_reject_reasons.map((reason, idx) => (
                        <div key={`reject-${idx}`} className="caption" style={{ color: 'var(--color-text-secondary)' }}>{reason}</div>
                      ))}
                    </div>
                  ) : (
                    <div className="caption muted">탈락 사유 데이터 없음</div>
                  )}
                </div>
              </div>
            )}

            <div style={{ marginTop: 'var(--space-3)' }}>
              <div className="title-md" style={{ marginBottom: 'var(--space-2)' }}>
                스캔 TOP 원본 (점수순)
              </div>
              {autocycleInsights.scan_top_rows.length > 0 ? (
                <div className="ops-compare-table" style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', marginBottom: 'var(--space-3)' }}>
                  <table style={{ minWidth: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid var(--color-border-default)', whiteSpace: 'nowrap' }}>종목</th>
                        <th style={{ textAlign: 'right', padding: '8px', borderBottom: '1px solid var(--color-border-default)', whiteSpace: 'nowrap' }}>점수</th>
                        <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid var(--color-border-default)', whiteSpace: 'nowrap' }}>신호</th>
                        <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid var(--color-border-default)', whiteSpace: 'nowrap' }}>집행후보 포함</th>
                        <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid var(--color-border-default)', whiteSpace: 'nowrap', minWidth: 200 }}>미포함/차단 추정</th>
                      </tr>
                    </thead>
                    <tbody>
                      {autocycleInsights.scan_top_rows.map((row, idx) => {
                        // 실행 기록(latest)이 아직 없어도 스캔 상위는 있을 수 있다 — 예전엔 여기서 null을 읽어 화면이 멈췄다
                        const latestRun = autocycleInsights.latest
                        const compareEntry = latestRun?.compare_rows.find((item) => item.code === row.code)
                        const included = Boolean(compareEntry)
                        const estimatedReason = compareEntry
                          ? compareEntry.reason
                          : (row.exclusion_reason || (latestRun ? estimateMissingReason({ signal: row.signal, latest: latestRun }) : '실행 기록 없음'))
                        return (
                          <tr key={`scan-top-${idx}`} data-label={row.name || row.code}>
                            <td style={{ padding: '8px', borderBottom: '1px solid #F0F2F5', whiteSpace: 'nowrap' }} data-th="종목">{row.name || row.code}{row.name ? ` (${row.code})` : ''}</td>
                            <td style={{ padding: '8px', borderBottom: '1px solid #F0F2F5', textAlign: 'right', whiteSpace: 'nowrap' }} data-th="점수">{row.score.toFixed(1)}</td>
                            <td style={{ padding: '8px', borderBottom: '1px solid #F0F2F5', whiteSpace: 'nowrap' }} data-th="신호">{row.signal || '-'}</td>
                            <td style={{ padding: '8px', borderBottom: '1px solid #F0F2F5', whiteSpace: 'nowrap' }} data-th="집행후보 포함">
                              <span className="caption" style={{ borderRadius: 999, padding: '2px 8px', background: included ? '#E8F7F3' : '#F5F7FA', color: included ? '#0F766E' : '#667085', fontWeight: 700 }}>
                                {included ? '포함' : '미포함'}
                              </span>
                            </td>
                            <td style={{ padding: '8px', borderBottom: '1px solid #F0F2F5', color: 'var(--color-text-secondary)', minWidth: 200 }} data-th="미포함/차단 추정">{estimatedReason}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  <div className="caption muted" style={{ marginTop: 6 }}>
                    score asof: {autocycleInsights.score_asof || '-'}
                  </div>
                </div>
              ) : (
                <div className="caption muted" style={{ marginBottom: 'var(--space-3)' }}>스캔 TOP 원본 데이터가 없습니다.</div>
              )}

              <div className="title-md" style={{ marginBottom: 'var(--space-2)' }}>TOP 후보 vs 최종 미체결</div>
              {autocycleInsights.latest.compare_rows.length > 0 ? (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                    <div className="ops-filter-pills" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {(['ALL', 'BUY', 'SKIP', 'HOLD', 'SELL', 'ERROR'] as const).map((kind) => {
                        const active = latestCompareDecisionFilter === kind
                        return (
                          <button
                            key={`latest-compare-filter-${kind}`}
                            onClick={() => setLatestCompareDecisionFilter(kind)}
                            className="ops-filter-pill"
                            style={{
                              border: active ? '1px solid #2563EB' : '1px solid #D0D5DD',
                              background: active ? '#EBF3FF' : '#fff',
                              color: active ? '#0B57D0' : '#475467',
                            }}
                          >
                            {kind}
                          </button>
                        )
                      })}
                    </div>
                    {latestReasonCategoryFilter !== 'ALL' && (
                      <button
                        onClick={() => setLatestReasonCategoryFilter('ALL')}
                        className="ops-filter-pill"
                        style={{
                          border: '1px solid #D0D5DD',
                          background: '#fff',
                          color: '#475467',
                        }}
                      >
                        원인필터 해제
                      </button>
                    )}
                  </div>

                  {(() => {
                    const filteredRows = filterLatestCompareRows(
                      autocycleInsights.latest.compare_rows,
                      latestCompareDecisionFilter,
                      latestReasonCategoryFilter,
                    )

                    if (filteredRows.length <= 0) {
                      return <div className="caption muted">현재 필터 조건에 맞는 비교 행이 없습니다.</div>
                    }

                    return (
                <div className="ops-compare-table" style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                  <table style={{ minWidth: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid var(--color-border-default)', whiteSpace: 'nowrap' }}>종목</th>
                        <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid var(--color-border-default)', whiteSpace: 'nowrap' }}>결과</th>
                        <th style={{ textAlign: 'left', padding: '8px', borderBottom: '1px solid var(--color-border-default)', whiteSpace: 'nowrap', minWidth: 200 }}>사유</th>
                        <th style={{ textAlign: 'right', padding: '8px', borderBottom: '1px solid var(--color-border-default)', whiteSpace: 'nowrap' }}>점수</th>
                        <th style={{ textAlign: 'right', padding: '8px', borderBottom: '1px solid var(--color-border-default)', whiteSpace: 'nowrap' }}>기술관문</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRows.map((row, idx) => {
                        const tone = decisionTone(row.decision)
                        const trustText = row.trust_score != null
                          ? row.min_trust_score != null
                            ? `${row.trust_score.toFixed(0)} / ${row.min_trust_score.toFixed(0)}`
                            : `${row.trust_score.toFixed(0)}`
                          : '-'
                        return (
                          <tr key={`compare-row-${idx}`} data-label={row.code}>
                            <td style={{ padding: '8px', borderBottom: '1px solid #F0F2F5', whiteSpace: 'nowrap' }} data-th="종목">{row.code}</td>
                            <td style={{ padding: '8px', borderBottom: '1px solid #F0F2F5', whiteSpace: 'nowrap' }} data-th="결과">
                              <span className="caption" style={{ borderRadius: 999, padding: '2px 8px', background: tone.bg, color: tone.color, fontWeight: 700 }}>{row.decision}</span>
                            </td>
                            <td style={{ padding: '8px', borderBottom: '1px solid #F0F2F5', color: 'var(--color-text-secondary)', minWidth: 200 }} data-th="사유">{row.reason}</td>
                            <td style={{ padding: '8px', borderBottom: '1px solid #F0F2F5', textAlign: 'right', whiteSpace: 'nowrap' }} data-th="점수">{row.score != null ? row.score.toFixed(1) : '-'}</td>
                            <td style={{ padding: '8px', borderBottom: '1px solid #F0F2F5', textAlign: 'right', whiteSpace: 'nowrap' }} data-th="기술관문">{trustText}</td>
                          </tr>
                        )
                      })}</tbody>
                  </table>
                </div>
                    )
                  })()}
                </div>
              ) : (
                <div className="caption muted">비교 가능한 액션 로그가 없습니다.</div>
              )}
            </div>
          </div>
          )}

          {insightTab === 'details' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {autocycleInsights.recent_runs.slice(0, 5).map((run) => {
              const tone = runStatusTone(run.status)
              const expanded = expandedInsightRunIds.includes(run.id)
              return (
                <div key={`insight-run-${run.id}`} className="card" style={{ padding: 'var(--space-3)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                    <div className="caption" style={{ color: 'var(--color-text-secondary)' }}>
                      {run.run_type} · {run.run_key} · {formatKstDateTime(run.started_at)}
                    </div>
                    <span className="caption" style={{ borderRadius: 999, padding: '2px 8px', background: tone.bg, color: tone.color, fontWeight: 700 }}>
                      {runStatusLabel(run.status)}
                    </span>
                  </div>
                  <div className="caption muted" style={{ marginTop: 4 }}>
                    매수 {run.buys} · 매도 {run.sells} · 스킵 {run.skipped} · 오류 {run.errors}
                  </div>
                  <div className="caption" style={{ marginTop: 6, color: 'var(--color-text-secondary)' }}>
                    {run.diagnosis_line || '요약 진단 없음'}
                  </div>

                  <div style={{ marginTop: 'var(--space-2)' }}>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setExpandedInsightRunIds((prev) => prev.includes(run.id) ? prev.filter((id) => id !== run.id) : [...prev, run.id])
                      }}
                    >
                      {expanded ? '상세 접기' : '상세 펼치기'}
                    </Button>
                  </div>

                  {expanded && (
                    <div style={{ marginTop: 'var(--space-2)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 'var(--space-2)' }}>
                      <div className="card" style={{ padding: 'var(--space-2)' }}>
                        <div className="caption muted" style={{ marginBottom: 6 }}>주요 노트</div>
                        {run.notes.length > 0 ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            {run.notes.slice(0, 6).map((note, idx) => (
                              <div key={`run-note-${run.id}-${idx}`} className="caption" style={{ color: 'var(--color-text-secondary)' }}>{note}</div>
                            ))}
                          </div>
                        ) : (
                          <div className="caption muted">노트 없음</div>
                        )}
                      </div>
                      <div className="card" style={{ padding: 'var(--space-2)' }}>
                        <div className="caption muted" style={{ marginBottom: 6 }}>주요 차단 사유</div>
                        {run.key_gate_reasons.length > 0 ? (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {run.key_gate_reasons.map((reason, idx) => (
                              <span key={`run-gate-${run.id}-${idx}`} className="caption" style={{ borderRadius: 999, padding: '2px 8px', background: '#FFF4E5', color: '#92400E', fontWeight: 700 }}>{reason}</span>
                            ))}
                          </div>
                        ) : (
                          <div className="caption muted">게이트 차단 없음</div>
                        )}
                      </div>

                      <div className="card" style={{ padding: 'var(--space-2)', gridColumn: '1 / -1' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                          <div className="caption muted">액션 비교 행</div>
                          <div className="ops-filter-pills" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {(['ALL', 'BUY', 'SKIP', 'HOLD', 'SELL', 'ERROR'] as const).map((kind) => {
                              const current = normalizeDecisionFilter(runCompareDecisionFilterById[run.id])
                              const active = current === kind
                              return (
                                <button
                                  key={`run-filter-${run.id}-${kind}`}
                                  onClick={() => {
                                    setRunCompareDecisionFilterById((prev) => ({ ...prev, [run.id]: kind }))
                                  }}
                                  className="ops-filter-pill"
                                  style={{
                                    border: active ? '1px solid #2563EB' : '1px solid #D0D5DD',
                                    background: active ? '#EBF3FF' : '#fff',
                                    color: active ? '#0B57D0' : '#475467',
                                  }}
                                >
                                  {kind}
                                </button>
                              )
                            })}
                          </div>
                        </div>

                        {(() => {
                          const decisionFilter = normalizeDecisionFilter(runCompareDecisionFilterById[run.id])
                          const filteredRows = filterRunCompareRows(run.compare_rows, decisionFilter)

                          if (filteredRows.length <= 0) {
                            return <div className="caption muted">해당 필터의 액션 행이 없습니다.</div>
                          }

                          return (
                            <div className="ops-compare-table" style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                              <table style={{ minWidth: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                                <thead>
                                  <tr>
                                    <th style={{ textAlign: 'left', padding: '6px', borderBottom: '1px solid #E4E7EC', whiteSpace: 'nowrap' }}>종목</th>
                                    <th style={{ textAlign: 'left', padding: '6px', borderBottom: '1px solid #E4E7EC', whiteSpace: 'nowrap' }}>결과</th>
                                    <th style={{ textAlign: 'left', padding: '6px', borderBottom: '1px solid #E4E7EC', whiteSpace: 'nowrap', minWidth: 180 }}>사유</th>
                                    <th style={{ textAlign: 'right', padding: '6px', borderBottom: '1px solid #E4E7EC', whiteSpace: 'nowrap' }}>점수</th>
                                    <th style={{ textAlign: 'right', padding: '6px', borderBottom: '1px solid #E4E7EC', whiteSpace: 'nowrap' }}>기술관문</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {filteredRows.map((row, idx) => {
                                    const tone = decisionTone(row.decision)
                                    const trustText = row.trust_score != null
                                      ? row.min_trust_score != null
                                        ? `${row.trust_score.toFixed(0)} / ${row.min_trust_score.toFixed(0)}`
                                        : `${row.trust_score.toFixed(0)}`
                                      : '-'
                                    return (
                                      <tr key={`run-compare-${run.id}-${idx}`} data-label={row.code}>
                                        <td style={{ padding: '6px', borderBottom: '1px solid #F0F2F5', whiteSpace: 'nowrap' }} data-th="종목">{row.code}</td>
                                        <td style={{ padding: '6px', borderBottom: '1px solid #F0F2F5', whiteSpace: 'nowrap' }} data-th="결과">
                                          <span className="caption" style={{ borderRadius: 999, padding: '2px 8px', background: tone.bg, color: tone.color, fontWeight: 700 }}>{row.decision}</span>
                                        </td>
                                        <td style={{ padding: '6px', borderBottom: '1px solid #F0F2F5', color: 'var(--color-text-secondary)', minWidth: 180 }} data-th="사유">{row.reason}</td>
                                        <td style={{ padding: '6px', borderBottom: '1px solid #F0F2F5', textAlign: 'right', whiteSpace: 'nowrap' }} data-th="점수">{row.score != null ? row.score.toFixed(1) : '-'}</td>
                                        <td style={{ padding: '6px', borderBottom: '1px solid #F0F2F5', textAlign: 'right', whiteSpace: 'nowrap' }} data-th="기술관문">{trustText}</td>
                                      </tr>
                                    )
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )
                        })()}
                      </div>
                    </div>
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
