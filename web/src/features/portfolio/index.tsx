import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Detail from '../../components/ui/Detail'
import Button from '../../components/ui/Button'
import { ErrorState } from '../../components/StateViews'
import Pagination from '../../components/Pagination'
import PortfolioHeader from './components/PortfolioHeader'
import FilterCard from './components/FilterCard'
import AssetOverviewCard from './components/AssetOverviewCard'
import HoldingList from './components/HoldingList'
import MacroCard from './components/MacroCard'
import PolicyCard from './components/PolicyCard'
import AccountDirectionCard from './components/AccountDirectionCard'
import { useProfileStore } from '../../stores/profileStore'
import PerformanceCard from './components/PerformanceCard'
import TradeModal from './components/modals/TradeModal'
import ShareModal from './components/modals/ShareModal'
import MaintenanceModal from './components/modals/MaintenanceModal'
import DeleteConfirmModal from './components/modals/DeleteConfirmModal'
import { usePositions } from './hooks/usePositions'
import { hasAccountParam, usePortfolioFilters } from './hooks/usePortfolioFilters'
import { useHoldingRules } from './hooks/useHoldingRules'
import { useTradeCost } from './hooks/useTradeCost'
import { useInvestmentPrefs } from './hooks/useInvestmentPrefs'
import { useMacroSnapshot } from './hooks/useMacroSnapshot'
import { useAccountPolicies } from './hooks/useAccountPolicies'
import { useAdvisorPerformance } from './hooks/useAdvisorPerformance'
import { usePortfolioView } from './hooks/usePortfolioView'
import { useTradeModal } from './hooks/useTradeModal'
import { useAccountAliases } from './hooks/useAccountAliases'
import { useMaintenance } from './hooks/useMaintenance'
import { useShare } from './hooks/useShare'
import { realHoldingTotal } from './lib/stockSizing'

