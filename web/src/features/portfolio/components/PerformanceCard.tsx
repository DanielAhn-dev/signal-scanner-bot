import { ChevronDown } from 'lucide-react'
import { formatKrwCompact, formatNumber } from '../../../lib/format'
import type { AdvisorPerformanceData } from '../types'

type PerformanceCardProps = {
  performanceAccordionOpen: boolean
  setPerformanceAccordionOpen: React.Dispatch<React.SetStateAction<boolean>>
  advisorPerfLoading: boolean
  advisorPerf: AdvisorPerformanceData
}

export default function PerformanceCard({
  performanceAccordionOpen,
  setPerformanceAccordionOpen,
  advisorPerfLoading,
  advisorPerf,
}: PerformanceCardProps) {
  return (
    <div className="card mb-4 portfolio-performance-card">
      <button
        type="button"
        className="portfolio-performance-head"
        onClick={() => setPerformanceAccordionOpen((prev) => !prev)}
        aria-expanded={performanceAccordionOpen}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: 'pointer',
          width: '100%',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: performanceAccordionOpen ? 'var(--space-3)' : 0,
        }}
      >
        <div>
          <div className="title-md">어드바이저 성과(최근 90일)</div>
          <div className="caption muted" style={{ marginTop: 'var(--space-1)' }}>
            {advisorPerfLoading
              ? '성과 데이터 조회 중...'
              : advisorPerf?.summary
                ? `실현승률 ${advisorPerf.summary.trustScore != null ? `${advisorPerf.summary.trustScore}%` : '표본 부족'} · 의사결정 ${advisorPerf.summary.totalDecisions ?? 0}건`
                : '데이터 없음'
            }
          </div>
        </div>
        <ChevronDown size={20} style={{ transform: performanceAccordionOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', flexShrink: 0 }} />
      </button>

      {performanceAccordionOpen && (
        <div className="portfolio-performance-body" style={{ paddingTop: 'var(--space-3)' }}>
          {advisorPerfLoading ? (
            <div className="caption muted">성과 데이터 조회 중...</div>
          ) : advisorPerf?.summary ? (
            <>
              <div className="portfolio-performance-grid">
                <div className="portfolio-performance-metric"><span title="실현 매도 10건 이상부터 계산">실현 승률</span><strong>{advisorPerf.summary.trustScore != null ? `${advisorPerf.summary.trustScore}%` : '표본 부족'}</strong></div>
                <div className="portfolio-performance-metric"><span>의사결정 수</span><strong>{advisorPerf.summary.totalDecisions ?? 0}</strong></div>
                <div className="portfolio-performance-metric"><span>매도 승률</span><strong>{advisorPerf.summary.linkedSellWinRatePct != null ? `${formatNumber(advisorPerf.summary.linkedSellWinRatePct, 1)}%` : '—'}</strong></div>
                <div className="portfolio-performance-metric"><span>누적 실현손익</span><strong>{formatKrwCompact(Number(advisorPerf.summary.linkedRealizedPnl || 0), { showPositiveSign: true })}</strong></div>
              </div>
              <div className="caption muted" style={{ marginTop: 'var(--space-3)' }}>
                최근 액션 샘플: {(advisorPerf.recent ?? []).slice(0, 3).map((row) => `${row.code || '-'} ${row.action || '-'} (${row.confidence != null ? `${formatNumber(Number(row.confidence), 0)}%` : '신뢰도 없음'})`).join(' · ') || '없음'}
              </div>
            </>
          ) : (
            <div className="caption muted">성과 데이터가 아직 없습니다. 거래/의사결정 로그가 쌓이면 자동 집계됩니다.</div>
          )}
        </div>
      )}
    </div>
  )
}
