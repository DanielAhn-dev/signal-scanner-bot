import React from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import Button from '../../../components/ui/Button'
import Input from '../../../components/ui/Input'

type FilterCardProps = {
  filterAccordionOpen: boolean
  setFilterAccordionOpen: React.Dispatch<React.SetStateAction<boolean>>
  selectedSector: string | null
  holdingStateFilter: 'all' | 'hold' | 'add' | 'partial'
  gradeFilter: 'all' | 'A' | 'B' | 'C'
  search: string
  searchInput: string
  includeCost: boolean
  setIncludeCost: (v: boolean) => void
  sectors: Array<{ id: string; name: string }>
  showAllSectors: boolean
  setShowAllSectors: React.Dispatch<React.SetStateAction<boolean>>
  onSectorChange: (sectorId: string | null) => void
  buyFeeRatePct: number
  setBuyFeeRatePct: (v: number) => void
  sellFeeRatePct: number
  setSellFeeRatePct: (v: number) => void
  setHoldingStateFilter: (v: 'all' | 'hold' | 'add' | 'partial') => void
  setGradeFilter: (v: 'all' | 'A' | 'B' | 'C') => void
  setPage: (v: number) => void
  safeGradeAThreshold: number
  safeGradeBThreshold: number
  gradeAThreshold: number
  setGradeAThreshold: (v: number) => void
  gradeBThreshold: number
  setGradeBThreshold: (v: number) => void
  addEntryMinScore: number
  setAddEntryMinScore: (v: number) => void
  partialTakeProfitPct: number
  setPartialTakeProfitPct: (v: number) => void
  partialWarnScoreMin: number
  setPartialWarnScoreMin: (v: number) => void
  onSearchChange: (v: string) => void
  setSearch: (v: string) => void
  loading: boolean
}