export default function Portfolio() {
  const navigate = useNavigate()
  const isAdmin = useProfileStore((st) => st.isAdmin)
  const [performanceAccordionOpen, setPerformanceAccordionOpen] = useState(false)

  // 데이터·설정
  const {
    allRows, loading, refreshing, error, lastUpdatedAt, serverTotal, loadMoreLoading, accountFolders, load, loadMore,
  } = usePositions()
  const {
    page, setPage, pageSize, search, setSearch, searchInput, selectedSector, selectedAccountKey, setSelectedAccountKey,
    holdingStateFilter, setHoldingStateFilter, gradeFilter, setGradeFilter, showAllSectors, setShowAllSectors,
    filterAccordionOpen, setFilterAccordionOpen, sortKey, setSortKey, onSearchChange, onSectorChange,
  } = usePortfolioFilters()
  const {
    gradeAThreshold, setGradeAThreshold, gradeBThreshold, setGradeBThreshold, addEntryMinScore, setAddEntryMinScore,
    partialTakeProfitPct, setPartialTakeProfitPct, partialWarnScoreMin, setPartialWarnScoreMin,
    rules, safeGradeAThreshold, safeGradeBThreshold, safeAddEntryMinScore,
  } = useHoldingRules()
  const { includeCost, setIncludeCost, buyFeeRatePct, setBuyFeeRatePct, sellFeeRatePct, setSellFeeRatePct } = useTradeCost()
  const { initialCapital, dbSeedCapital, dbVirtualCash } = useInvestmentPrefs()
  const { macroLoading, macroRiskLevel } = useMacroSnapshot()
  const {
    policyLoading, policySaving, policyDraft, setPolicyDraft, policyByKey, savePolicyDraft, policyAccordionOpen, setPolicyAccordionOpen,
  } = useAccountPolicies({ selectedAccountKey, load })
  const { advisorPerf, advisorPerfLoading } = useAdvisorPerformance()
  const { aliases, rename: renameAccount } = useAccountAliases()

  // 파생값
  const {
    holdingAll, accountSummary, virtualHoldingRows, sectors, evaluateHoldingState, getPerformanceGrade, rows, total, totalPages,
    summaryRows, selectedAccountLabel, totalUnrealized, totalInvested, totalTradeCost, adjustedUnrealized, totalReturnPct,
    totalEvaluationValue, estimatedCash, totalAssetValue, tradeCostOpts, allocationRows, allocationChartStyle,
  } = usePortfolioView({
    allRows, accountFolders, selectedAccountKey, selectedSector, search, holdingStateFilter, gradeFilter, sortKey, page, pageSize,
    rules, macroRiskLevel, policyByKey, includeCost, buyFeeRatePct, sellFeeRatePct, initialCapital,
  })

  // 실제 계좌가 하나도 없으면(주소로 탭을 고르지 않았을 때) 실험 계좌를 먼저 보여 준다
  const realCount = holdingAll.length - virtualHoldingRows.length
  useEffect(() => {
    if (!loading && selectedAccountKey === 'real' && realCount === 0 && virtualHoldingRows.length > 0 && !hasAccountParam()) {
      setSelectedAccountKey('virtual')
    }
  }, [loading, realCount, virtualHoldingRows.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // 담을 크기(C66)의 분모 — 선택한 탭과 상관없이 실계좌 전체(개별주 한도와 같은 기준)
  const realTotal = useMemo(() => realHoldingTotal(holdingAll), [holdingAll])

  // 모달
  const trade = useTradeModal({ load })
  const maint = useMaintenance({ load, accountFolders })
  const share = useShare()
  const { openTradeModal } = trade
  const { openMaintenanceModal } = maint

  const portfolioHeaderSubtitle = refreshing
    ? '보유 포지션만 집중해서 관리합니다. · 업데이트 중...'
    : `보유 포지션만 집중해서 관리합니다. · 마지막 갱신 ${lastUpdatedAt
      ? new Date(lastUpdatedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : '-'}`

  return (
    <section className="container-app portfolio-page">
      <PortfolioHeader
        subtitle={portfolioHeaderSubtitle} onNavigateToCalendar={() => navigate('/market')}
        loading={loading} refreshing={refreshing} allRows={allRows} holdingAll={holdingAll} copyRows={summaryRows}
        onRefresh={() => load({ force: true })} onOpenShare={() => share.setShareModalOpen(true)}
        onOpenMaintenance={openMaintenanceModal}
        selectedAccountKey={selectedAccountKey} onSelectAccount={(key) => { setSelectedAccountKey(key); setPage(1) }}
        accountFolders={accountFolders} virtualCount={virtualHoldingRows.length} realCount={realCount}
        aliases={aliases} onRenameAccount={renameAccount}
        summaryCount={summaryRows.length} totalInvested={totalInvested} adjustedUnrealized={adjustedUnrealized}
        selectedAccountLabel={selectedAccountLabel} serverTotal={serverTotal}
        includeCost={includeCost} totalTradeCost={totalTradeCost}
      />

      {/* 필터 */}
      <FilterCard
        filterAccordionOpen={filterAccordionOpen} setFilterAccordionOpen={setFilterAccordionOpen}
        selectedSector={selectedSector} holdingStateFilter={holdingStateFilter} gradeFilter={gradeFilter}
        search={search} searchInput={searchInput}
        includeCost={includeCost} setIncludeCost={setIncludeCost}
        sectors={sectors} showAllSectors={showAllSectors} setShowAllSectors={setShowAllSectors} onSectorChange={onSectorChange}
        buyFeeRatePct={buyFeeRatePct} setBuyFeeRatePct={setBuyFeeRatePct}
        sellFeeRatePct={sellFeeRatePct} setSellFeeRatePct={setSellFeeRatePct}
        setHoldingStateFilter={setHoldingStateFilter} setGradeFilter={setGradeFilter} setPage={setPage}
        safeGradeAThreshold={safeGradeAThreshold} safeGradeBThreshold={safeGradeBThreshold}
        gradeAThreshold={gradeAThreshold} setGradeAThreshold={setGradeAThreshold}
        gradeBThreshold={gradeBThreshold} setGradeBThreshold={setGradeBThreshold}
        addEntryMinScore={addEntryMinScore} setAddEntryMinScore={setAddEntryMinScore}
        partialTakeProfitPct={partialTakeProfitPct} setPartialTakeProfitPct={setPartialTakeProfitPct}
        partialWarnScoreMin={partialWarnScoreMin} setPartialWarnScoreMin={setPartialWarnScoreMin}
        onSearchChange={onSearchChange} setSearch={setSearch} loading={loading}
      />

      {error && (
        <div className="portfolio-error-wrap">
          <ErrorState message={error} onRetry={() => load({ force: true })} />
        </div>
      )}

      {/* 실제 계좌: 방향은 내 계획을 물려받고 계좌마다 고르는 건 사용 시점뿐 */}
      {selectedAccountKey !== 'virtual' && realCount > 0 && (
        <AccountDirectionCard
          accountName={selectedAccountKey === 'real'
            ? accountFolders.map((f) => f.accountName).join(' ')
            : accountFolders.find((f) => f.key === selectedAccountKey)?.accountName ?? null}
        />
      )}

      <AssetOverviewCard
        selectedAccountKey={selectedAccountKey} accountFolders={accountFolders}
        initialCapital={initialCapital} totalEvaluationValue={totalEvaluationValue}
        dbVirtualCash={dbVirtualCash} estimatedCash={estimatedCash} totalAssetValue={totalAssetValue}
        allocationChartStyle={allocationChartStyle} allocationRows={allocationRows} dbSeedCapital={dbSeedCapital}
      />

      <HoldingList
        loading={loading} error={error} rows={rows}
        evaluateHoldingState={evaluateHoldingState} getPerformanceGrade={getPerformanceGrade}
        accountSummary={accountSummary} addEntryMinScore={safeAddEntryMinScore}
        includeCost={includeCost} tradeCostOpts={tradeCostOpts}
        openTradeModal={openTradeModal} openMaintenanceModal={openMaintenanceModal}
        realTotalValue={realTotal}
        sortKey={sortKey} onSortChange={setSortKey} total={total}
      />

      {totalPages > 1 && (
        <div className="pagination-wrap">
          <Pagination page={page} pageSize={pageSize} total={total} onChange={setPage} />
        </div>
      )}

      {serverTotal != null && allRows.length < serverTotal && (
        <div className="pagination-wrap" style={{ justifyContent: 'center' }}>
          <Button
            variant="secondary"
            onClick={loadMore}
            disabled={loadMoreLoading}
          >
            {loadMoreLoading ? '로딩 중…' : `더 보기 (${allRows.length} / ${serverTotal})`}
          </Button>
        </div>
      )}

      <Detail>
      {/* ── 참고 정보: 가끔 확인하는 것들은 목록 아래로 모으고 각각 접어 둔다 ── */}
      <div className="portfolio-reference-head">
        <div className="title-md">참고 정보</div>
        <div className="caption muted">거시 지표 · 계좌별 위험정책 · 성과 — 매일 볼 필요는 없어 접어 두었습니다.</div>
      </div>

      <MacroCard macroLoading={macroLoading} macroRiskLevel={macroRiskLevel} />

      {/* 계좌별 위험정책(성향·손절·종목 수)은 관리자만 — 일반 사용자는 계좌마다 따로 정하지 않고 내 계획을 따른다 */}
      {isAdmin && (
        <PolicyCard
          selectedAccountKey={selectedAccountKey} policyDraft={policyDraft} setPolicyDraft={setPolicyDraft}
          policyLoading={policyLoading} policySaving={policySaving} savePolicyDraft={savePolicyDraft}
          policyAccordionOpen={policyAccordionOpen} setPolicyAccordionOpen={setPolicyAccordionOpen}
        />
      )}

      <PerformanceCard
        performanceAccordionOpen={performanceAccordionOpen} setPerformanceAccordionOpen={setPerformanceAccordionOpen}
        advisorPerfLoading={advisorPerfLoading} advisorPerf={advisorPerf}
      />
      </Detail>

      <TradeModal trade={trade} realTotalValue={realTotal} />

      <ShareModal share={share} holdingAll={holdingAll} totalInvested={totalInvested} totalUnrealized={totalUnrealized} totalReturnPct={totalReturnPct} />

      <MaintenanceModal maint={maint} accountFolders={accountFolders} />

      <DeleteConfirmModal maint={maint} />
    </section>
  )
}
