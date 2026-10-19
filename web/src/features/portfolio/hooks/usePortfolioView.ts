import { useMemo } from 'react'
import { summarizeAccounts } from '../../../lib/holdingAction'
import type { AccountFolder, AccountPolicy } from '../types'
import { accountLabel, buildAccountKey, holdingAccountKey, holdingValue } from '../lib/accountKey'
import { selectAccountRows, extractSectors, filterHoldings } from '../lib/filtering'
import { summarizeHoldings } from '../lib/summary'
import { sortHoldings, type HoldingSortKey } from '../lib/holdingSort'
import { buildAllocationRows, buildDonutGradient } from '../lib/allocation'
import type { MacroRisk } from '../lib/macroRisk'
import { applyMacroToRules, resolveAdvisoryThresholds, type RuleSettings } from '../lib/thresholds'
import { evaluateHoldingState as evaluateHoldingStateFor, getPerformanceGrade as getPerformanceGradeFor, type HoldingStateContext, type HoldingStateKind } from '../lib/holdingState'
import type { HoldingRow } from '../types'

type PortfolioViewInput = {
  allRows: HoldingRow[]
  accountFolders: AccountFolder[]
  selectedAccountKey: string
  selectedSector: string | null
  search: string
  holdingStateFilter: 'all' | 'hold' | 'add' | 'partial'
  gradeFilter: 'all' | 'A' | 'B' | 'C'
  sortKey: HoldingSortKey
  page: number
  pageSize: number
  rules: RuleSettings
  macroRiskLevel: MacroRisk
  policyByKey: Map<string, AccountPolicy>
  includeCost: boolean
  buyFeeRatePct: number
  sellFeeRatePct: number
  initialCapital: number
  /** 실험 계좌의 DB 현금(virtual_cash) — 있으면 총자산·비중에 이 값을 쓴다 */
  dbVirtualCash?: number | null
}

/** 불러온 행과 설정으로부터 화면에 필요한 파생값(필터·합계·비중)을 만든다. 서버 호출 없이 즉시 계산 */
export function usePortfolioView(input: PortfolioViewInput) {
  const {
    allRows, accountFolders, selectedAccountKey, selectedSector, search, holdingStateFilter, gradeFilter, sortKey,
    page, pageSize, rules, macroRiskLevel, policyByKey, includeCost, buyFeeRatePct, sellFeeRatePct, initialCapital, dbVirtualCash,
  } = input
  const safeGradeAThreshold = rules.gradeAThreshold
  const safeGradeBThreshold = rules.gradeBThreshold
  const safePartialWarnScoreMin = rules.partialWarnScoreMin

  const { addEntryMinScore: safeAddEntryMinScoreWithMacro, partialTakeProfitPct: safePartialTakeProfitPctWithMacro } = applyMacroToRules(rules, macroRiskLevel)

  const holdingStateCtx: HoldingStateContext = {
    rules,
    thresholdsFor: (row) => resolveAdvisoryThresholds(
      { addEntryMinScore: safeAddEntryMinScoreWithMacro, partialTakeProfitPct: safePartialTakeProfitPctWithMacro },
      policyByKey.get(buildAccountKey(row?.broker_name, row?.account_name)) ?? null,
    ),
  }
  const evaluateHoldingState = (row: HoldingRow) => evaluateHoldingStateFor(row, holdingStateCtx)
  const getHoldingState = (row: HoldingRow): HoldingStateKind => evaluateHoldingState(row).state
  const getPerformanceGrade = (row: HoldingRow) => getPerformanceGradeFor(row, rules)

  const holdingAll = useMemo(() => allRows.filter((r: HoldingRow) => r.position_type === 'holding'), [allRows])
  // 카드의 "이 종목 대응"이 같은 계좌 안 비중을 쓰도록 계좌별로 묶는다(불러온 행 기준)
  const accountSummary = useMemo(() => summarizeAccounts(holdingAll.map((r: HoldingRow) => ({
    accountKey: holdingAccountKey(r),
    code: String(r.code ?? ''),
    name: r.stock_name ?? null,
    value: holdingValue(r),
    etf: r?.etf_key ?? null,
  }))), [holdingAll])

  const virtualHoldingRows = useMemo(() => selectAccountRows(holdingAll, 'virtual'), [holdingAll])

  const sectors = useMemo(() => extractSectors(holdingAll), [holdingAll])

  const filteredRows = useMemo(
    () => filterHoldings(
      holdingAll,
      { accountKey: selectedAccountKey, sectorId: selectedSector, search, stateFilter: holdingStateFilter, gradeFilter },
      getHoldingState,
      getPerformanceGrade,
    ),
    [holdingAll, selectedAccountKey, selectedSector, search, holdingStateFilter, gradeFilter, safePartialTakeProfitPctWithMacro, safePartialWarnScoreMin, safeAddEntryMinScoreWithMacro, safeGradeAThreshold, safeGradeBThreshold],
  )

  // 페이지를 나누기 전에 정렬해야 1쪽에 전체 기준 상위가 온다
  const sortedRows = useMemo(
    () => sortHoldings(filteredRows, sortKey, { includeCost, tradeCostOpts: { buyFeeRatePct, sellFeeRatePct } }),
    [filteredRows, sortKey, includeCost, buyFeeRatePct, sellFeeRatePct],
  )

  const total = sortedRows.length
  const totalPages = Math.ceil(total / pageSize)
  const rows = sortedRows.slice((page - 1) * pageSize, page * pageSize)
  const summaryRows = selectAccountRows(holdingAll, selectedAccountKey)
  const isVirtualTab = selectedAccountKey === 'virtual'
  const selectedAccountLabel = selectedAccountKey === 'real'
    ? '내 계좌 [실제] 전체'
    : isVirtualTab
      ? '가상 계좌 [가상]'
      : accountLabel(
          accountFolders.find(f => f.key === selectedAccountKey)?.brokerName,
          accountFolders.find(f => f.key === selectedAccountKey)?.accountName,
        )
  const {
    totalUnrealized, totalInvested, totalTradeCost, adjustedUnrealized,
    totalReturnPct, totalEvaluationValue, estimatedCash, totalAssetValue,
  // 시드·현금은 실험 계좌(가상)에만 있다 — 실제 계좌 탭에 가상 시드를 넣으면 '현금 = 가상 시드 − 실제 매수금'이 섞였다
  } = summarizeHoldings(summaryRows, { includeCost, buyFeeRatePct, sellFeeRatePct, initialCapital: isVirtualTab ? initialCapital : 0, cashOverride: isVirtualTab ? dbVirtualCash : null })
  const tradeCostOpts = { buyFeeRatePct, sellFeeRatePct }
  const allocationRows = useMemo(() => buildAllocationRows(summaryRows, isVirtualTab ? estimatedCash : 0), [summaryRows, estimatedCash, isVirtualTab])
  const allocationChartStyle = useMemo(() => buildDonutGradient(allocationRows), [allocationRows])

  return {
    holdingAll,
    accountSummary,
    virtualHoldingRows,
    sectors,
    evaluateHoldingState,
    getPerformanceGrade,
    rows,
    total,
    totalPages,
    summaryRows,
    selectedAccountLabel,
    totalUnrealized,
    totalInvested,
    totalTradeCost,
    adjustedUnrealized,
    totalReturnPct,
    totalEvaluationValue,
    estimatedCash,
    totalAssetValue,
    tradeCostOpts,
    allocationRows,
    allocationChartStyle,
  }
}