export default function FilterCard({
  filterAccordionOpen,
  setFilterAccordionOpen,
  selectedSector,
  holdingStateFilter,
  gradeFilter,
  search,
  searchInput,
  includeCost,
  setIncludeCost,
  sectors,
  showAllSectors,
  setShowAllSectors,
  onSectorChange,
  buyFeeRatePct,
  setBuyFeeRatePct,
  sellFeeRatePct,
  setSellFeeRatePct,
  setHoldingStateFilter,
  setGradeFilter,
  setPage,
  safeGradeAThreshold,
  safeGradeBThreshold,
  gradeAThreshold,
  setGradeAThreshold,
  gradeBThreshold,
  setGradeBThreshold,
  addEntryMinScore,
  setAddEntryMinScore,
  partialTakeProfitPct,
  setPartialTakeProfitPct,
  partialWarnScoreMin,
  setPartialWarnScoreMin,
  onSearchChange,
  setSearch,
  loading,
}: FilterCardProps) {
  return (
    <div className="card mb-4 portfolio-filter-card">
      <button
        type="button"
        className="portfolio-filter-head"
        onClick={() => setFilterAccordionOpen((prev) => !prev)}
        aria-expanded={filterAccordionOpen}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          width: '100%',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          padding: '0 0 var(--space-2) 0',
          marginBottom: filterAccordionOpen ? 'var(--space-2)' : '0',
          borderBottom: filterAccordionOpen ? '1px solid var(--color-border)' : 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span className="title-md" style={{ margin: 0 }}>필터 & 옵션</span>
          {(selectedSector || holdingStateFilter !== 'all' || gradeFilter !== 'all' || search || includeCost) && (
            <span className="caption" style={{ 
              backgroundColor: 'var(--color-warning-bg)', 
              color: 'var(--color-warning-text)',
              padding: '2px 8px',
              borderRadius: '12px',
              fontSize: 'var(--font-size-xs)',
            }}>
              {[
                selectedSector ? 1 : 0,
                holdingStateFilter !== 'all' ? 1 : 0,
                gradeFilter !== 'all' ? 1 : 0,
                search ? 1 : 0,
                includeCost ? 1 : 0,
              ].reduce((a, b) => a + b, 0)}개 필터 활성
            </span>
          )}
        </div>
        <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)' }} aria-hidden>
          {filterAccordionOpen ? <>접기 <ChevronUp size={14} aria-hidden /></> : <>펼치기 <ChevronDown size={14} aria-hidden /></>}
        </span>
      </button>

      {filterAccordionOpen && (
        <div className="portfolio-filter-stack">

        <div>
          <div className="caption portfolio-filter-label">섹터</div>
          <div className="tag-list">
            <button
              className={`tag${!selectedSector ? ' active' : ''}`}
              onClick={() => onSectorChange(null)}
            >전체</button>
            {(showAllSectors ? sectors : sectors.slice(0, 8)).map((s) => (
              <button
                key={s.id}
                className={`tag${selectedSector === s.id ? ' active' : ''}`}
                onClick={() => onSectorChange(s.id)}
              >{s.name}</button>
            ))}
            {sectors.length > 8 && (
              <button className="tag" onClick={() => setShowAllSectors(v => !v)}>
                {showAllSectors ? '접기' : `+ ${sectors.length - 8}개 더보기`}
              </button>
            )}
          </div>
        </div>

        <div>
          <div className="caption portfolio-filter-label">매매비용</div>
          <label className="portfolio-cost-toggle" title={`매수수수료 ${buyFeeRatePct}% + 매도수수료·거래세 ${sellFeeRatePct}%`}>
            <input
              type="checkbox"
              checked={includeCost}
              onChange={e => setIncludeCost(e.target.checked)}
            />
            <span>손익 계산에 포함</span>
          </label>
          <div className="caption muted" style={{ marginTop: 'var(--space-1)' }}>
            현재 기준: 매수수수료 {buyFeeRatePct}% + 매도수수료·거래세 {sellFeeRatePct}%
          </div>
        </div>

        <div>
          <div className="caption portfolio-filter-label">보유 상태</div>
          <div className="tag-list portfolio-segment-list">
            <button
              className={`tag${holdingStateFilter === 'all' ? ' active' : ''}`}
              onClick={() => { setHoldingStateFilter('all'); setPage(1) }}
            >
              전체
            </button>
            <button
              className={`tag${holdingStateFilter === 'hold' ? ' active' : ''}`}
              onClick={() => { setHoldingStateFilter('hold'); setPage(1) }}
            >
              보통 보유(홀드)
            </button>
            <button
              className={`tag${holdingStateFilter === 'add' ? ' active' : ''}`}
              onClick={() => { setHoldingStateFilter('add'); setPage(1) }}
            >
              추가매수(IN진입)
            </button>
            <button
              className={`tag${holdingStateFilter === 'partial' ? ' active' : ''}`}
              onClick={() => { setHoldingStateFilter('partial'); setPage(1) }}
            >
              부분청산 후보
            </button>
          </div>
        </div>

        <div>
          <div className="caption portfolio-filter-label">성과 등급</div>
          <div className="tag-list portfolio-segment-list">
            <button
              className={`tag${gradeFilter === 'all' ? ' active' : ''}`}
              onClick={() => { setGradeFilter('all'); setPage(1) }}
            >
              전체
            </button>
            <button
              className={`tag${gradeFilter === 'A' ? ' active' : ''}`}
              onClick={() => { setGradeFilter('A'); setPage(1) }}
            >
              A (점수 {safeGradeAThreshold} 이상)
            </button>
            <button
              className={`tag${gradeFilter === 'B' ? ' active' : ''}`}
              onClick={() => { setGradeFilter('B'); setPage(1) }}
            >
              B (점수 {safeGradeBThreshold}~{safeGradeAThreshold - 1})
            </button>
            <button
              className={`tag${gradeFilter === 'C' ? ' active' : ''}`}
              onClick={() => { setGradeFilter('C'); setPage(1) }}
            >
              C (점수 {safeGradeBThreshold - 1} 이하)
            </button>
          </div>
        </div>

        <div>
          <div className="caption portfolio-filter-label">기준값 조정</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--space-2)' }}>
            <Input
              label="A 등급 점수"
              type="number"
              value={String(gradeAThreshold)}
              onChange={(e: any) => setGradeAThreshold(Number(e?.target?.value || 80))}
            />
            <Input
              label="B 등급 점수"
              type="number"
              value={String(gradeBThreshold)}
              onChange={(e: any) => setGradeBThreshold(Number(e?.target?.value || 65))}
            />
            <Input
              label="추가매수 최소 점수"
              type="number"
              value={String(addEntryMinScore)}
              onChange={(e: any) => setAddEntryMinScore(Number(e?.target?.value || 70))}
            />
            <Input
              label="부분청산 후보 수익률(%)"
              type="number"
              value={String(partialTakeProfitPct)}
              onChange={(e: any) => setPartialTakeProfitPct(Number(e?.target?.value || 8))}
            />
            <Input
              label="부분청산 최소 warn_score"
              type="number"
              value={String(partialWarnScoreMin)}
              onChange={(e: any) => setPartialWarnScoreMin(Number(e?.target?.value || 3))}
            />
          </div>
          <div className="caption muted" style={{ marginTop: 'var(--space-1)' }}>
            등급은 종목 점수(total_score), 상태는 점수/수익률/신호/진입·추세·경고 등급과 warn_score 기준을 함께 반영해 자동 분류됩니다.
          </div>

          {includeCost && (
            <div style={{ marginTop: 'var(--space-3)', paddingTop: 'var(--space-2)', borderTop: '1px solid var(--color-border)' }}>
              <div className="caption" style={{ marginBottom: 'var(--space-2)', fontWeight: 'var(--font-weight-medium)' }}>매매비용 요율 설정</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 'var(--space-2)' }}>
                <Input
                  label="매수수수료 (%)"
                  type="number"
                  value={String(buyFeeRatePct)}
                  onChange={(e: any) => setBuyFeeRatePct(Math.max(0, Number(e?.target?.value ?? 0.015)))}
                />
                <Input
                  label="매도수수료+거래세 (%)"
                  type="number"
                  value={String(sellFeeRatePct)}
                  onChange={(e: any) => setSellFeeRatePct(Math.max(0, Number(e?.target?.value ?? 0.215)))}
                />
              </div>
              <div className="caption muted" style={{ marginTop: 'var(--space-1)' }}>
                기본값 매수 0.015% · 매도 0.215% (수수료 0.015% + 거래세 0.20%, 2026년~). ETF·ETN은 거래세가 없어 매도 시 수수료만 반영합니다. 설정은 이 브라우저에 저장됩니다.
              </div>
            </div>
          )}
        </div>

        <div className="portfolio-search-row">
          <input
            className="input portfolio-search-input"
            placeholder="코드 또는 종목명 검색"
            value={searchInput}
            onChange={e => onSearchChange(e.target.value)}
          />
          <Button className="portfolio-search-btn" variant="secondary" onClick={() => { setSearch(searchInput); setPage(1) }} disabled={loading}>
            검색
          </Button>
        </div>
        </div>
      )}
    </div>
  )
}
