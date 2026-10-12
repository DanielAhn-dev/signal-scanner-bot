import React from 'react'
import { formatNumber } from '../../../lib/format'
import Button from '../../../components/ui/Button'
import Detail from '../../../components/ui/Detail'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { autoSourceLabelByMode, parseCodes } from '../lib/codes'
import { getCandidateScoreByVersion } from '../lib/candidateRank'
import { formatFlowBadgeLabel } from '../lib/diversify'
import type { AutoCandidate, CandidateMode, ScoreVersion } from '../types'

export type AutoFinderCardProps = {
  codesText: string
  setCodesText: React.Dispatch<React.SetStateAction<string>>
  setSourceLabel: React.Dispatch<React.SetStateAction<string>>
  autoCandidates: AutoCandidate[]
  autoLoading: boolean
  autoError: string | null
  candidateMode: CandidateMode
  setCandidateMode: React.Dispatch<React.SetStateAction<CandidateMode>>
  scoreVersion: ScoreVersion
  setScoreVersion: React.Dispatch<React.SetStateAction<ScoreVersion>>
  showAutoFinder: boolean
  setShowAutoFinder: React.Dispatch<React.SetStateAction<boolean>>
  visibleAutoCandidates: AutoCandidate[]
  loadAutoCandidates: () => void | Promise<void>
  useAutoCandidatesAsCodes: () => void
}

export default function AutoFinderCard({
  codesText,
  setCodesText,
  setSourceLabel,
  autoCandidates,
  autoLoading,
  autoError,
  candidateMode,
  setCandidateMode,
  scoreVersion,
  setScoreVersion,
  showAutoFinder,
  setShowAutoFinder,
  visibleAutoCandidates,
  loadAutoCandidates,
  useAutoCandidatesAsCodes,
}: AutoFinderCardProps) {
  return (
    <Detail>
    <div>
      <Button variant="ghost" onClick={() => setShowAutoFinder((v) => !v)}>
        {showAutoFinder ? <>자동 후보 찾기 접기 <ChevronUp size={14} aria-hidden /></> : <>{`자동 후보 찾기 (고급)${autoCandidates.length > 0 ? ` · ${autoCandidates.length}건` : ''}`} <ChevronDown size={14} aria-hidden /></>}
      </Button>
    </div>

    {(showAutoFinder || autoCandidates.length > 0 || autoLoading) && (
    <div className="card" style={{ padding: 'var(--space-3)' }}>
      <div className="flex-between" style={{ gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        <div>
          <div className="title-md">자동 후보 찾기</div>
          <div className="caption">눌림목/집행우선 데이터를 합쳐 퀵점수·적응점수·리드단계·수급액(5D/20D)·거래대금 중심으로 우선순위를 제시합니다.</div>
        </div>
      </div>

      <div style={{ marginTop: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button
            variant={candidateMode === 'balanced' ? 'primary' : 'secondary'}
            onClick={() => setCandidateMode('balanced')}
            disabled={autoLoading}
          >
            밸런스 모드
          </Button>
          <Button
            variant={candidateMode === 'multibagger' ? 'primary' : 'secondary'}
            onClick={() => setCandidateMode('multibagger')}
            disabled={autoLoading}
          >
            멀티배거 모드
          </Button>
          <Button
            variant={candidateMode === 'swing' ? 'primary' : 'secondary'}
            onClick={() => setCandidateMode('swing')}
            disabled={autoLoading}
          >
            스윙 모드
          </Button>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button
            variant={scoreVersion === 'v2' ? 'primary' : 'secondary'}
            onClick={() => setScoreVersion('v2')}
            disabled={autoLoading}
          >
            점수 v2
          </Button>
          <Button
            variant={scoreVersion === 'legacy' ? 'primary' : 'secondary'}
            onClick={() => setScoreVersion('legacy')}
            disabled={autoLoading}
          >
            점수 legacy
          </Button>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={loadAutoCandidates} disabled={autoLoading}>
            {autoLoading ? '후보 탐색 중…' : '자동 후보 찾기 실행'}
          </Button>
          <Button variant="secondary" onClick={useAutoCandidatesAsCodes} disabled={autoCandidates.length === 0}>
            상위 후보 코드 반영
          </Button>
        </div>
      </div>

      <div className="caption" style={{ marginTop: 8 }}>
        자동 후보 모드: {candidateMode === 'multibagger' ? '멀티배거(수급 20D·리드·상승여력 강화)' : candidateMode === 'swing' ? '스윙(눌림·추세·안전성·20D수급 우선 / 당일급등 제외)' : '밸런스(단기 집행 안정성 중심)'}
        {' · '}점수 버전: {scoreVersion === 'v2' ? 'v2(후보점수-리스크 분리)' : 'legacy(기존 가중합)'}
      </div>

      {autoError && <div className="caption" style={{ color: 'var(--color-error)', marginTop: 8 }}>{autoError}</div>}

      {visibleAutoCandidates.length > 0 && (
        <div style={{ marginTop: 'var(--space-2)', display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          {visibleAutoCandidates.map((row) => (
            <button
              key={`${row.code}-${row.source}`}
              type="button"
              onClick={() => {
                const next = new Set(parseCodes(codesText))
                next.add(row.code)
                setCodesText([...next].join(', '))
                setSourceLabel(autoSourceLabelByMode(candidateMode))
              }}
              style={{
                border: '1px solid var(--color-border-default)',
                background: 'var(--color-bg-surface)',
                borderRadius: 'var(--radius-sm)',
                padding: '8px 10px',
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ fontWeight: 700 }}>{row.name} ({row.code})</div>
                <span className="scan-grade-badge scan-grade-a" style={{ fontSize: 11 }}>
                  {formatNumber(getCandidateScoreByVersion(row, scoreVersion), 1)}
                </span>
              </div>
              <div className="caption" style={{ marginTop: 4 }}>
                후보점수 {row.upsideSignal != null ? formatNumber(row.upsideSignal, 1) : '—'} · 리스크 {row.riskSignal != null ? formatNumber(row.riskSignal, 1) : '—'}
              </div>
              <div className="caption" style={{ marginTop: 2 }}>
                v2 {formatNumber(row.score, 1)} / legacy {formatNumber(row.scoreLegacy, 1)}
              </div>
              <div className="caption" style={{ marginTop: 4, color: row.netFlow5d != null && row.netFlow5d < 0 ? 'var(--color-error)' : 'var(--color-text-secondary)' }}>
                {formatFlowBadgeLabel(row.netFlow5d, row.netFlow20d)}
              </div>
              <div className="caption" style={{ marginTop: 4 }}>[{row.source === 'highlights' ? '집행우선' : '눌림목'}] {row.reason}</div>
            </button>
          ))}
        </div>
      )}
    </div>
    )}
    </Detail>
  )
}
