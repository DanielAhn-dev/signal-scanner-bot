import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiFetch, invalidateCache } from '../../lib/api'
import Detail from '../../components/ui/Detail'
import Button from '../../components/ui/Button'
import { ErrorState } from '../../components/StateViews'
import { useToast } from '../../components/ToastProvider'
import { loadTradeCostSettings } from '../../lib/tradeCost'
import { summarizeAccounts } from '../../lib/holdingAction'
import { useSyncedSettings } from '../../lib/userState'
import Pagination from '../../components/Pagination'
import type { AccountFolder, AccountPolicy, AdvisorPerformanceData, PortfolioShareHistoryItem } from './types'
import { buildAccountKey, accountLabel, holdingAccountKey, holdingValue } from './lib/accountKey'
import { pickLatestActiveShare } from './lib/share'
import { getTodayLocalYmd } from './lib/dates'
import { selectAccountRows, extractSectors, filterHoldings } from './lib/filtering'
import { summarizeHoldings } from './lib/summary'
import { buildAllocationRows, buildDonutGradient } from './lib/allocation'
import PortfolioHeader from './components/PortfolioHeader'
import FilterCard from './components/FilterCard'
import AssetOverviewCard from './components/AssetOverviewCard'
import HoldingList from './components/HoldingList'
import MacroCard from './components/MacroCard'
import PolicyCard from './components/PolicyCard'
import PerformanceCard from './components/PerformanceCard'
import TradeModal from './components/modals/TradeModal'
import ShareModal from './components/modals/ShareModal'
import MaintenanceModal from './components/modals/MaintenanceModal'
import DeleteConfirmModal from './components/modals/DeleteConfirmModal'
import { computeMacroRisk } from './lib/macroRisk'
import { clampRuleSettings, applyMacroToRules, resolveAdvisoryThresholds } from './lib/thresholds'
import { evaluateHoldingState as evaluateHoldingStateFor, getPerformanceGrade as getPerformanceGradeFor, type HoldingStateContext, type HoldingStateKind } from './lib/holdingState'

const DEFAULT_INITIAL_CAPITAL = 10_000_000

