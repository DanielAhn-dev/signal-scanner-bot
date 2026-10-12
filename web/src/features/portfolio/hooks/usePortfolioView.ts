import { useMemo } from 'react'
import { summarizeAccounts } from '../../../lib/holdingAction'
import type { AccountFolder, AccountPolicy } from '../types'
import { accountLabel, buildAccountKey, holdingAccountKey, holdingValue } from '../lib/accountKey'
import { selectAccountRows, extractSectors, filterHoldings } from '../lib/filtering'
import { summarizeHoldings } from '../lib/summary'
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
  page: number
  pageSize: number
  rules: RuleSettings
  macroRiskLevel: MacroRisk
  policyByKey: Map<string, AccountPolicy>
  includeCost: boolean
  buyFeeRatePct: number
  sellFeeRatePct: number
  initialCapital: number
}

/** 불러온 행과 설정으로부터 화면에 필요한 파생값(필터·합계·비중)을 만든다. 서버 호출 없이 즉시 계산 */
export function usePortfolioView(input: PortfolioViewInput) {
  const {
    allRows, accountFolders, selectedAccountKey, selectedSector, search, holdingStateFilter, gradeFilter,
    page, pageSize, rules, macroRiskLevel, policyByKey, includeCost, buyFeeRatePct, sellFeeRatePct, initialCapital,
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

  const total = filteredRows.length
  const totalPages = Math.ceil(total / pageSize)
  const rows = filteredRows.slice((page - 1) * pageSize, page * pageSize)
  const summaryRows = selectAccountRows(holdingAll, selectedAccountKey)
  const selectedAccountLabel = selectedAccountKey === 'all'
    ? '전체 계좌'
    : selectedAccountKey === 'virtual'
      ? '가상매매'
      : accountLabel(
          accountFolders.find(f => f.key === selectedAccountKey)?.brokerName,
          accountFolders.find(f => f.key === selectedAccountKey)?.accountName,
        )
  const {
    totalUnrealized, totalInvested, totalTradeCost, adjustedUnrealized,
    totalReturnPct, totalEvaluationValue, estimatedCash, totalAssetValue,
  } = summarizeHoldings(summaryRows, { includeCost, buyFeeRatePct, sellFeeRatePct, initialCapital })
  const tradeCostOpts = { buyFeeRatePct, sellFeeRatePct }
  const allocationRows = useMemo(() => buildAllocationRows(summaryRows, estimatedCash), [summaryRows, estimatedCash])
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