export default function Portfolio() {
  const navigate = useNavigate()
  const [allRows, setAllRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null)
  const [page, setPage] = useState(1)
  const pageSize = 20
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [selectedSector, setSelectedSector] = useState<string | null>(null)
  const [selectedAccountKey, setSelectedAccountKey] = useState<string>('all')
  const [accountFolders, setAccountFolders] = useState<AccountFolder[]>([])
  const [accountPolicies, setAccountPolicies] = useState<AccountPolicy[]>([])
  const [policyLoading, setPolicyLoading] = useState(false)
  const [policySaving, setPolicySaving] = useState(false)
  const [policyDraft, setPolicyDraft] = useState<AccountPolicy | null>(null)
  const [advisorPerf, setAdvisorPerf] = useState<AdvisorPerformanceData>(null)
  const [advisorPerfLoading, setAdvisorPerfLoading] = useState(false)
  const [holdingStateFilter, setHoldingStateFilter] = useState<'all' | 'hold' | 'add' | 'partial'>('all')
  const [gradeFilter, setGradeFilter] = useState<'all' | 'A' | 'B' | 'C'>('all')
  const [gradeAThreshold, setGradeAThreshold] = useState(80)
  const [gradeBThreshold, setGradeBThreshold] = useState(65)
  const [addEntryMinScore, setAddEntryMinScore] = useState(70)
  const [partialTakeProfitPct, setPartialTakeProfitPct] = useState(8)
  const [partialWarnScoreMin, setPartialWarnScoreMin] = useState(3)
  const [showAllSectors, setShowAllSectors] = useState(false)
  const [initialCapital, setInitialCapital] = useState<number>(DEFAULT_INITIAL_CAPITAL)
  const [dbSeedCapital, setDbSeedCapital] = useState<number | null>(null)
  const [dbVirtualCash, setDbVirtualCash] = useState<number | null>(null)
  const [assetAccordionOpen, setAssetAccordionOpen] = useState(false)
  const [policyAccordionOpen, setPolicyAccordionOpen] = useState(false)
  const [performanceAccordionOpen, setPerformanceAccordionOpen] = useState(false)
  const [filterAccordionOpen, setFilterAccordionOpen] = useState(false)
  // 매매비용 표시 설정은 계정에 저장한다 (기기를 바꿔도 유지)
  const storedCost = loadTradeCostSettings()
  const [includeCost, setIncludeCost] = useState(storedCost.includeCost)
  const [buyFeeRatePct, setBuyFeeRatePct] = useState(storedCost.buyFeeRatePct)  // 매수수수료 %
  const [sellFeeRatePct, setSellFeeRatePct] = useState(storedCost.sellFeeRatePct) // 매도수수료+거래세 %
  useSyncedSettings('tradeCost', { includeCost, buyFeeRatePct, sellFeeRatePct }, { includeCost: true, buyFeeRatePct: 0.015, sellFeeRatePct: 0.215 }, (saved) => {
    if (typeof saved.includeCost === 'boolean') setIncludeCost(saved.includeCost)
    if (Number.isFinite(Number(saved.buyFeeRatePct))) setBuyFeeRatePct(Number(saved.buyFeeRatePct))
    if (Number.isFinite(Number(saved.sellFeeRatePct))) setSellFeeRatePct(Number(saved.sellFeeRatePct))
  })
  const [error, setError] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [modalRow, setModalRow] = useState<any | null>(null)
  const [modalSide, setModalSide] = useState<'buy' | 'sell'>('buy')
  const [tradeQty, setTradeQty] = useState(1)
  const [tradePrice, setTradePrice] = useState<number | ''>('')
  const [tradeDate, setTradeDate] = useState<string>(getTodayLocalYmd())
  const [tradeLoading, setTradeLoading] = useState(false)
  const [tradeError, setTradeError] = useState<string | null>(null)
  const [shareModalOpen, setShareModalOpen] = useState(false)
  const [sharedSummaryUrl, setSharedSummaryUrl] = useState('')
  const [shareExpiresAt, setShareExpiresAt] = useState('')
  const [shareTtlHours, setShareTtlHours] = useState<number>(48)
  const [shareCreating, setShareCreating] = useState(false)
  const [shareHistory, setShareHistory] = useState<PortfolioShareHistoryItem[]>([])
  const [shareHistoryLoading, setShareHistoryLoading] = useState(false)
  const [revokingShareId, setRevokingShareId] = useState('')
  const [deletingShareId, setDeletingShareId] = useState('')
  const [maintModalOpen, setMaintModalOpen] = useState(false)
  const [maintMode, setMaintMode] = useState<'liquidateall' | 'holdingedit' | 'holdingrestore' | 'holdingdelete'>('holdingrestore')
  const [maintRow, setMaintRow] = useState<any | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteConfirmCode, setDeleteConfirmCode] = useState('')
  const [maintCode, setMaintCode] = useState('')
  const [maintBuyPrice, setMaintBuyPrice] = useState<number | ''>('')
  const [maintBuyDate, setMaintBuyDate] = useState<string>(getTodayLocalYmd())
  const [maintQty, setMaintQty] = useState<number>(1)
  const [maintBrokerName, setMaintBrokerName] = useState('')
  const [maintAccountName, setMaintAccountName] = useState('')
  const [maintLoading, setMaintLoading] = useState(false)
  const [maintError, setMaintError] = useState<string | null>(null)
  const [maintStep, setMaintStep] = useState<1 | 2>(1)
  const [maintAccountMode, setMaintAccountMode] = useState<'select' | 'manual'>('select')
  const [macroLoading, setMacroLoading] = useState(false)
  const [macroSnapshot, setMacroSnapshot] = useState<any | null>(null)
  const toast = useToast()

  const rules = clampRuleSettings({ gradeAThreshold, gradeBThreshold, addEntryMinScore, partialTakeProfitPct, partialWarnScoreMin })
  const safeGradeAThreshold = rules.gradeAThreshold
  const safeGradeBThreshold = rules.gradeBThreshold
  const safeAddEntryMinScore = rules.addEntryMinScore
  const safePartialWarnScoreMin = rules.partialWarnScoreMin

  const policyByKey = useMemo(() => {
    const map = new Map<string, AccountPolicy>()
    for (const p of accountPolicies) {
      map.set(buildAccountKey(p.broker_name, p.account_name), p)
    }
    return map
  }, [accountPolicies])

  const macroRiskLevel = useMemo(() => computeMacroRisk(macroSnapshot), [macroSnapshot])

  const { addEntryMinScore: safeAddEntryMinScoreWithMacro, partialTakeProfitPct: safePartialTakeProfitPctWithMacro } = applyMacroToRules(rules, macroRiskLevel)

  const holdingStateCtx: HoldingStateContext = {
    rules,
    thresholdsFor: (row) => resolveAdvisoryThresholds(
      { addEntryMinScore: safeAddEntryMinScoreWithMacro, partialTakeProfitPct: safePartialTakeProfitPctWithMacro },
      policyByKey.get(buildAccountKey(row?.broker_name, row?.account_name)) ?? null,
    ),
  }
  const evaluateHoldingState = (row: any) => evaluateHoldingStateFor(row, holdingStateCtx)
  const getHoldingState = (row: any): HoldingStateKind => evaluateHoldingState(row).state
  const getPerformanceGrade = (row: any) => getPerformanceGradeFor(row, rules)

  const [serverTotal, setServerTotal] = useState<number | null>(null)
  const [loadMoreLoading, setLoadMoreLoading] = useState(false)
  const INITIAL_PAGE_SIZE = 20

  const load = useCallback(async ({ soft = false, force = false }: { soft?: boolean; force?: boolean } = {}) => {
    setRefreshing(true)
    if (!soft) setLoading(true)
    if (!soft) setError(null)
    try {
      // 초기 로드 pageSize를 20으로 제한 → 초기 응답 시간 8초에서 1초 이하로 단축
      const params = new URLSearchParams({ page: '1', pageSize: String(INITIAL_PAGE_SIZE), includeLots: '0', positionType: 'holding', withCount: '1' })
      if (force) params.set('cacheMs', '0')
      const json = await apiFetch(`/api/ui/positions?${params}`, { cacheMs: 3_000, timeoutMs: 15_000, retries: 1 })
      const rows = Array.isArray(json?.data) ? json.data : []
      setAllRows(rows)
      setServerTotal(json?.count != null ? Number(json.count) : null)
      const nextFolders = Array.isArray(json?.accounts)
        ? json.accounts
            .map((item: any) => ({
              key: buildAccountKey(item?.brokerName, item?.accountName),
              brokerName: String(item?.brokerName || ''),
              accountName: String(item?.accountName || ''),
              count: Number(item?.count || 0),
            }))
            .filter((item: AccountFolder) => item.brokerName || item.accountName)
        : []
      if (nextFolders.length > 0) {
        setAccountFolders(nextFolders)
      } else {
        const fallbackMap = new Map<string, AccountFolder>()
        for (const row of rows) {
          const key = buildAccountKey(row?.broker_name, row?.account_name)
          const labelBroker = String(row?.broker_name || '').trim()
          const labelAccount = String(row?.account_name || '').trim()
          if (!labelBroker && !labelAccount) continue
          const prev = fallbackMap.get(key)
          fallbackMap.set(key, {
            key,
            brokerName: labelBroker,
            accountName: labelAccount,
            count: (prev?.count ?? 0) + 1,
          })
        }
        setAccountFolders(Array.from(fallbackMap.values()))
      }
      setLastUpdatedAt(Date.now())
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      if (!soft) setLoading(false)
      setRefreshing(false)
    }
  }, [])

  const loadMore = useCallback(async () => {
    setLoadMoreLoading(true)
    try {
      const nextPage = Math.floor(allRows.length / INITIAL_PAGE_SIZE) + 1
      const params = new URLSearchParams({ page: String(nextPage), pageSize: String(INITIAL_PAGE_SIZE), includeLots: '0', positionType: 'holding', withCount: '1' })
      const json = await apiFetch(`/api/ui/positions?${params}`, { cacheMs: 3_000, timeoutMs: 15_000, retries: 1 })
      const newRows = json?.data ?? []
      setAllRows((prev) => [...prev, ...newRows])
      setServerTotal(json?.count != null ? Number(json.count) : null)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoadMoreLoading(false)
    }
  }, [allRows.length])

  useEffect(() => { load() }, [load])

  // 초기 페이지(20건) 로드 후 나머지 페이지를 백그라운드로 이어서 불러와
  // 상단 요약(보유 종목 수/평가손익 합계 등)이 일부 데이터가 아닌 전체 보유 기준으로 계산되도록 함.
  // (대시보드의 /api/ui/portfolio-realtime는 항상 전체 포지션을 합산하므로, 이 페이지의 요약도 전체 기준이어야 두 값이 일치함)
  useEffect(() => {
    if (serverTotal == null) return
    if (allRows.length >= serverTotal) return
    if (loadMoreLoading) return
    loadMore()
  }, [serverTotal, allRows.length, loadMoreLoading, loadMore])

  useEffect(() => {
    apiFetch('/api/ui/investment-prefs', { cacheMs: 0, timeoutMs: 10_000 })
      .then((json: any) => {
        const seed = Number(json?.data?.virtual_seed_capital)
        const cash = Number(json?.data?.virtual_cash)
        if (Number.isFinite(seed) && seed > 0) {
          setDbSeedCapital(seed)
          setInitialCapital(seed)
        }
        if (Number.isFinite(cash) && cash >= 0) setDbVirtualCash(cash)
      })
      .catch(() => {/* ignore */})
  }, [])

  const loadMacroSnapshot = useCallback(async () => {
    setMacroLoading(true)
    try {
      const json = await apiFetch('/api/ui/market-overview', {
        cacheMs: 120_000,
        timeoutMs: 10_000,
        retries: 1,
      })
      if (json?.data) setMacroSnapshot(json.data)
    } catch {
      // ignore macro fetch failures
    } finally {
      setMacroLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadMacroSnapshot()
  }, [loadMacroSnapshot])

  const loadAccountPolicies = useCallback(async () => {
    setPolicyLoading(true)
    try {
      const json = await apiFetch('/api/ui/account-policies', {
        cacheMs: 30_000,
        timeoutMs: 10_000,
        retries: 1,
      })
      setAccountPolicies(Array.isArray(json?.data) ? json.data : [])
    } catch {
      setAccountPolicies([])
    } finally {
      setPolicyLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAccountPolicies()
  }, [loadAccountPolicies])

  const loadAdvisorPerformance = useCallback(async () => {
    setAdvisorPerfLoading(true)
    try {
      const json = await apiFetch('/api/ui/advisor-performance?windowDays=90', {
        cacheMs: 20_000,
        timeoutMs: 10_000,
        retries: 1,
      })
      setAdvisorPerf(json?.data ?? null)
    } catch {
      setAdvisorPerf(null)
    } finally {
      setAdvisorPerfLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAdvisorPerformance()
  }, [loadAdvisorPerformance])

  useEffect(() => {
    if (selectedAccountKey === 'all' || selectedAccountKey === 'virtual') {
      setPolicyDraft(null)
      return
    }

    const [brokerName, accountName] = selectedAccountKey.split('|||')
    const existing = policyByKey.get(selectedAccountKey)
    setPolicyDraft(existing ?? {
      broker_name: brokerName || '',
      account_name: accountName || '',
      risk_profile: 'balanced',
      max_positions: null,
      daily_loss_limit_pct: null,
      min_cash_reserve_pct: null,
      add_entry_score_adjust: 0,
      partial_take_profit_adjust_pct: 0,
      stop_loss_pct: null,
      take_profit_pct: null,
    })
  }, [selectedAccountKey, policyByKey])

  const savePolicyDraft = useCallback(async () => {
    if (!policyDraft) return
    if (!String(policyDraft.broker_name || '').trim() || !String(policyDraft.account_name || '').trim()) {
      toast.show('정책 저장 대상 계좌가 없습니다')
      return
    }
    setPolicySaving(true)
    try {
      const json = await apiFetch('/api/ui/account-policies', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 12_000,
        body: JSON.stringify(policyDraft),
      })
      if (json?.error) throw new Error(String(json.error))
      toast.show('계좌 정책 저장 완료')
      await loadAccountPolicies()
      await load({ soft: true, force: true })
    } catch (e: any) {
      toast.show(String(e?.message || e || '계좌 정책 저장 실패'))
    } finally {
      setPolicySaving(false)
    }
  }, [policyDraft, toast, loadAccountPolicies, load])

  useSyncedSettings(
    'holdingRules',
    { gradeAThreshold, gradeBThreshold, addEntryMinScore, partialTakeProfitPct, partialWarnScoreMin },
    { gradeAThreshold: 80, gradeBThreshold: 65, addEntryMinScore: 70, partialTakeProfitPct: 8, partialWarnScoreMin: 3 },
    (saved) => {
      const num = (v: unknown) => (v != null && Number.isFinite(Number(v)) ? Number(v) : null)
      const a = num(saved.gradeAThreshold); if (a != null) setGradeAThreshold(a)
      const b = num(saved.gradeBThreshold); if (b != null) setGradeBThreshold(b)
      const add = num(saved.addEntryMinScore); if (add != null) setAddEntryMinScore(add)
      const pct = num(saved.partialTakeProfitPct); if (pct != null) setPartialTakeProfitPct(pct)
      const warn = num(saved.partialWarnScoreMin); if (warn != null) setPartialWarnScoreMin(warn)
    },
  )

  useSyncedSettings(
    'assetOverview',
    { initialCapital, assetAccordionOpen },
    { initialCapital: DEFAULT_INITIAL_CAPITAL, assetAccordionOpen: false },
    (saved) => {
      const capital = Number(saved.initialCapital)
      if (Number.isFinite(capital) && capital > 0) setInitialCapital(capital)
      if (typeof saved.assetAccordionOpen === 'boolean') setAssetAccordionOpen(saved.assetAccordionOpen)
    },
  )

  // 클라이언트 사이드 파생 상태 – API 재호출 없이 즉시 필터링
  const holdingAll = useMemo(() => allRows.filter((r: any) => r.position_type === 'holding'), [allRows])
  // 카드의 "이 종목 대응"이 같은 계좌 안 비중을 쓰도록 계좌별로 묶는다(불러온 행 기준)
  const accountSummary = useMemo(() => summarizeAccounts(holdingAll.map((r: any) => ({
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

  const captureGeneratedAt = useMemo(
    () => new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date()),
    [shareModalOpen],
  )

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onSearchChange = (v: string) => {
    setSearchInput(v)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setSearch(v)
      setPage(1)
    }, 220)
  }
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  const openTradeModal = (row: any, side: 'buy' | 'sell') => {
    setModalRow(row)
    setModalSide(side)
    setTradeQty(side === 'buy' ? (row.recommended_buy_qty || 1) : (row.quantity || 1))
    setTradePrice(row.stock?.close ?? row.avg_price ?? '')
    setTradeDate(getTodayLocalYmd())
    setTradeError(null)
    setModalOpen(true)
  }

  const openMaintenanceModal = (mode: 'liquidateall' | 'holdingedit' | 'holdingrestore' | 'holdingdelete', row?: any) => {
    setMaintMode(mode)
    setMaintRow(row ?? null)
    setMaintError(null)
    if (mode === 'holdingedit') {
      const code = String(row?.code || '')
      setMaintCode(code)
      setMaintBuyPrice(Number(row?.avg_price || row?.buy_price || row?.stock?.close || 0) || '')
      setMaintBuyDate(String(row?.buy_date || getTodayLocalYmd()))
      setMaintQty(Math.max(1, Number(row?.quantity || 1)))
      setMaintBrokerName(String(row?.broker_name || ''))
      setMaintAccountName(String(row?.account_name || ''))
    }
    if (mode === 'holdingrestore') {
      setMaintCode('')
      setMaintBuyPrice('')
      setMaintBuyDate(getTodayLocalYmd())
      setMaintQty(1)
      setMaintBrokerName('')
      setMaintAccountName('')
      setMaintStep(1)
      setMaintAccountMode(accountFolders.length > 0 ? 'select' : 'manual')
    }
    if (mode === 'holdingdelete') {
      const code = String(row?.code || '')
      setMaintCode(code)
      setDeleteConfirmOpen(true)
      setDeleteConfirmCode(code)
      return
    }
    setMaintModalOpen(true)
  }

  const runMaintenance = async () => {
    setMaintLoading(true)
    setMaintError(null)
    try {
      const body: any = { mode: maintMode }
      if (maintMode === 'holdingedit' || maintMode === 'holdingrestore') {
        body.code = maintCode
        body.buy_price = maintBuyPrice
        body.buy_date = maintBuyDate
        body.quantity = maintQty
        body.broker_name = String(maintBrokerName || '').trim()
        body.account_name = String(maintAccountName || '').trim()
      }
      if (maintMode === 'holdingdelete') {
        body.code = maintCode
      }

      const json = await apiFetch('/api/ui/positions-maintenance', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 20_000,
        body: JSON.stringify(body),
      })
      if (json?.error) throw new Error(String(json.error))

      if (maintMode === 'liquidateall') {
        toast.show(`보유 종목 ${Number(json?.soldCount || 0)}건 전체매도 처리 완료`)
      } else if (maintMode === 'holdingrestore') {
        const label = json?.data?.stock_name || json?.data?.code || maintCode
        const action = json?.created ? '신규 추가' : '기존 포지션 수정'
        toast.show(`${label} 계좌/보유 저장(${action}) 완료`)
      } else if (maintMode === 'holdingdelete') {
        toast.show(`${maintCode} 종목이 완전 삭제되었습니다 (기록 포함)`)
      } else {
        toast.show('보유수정 완료')
      }

      invalidateCache('/api/ui/positions')
      setMaintModalOpen(false)
      setDeleteConfirmOpen(false)
      await load({ soft: true, force: true })
    } catch (e: any) {
      setMaintError(String(e?.message || e))
    } finally {
      setMaintLoading(false)
    }
  }

  // 지난 날짜 기록은 실계좌(계좌 이름이 있는 보유)의 매수만 — 봇 가상 계좌는 전향 기록을 지키려고 막는다
  const canBackdateTrade = modalSide === 'buy'
    && !!(String(modalRow?.broker_name || '').trim() || String(modalRow?.account_name || '').trim())

  const submitTrade = async () => {
    if (!modalRow) return
    if (!tradeQty || tradeQty <= 0) { setTradeError('수량은 1 이상이어야 합니다'); return }
    if (tradePrice !== '' && Number(tradePrice) <= 0) { setTradeError('가격은 0보다 커야 합니다'); return }
    const backdated = canBackdateTrade && tradeDate && tradeDate < getTodayLocalYmd()
    if (backdated && tradePrice === '') { setTradeError('지난 날짜로 기록할 때는 그날 체결가를 입력해 주세요'); return }

    setTradeLoading(true)
    setTradeError(null)
    try {
      const payload = {
        code: modalRow.code,
        side: modalSide === 'buy' ? 'BUY' : 'SELL',
        quantity: Number(tradeQty),
        price: tradePrice !== '' ? Number(tradePrice) : (modalRow.stock?.close ?? modalRow.avg_price ?? 0),
        broker_name: String(modalRow?.broker_name || '').trim() || null,
        account_name: String(modalRow?.account_name || '').trim() || null,
        ...(backdated ? { trade_date: tradeDate } : {}),
      }
      const json = await apiFetch('/api/ui/virtual-trade', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 12_000,
        body: JSON.stringify(payload),
      })
      if (json?.error) {
        setTradeError(String(json?.error || '거래 실행 실패'))
      } else {
        toast.show(`${modalSide === 'buy' ? '매수' : '매도'} 등록 완료`)
        invalidateCache('/api/ui/positions')
        setModalOpen(false)
        await load({ soft: true, force: true })
      }
    } catch (e: any) {
      setTradeError(String(e?.message || e))
    } finally {
      setTradeLoading(false)
    }
  }


  const onSectorChange = (sectorId: string | null) => {
    setSelectedSector(sectorId)
    setPage(1)
  }

  const createPublicShareUrl = useCallback(async () => {
    if (shareCreating) return
    setShareCreating(true)
    try {
      const json = await apiFetch('/api/ui/portfolio-share', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 12_000,
        body: JSON.stringify({ ttlHours: shareTtlHours }),
      })
      const url = String(json?.url || '')
      if (!url) throw new Error('공유 URL 생성에 실패했습니다')
      setSharedSummaryUrl(url)
      setShareExpiresAt(String(json?.expiresAt || ''))
      toast.show('공유 URL이 생성되었습니다')
      invalidateCache('/api/ui/portfolio-share')
      const historyJson = await apiFetch('/api/ui/portfolio-share?all=1&limit=10', {
        cacheMs: 0,
        timeoutMs: 10_000,
      })
      setShareHistory(Array.isArray(historyJson?.data) ? historyJson.data : [])
    } catch (e: any) {
      toast.show(String(e?.message || e || '공유 URL 생성 실패'))
    } finally {
      setShareCreating(false)
    }
  }, [shareCreating, shareTtlHours, toast])

  const loadShareHistory = useCallback(async (opts?: { silent?: boolean }) => {
    setShareHistoryLoading(true)
    try {
      const json = await apiFetch('/api/ui/portfolio-share?all=1&limit=10', {
        cacheMs: 0,
        timeoutMs: 10_000,
      })
      const list = Array.isArray(json?.data) ? json.data : []
      setShareHistory(list)
      return list as PortfolioShareHistoryItem[]
    } catch (e: any) {
      if (!opts?.silent) toast.show(String(e?.message || e || '공유 이력 조회 실패'))
      return [] as PortfolioShareHistoryItem[]
    } finally {
      setShareHistoryLoading(false)
    }
  }, [toast])

  const revokeShare = useCallback(async (shareId: string) => {
    if (!shareId || revokingShareId) return
    setRevokingShareId(shareId)
    try {
      const json = await apiFetch('/api/ui/portfolio-share', {
        method: 'DELETE',
        cacheMs: 0,
        timeoutMs: 10_000,
        body: JSON.stringify({ shareId }),
      })
      if (json?.error) throw new Error(String(json.error))
      toast.show('공유 링크를 철회했습니다')
      if (sharedSummaryUrl) {
        const target = shareHistory.find((item) => item.shareId === shareId)
        if (target?.url === sharedSummaryUrl) {
          setSharedSummaryUrl('')
          setShareExpiresAt('')
        }
      }
      const updated = await loadShareHistory()
      const active = pickLatestActiveShare(updated)
      if (active?.url) {
        setSharedSummaryUrl(active.url)
        setShareExpiresAt(String(active.expiresAt || ''))
      } else {
        setSharedSummaryUrl('')
        setShareExpiresAt('')
      }
    } catch (e: any) {
      toast.show(String(e?.message || e || '공유 링크 철회 실패'))
    } finally {
      setRevokingShareId('')
    }
  }, [revokingShareId, toast, sharedSummaryUrl, shareHistory, loadShareHistory])

  const deleteShare = useCallback(async (shareId: string) => {
    if (!shareId || deletingShareId) return
    const ok = window.confirm('이 공유 기록을 목록에서 삭제할까요? 삭제 후 복구할 수 없습니다.')
    if (!ok) return

    setDeletingShareId(shareId)
    try {
      const json = await apiFetch('/api/ui/portfolio-share', {
        method: 'DELETE',
        cacheMs: 0,
        timeoutMs: 10_000,
        body: JSON.stringify({ shareId, hard: true }),
      })
      if (json?.error) throw new Error(String(json.error))

      toast.show('공유 기록을 삭제했습니다')
      const updated = await loadShareHistory()
      const active = pickLatestActiveShare(updated)
      if (active?.url) {
        setSharedSummaryUrl(active.url)
        setShareExpiresAt(String(active.expiresAt || ''))
      } else {
        setSharedSummaryUrl('')
        setShareExpiresAt('')
      }
    } catch (e: any) {
      toast.show(String(e?.message || e || '공유 기록 삭제 실패'))
    } finally {
      setDeletingShareId('')
    }
  }, [deletingShareId, toast, loadShareHistory])

  const copyPortfolioShareUrl = async () => {
    if (!sharedSummaryUrl) {
      toast.show('먼저 공유 URL을 생성해 주세요')
      return
    }
    try {
      await navigator.clipboard.writeText(sharedSummaryUrl)
      toast.show('공유 URL을 복사했습니다')
    } catch {
      toast.show('공유 URL 복사에 실패했습니다')
    }
  }

  useEffect(() => {
    if (!shareModalOpen) return

    let cancelled = false
    ;(async () => {
      const history = await loadShareHistory({ silent: true })
      if (cancelled) return

      const active = pickLatestActiveShare(history)
      if (active?.url) {
        setSharedSummaryUrl(active.url)
        setShareExpiresAt(String(active.expiresAt || ''))
        return
      }

      if (!shareCreating) {
        await createPublicShareUrl()
      }
    })()

    return () => {
      cancelled = true
    }
  }, [shareModalOpen, shareCreating, createPublicShareUrl, loadShareHistory])

  const portfolioHeaderSubtitle = refreshing
    ? '보유 포지션만 집중해서 관리합니다. · 업데이트 중...'
    : `보유 포지션만 집중해서 관리합니다. · 마지막 갱신 ${lastUpdatedAt
      ? new Date(lastUpdatedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : '-'}`

  return (
    <section className="container-app portfolio-page">
      <PortfolioHeader
        subtitle={portfolioHeaderSubtitle} onNavigateToCalendar={() => navigate('/market')}
        loading={loading} refreshing={refreshing} allRows={allRows} holdingAll={holdingAll}
        onRefresh={() => load({ force: true })} onOpenShare={() => setShareModalOpen(true)}
        onOpenMaintenance={openMaintenanceModal}
        selectedAccountKey={selectedAccountKey} onSelectAccount={(key) => { setSelectedAccountKey(key); setPage(1) }}
        accountFolders={accountFolders} virtualCount={virtualHoldingRows.length}
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

      <PolicyCard
        selectedAccountKey={selectedAccountKey} policyDraft={policyDraft} setPolicyDraft={setPolicyDraft}
        policyLoading={policyLoading} policySaving={policySaving} savePolicyDraft={savePolicyDraft}
        policyAccordionOpen={policyAccordionOpen} setPolicyAccordionOpen={setPolicyAccordionOpen}
      />

      <PerformanceCard
        performanceAccordionOpen={performanceAccordionOpen} setPerformanceAccordionOpen={setPerformanceAccordionOpen}
        advisorPerfLoading={advisorPerfLoading} advisorPerf={advisorPerf}
      />
      </Detail>

      <TradeModal
        modalOpen={modalOpen} modalSide={modalSide} modalRow={modalRow} setModalOpen={setModalOpen}
        tradeQty={tradeQty} setTradeQty={setTradeQty} tradePrice={tradePrice} setTradePrice={setTradePrice}
        tradeDate={tradeDate} setTradeDate={setTradeDate} canBackdateTrade={canBackdateTrade}
        tradeError={tradeError} tradeLoading={tradeLoading} submitTrade={submitTrade}
      />

      <ShareModal
        shareModalOpen={shareModalOpen} setShareModalOpen={setShareModalOpen}
        captureGeneratedAt={captureGeneratedAt} holdingAll={holdingAll}
        shareTtlHours={shareTtlHours} setShareTtlHours={setShareTtlHours}
        shareCreating={shareCreating} sharedSummaryUrl={sharedSummaryUrl} shareExpiresAt={shareExpiresAt}
        createPublicShareUrl={createPublicShareUrl} copyPortfolioShareUrl={copyPortfolioShareUrl}
        loadShareHistory={loadShareHistory} shareHistoryLoading={shareHistoryLoading} shareHistory={shareHistory}
        revokeShare={revokeShare} deleteShare={deleteShare}
        revokingShareId={revokingShareId} deletingShareId={deletingShareId}
        totalInvested={totalInvested} totalUnrealized={totalUnrealized} totalReturnPct={totalReturnPct}
      />

      <MaintenanceModal
        maintModalOpen={maintModalOpen} setMaintModalOpen={setMaintModalOpen}
        maintMode={maintMode} maintStep={maintStep} setMaintStep={setMaintStep} maintRow={maintRow}
        maintCode={maintCode} setMaintCode={setMaintCode} maintQty={maintQty} setMaintQty={setMaintQty}
        maintBuyDate={maintBuyDate} setMaintBuyDate={setMaintBuyDate}
        maintBuyPrice={maintBuyPrice} setMaintBuyPrice={setMaintBuyPrice}
        maintBrokerName={maintBrokerName} setMaintBrokerName={setMaintBrokerName}
        maintAccountName={maintAccountName} setMaintAccountName={setMaintAccountName}
        maintAccountMode={maintAccountMode} setMaintAccountMode={setMaintAccountMode}
        accountFolders={accountFolders} maintError={maintError} setMaintError={setMaintError}
        maintLoading={maintLoading} runMaintenance={runMaintenance}
      />

      <DeleteConfirmModal
        deleteConfirmOpen={deleteConfirmOpen} setDeleteConfirmOpen={setDeleteConfirmOpen}
        deleteConfirmCode={deleteConfirmCode} setMaintMode={setMaintMode} setMaintCode={setMaintCode}
        runMaintenance={runMaintenance} maintLoading={maintLoading}
      />
    </section>
  )
}
