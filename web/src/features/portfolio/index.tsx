import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, AlertTriangle, TrendingDown, ShieldAlert, TrendingUp, PlusCircle, Eye, ChevronDown } from 'lucide-react'
import { apiFetch, invalidateCache } from '../../lib/api'
import { formatKrw, formatNumber } from '../../lib/format'
import Skeleton from '../../components/Skeleton'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import Modal from '../../components/Modal'
import StockSearchInput from '../../components/StockSearchInput'
import { EmptyState, ErrorState } from '../../components/StateViews'
import { useToast } from '../../components/ToastProvider'
import Pagination from '../../components/Pagination'
import EconomicEventBadge from '../../components/EconomicEventBadge'
import SheetHeaderBar from '../../components/SheetHeaderBar'

type PortfolioShareHistoryItem = {
  shareId: string
  url: string
  expiresAt: string
  createdAt?: string
  revokedAt?: string | null
  accessCount?: number
  lastAccessedAt?: string | null
}

type AccountFolder = {
  key: string
  brokerName: string
  accountName: string
  count: number
}

type AccountPolicy = {
  chat_id?: number
  broker_name: string
  account_name: string
  risk_profile: 'safe' | 'balanced' | 'active'
  max_positions: number | null
  daily_loss_limit_pct: number | null
  min_cash_reserve_pct: number | null
  add_entry_score_adjust: number
  partial_take_profit_adjust_pct: number
  stop_loss_pct: number | null
  take_profit_pct: number | null
}

type AdvisorPerformanceData = {
  summary?: {
    trustScore?: number | null
    totalDecisions?: number
    linkedSellWinRatePct?: number | null
    linkedRealizedPnl?: number
  } | null
  recent?: Array<{
    code?: string
    action?: string
    confidence?: number | null
    reason_summary?: string | null
    trade?: { pnl_amount?: number | null } | null
  }>
} | null

function buildAccountKey(brokerName?: string | null, accountName?: string | null): string {
  return `${String(brokerName || '').trim()}|||${String(accountName || '').trim()}`
}

function accountLabel(brokerName?: string | null, accountName?: string | null): string {
  const broker = String(brokerName || '').trim()
  const account = String(accountName || '').trim()
  const label = [broker, account].filter(Boolean).join(' / ')
  return label || '계좌 미지정'
}

function isVirtualPositionRow(row: any): boolean {
  // 엄격 기준: 서버가 판정한 account_kind 값만 사용
  return String(row?.account_kind || '').toLowerCase() === 'virtual'
}

function toSignalLabel(value?: string | null): string {
  const v = String(value || '').trim().toUpperCase()
  if (!v) return '-'
  if (v === 'BUY') return '매수'
  if (v === 'HOLD') return '보유'
  if (v === 'SELL') return '매도'
  return v
}

function toWarnLabel(value?: string | null): string {
  const v = String(value || '').trim().toUpperCase()
  if (!v) return '-'
  if (v === 'SAFE') return '안전'
  if (v === 'WATCH') return '관찰'
  if (v === 'WARN') return '경고'
  if (v === 'SELL') return '강한경고'
  return v
}

function pickLatestActiveShare(items: PortfolioShareHistoryItem[]): PortfolioShareHistoryItem | null {
  const now = Date.now()
  for (const item of items) {
    const expired = new Date(item.expiresAt).getTime() <= now
    if (!item.revokedAt && !expired) return item
  }
  return null
}

const PORTFOLIO_RULES_STORAGE_KEY = 'portfolio.holdingRules.v1'
const PORTFOLIO_ASSET_OVERVIEW_STORAGE_KEY = 'portfolio.assetOverview.v1'
const DEFAULT_INITIAL_CAPITAL = 10_000_000

function getTodayLocalYmd(): string {
  const now = new Date()
  const tzOffsetMs = now.getTimezoneOffset() * 60_000
  return new Date(now.getTime() - tzOffsetMs).toISOString().slice(0, 10)
}

const WARN_REASON_LABELS: Array<{ key: string; label: string }> = [
  { key: 'warn_overheat', label: '이격 과열(21일선 대비 +7% 초과)' },
  { key: 'warn_vol_spike', label: '거래량 급증(20일 평균 대비 2배 초과)' },
  { key: 'warn_atr_spike', label: '변동성 급증(ATR14 > ATR20 평균 x 1.5)' },
  { key: 'warn_rsi_ob', label: 'RSI 과매수(70 초과)' },
  { key: 'warn_ma_break', label: '21일선 이탈(종가 < MA21)' },
  { key: 'warn_dead_cross', label: '데드크로스(MA21 < MA50)' },
]

const BADGE_TOOLTIPS: Record<string, string> = {
  '점수부족': '추가매수 기준 점수 미달. 점수가 오르거나 기준 완화 시 추가진입 신호가 생성됩니다.',
  '경고있음': '기술적 경고 지표 발생 (이격과열·거래량급증·RSI 과매수 등). 판정근거 보기에서 상세 확인.',
  '매도신호': '종합 점수 기반 매도 신호 발생. 현재 보통 보유 상태이나 주의 관찰 필요.',
  '관망': '추가매수·부분청산 조건 모두 미충족. 현재 포지션 유지 권장.',
  '익절구간': '수익률이 부분청산 기준에 도달. 일부 매도를 검토하세요.',
  '경고강함': '경고 등급 WARN/SELL 수준. 손실 위험 신호 — 청산 조건 재검토 권장.',
  '추가진입': '추가매수 조건 충족. 점수·진입·추세 등급이 기준 이상입니다.',
  '보유신호': '추세 유지 신호. 현재 포지션 보유 권장.',
}

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
  const [initialCapitalInput, setInitialCapitalInput] = useState(String(DEFAULT_INITIAL_CAPITAL))
  const [initialCapital, setInitialCapital] = useState<number>(DEFAULT_INITIAL_CAPITAL)
  const [assetAccordionOpen, setAssetAccordionOpen] = useState(true)
  const [policyAccordionOpen, setPolicyAccordionOpen] = useState(false)
  const [performanceAccordionOpen, setPerformanceAccordionOpen] = useState(false)
  const [filterAccordionOpen, setFilterAccordionOpen] = useState(false)
  const [includeCost, setIncludeCost] = useState(true)
  const [buyFeeRatePct, setBuyFeeRatePct] = useState(0.015)  // 매수수수료 %
  const [sellFeeRatePct, setSellFeeRatePct] = useState(0.195) // 매도수수료+거래세 %
  const [error, setError] = useState<string | null>(null)

  const [modalOpen, setModalOpen] = useState(false)
  const [modalRow, setModalRow] = useState<any | null>(null)
  const [modalSide, setModalSide] = useState<'buy' | 'sell'>('buy')
  const [tradeQty, setTradeQty] = useState(1)
  const [tradePrice, setTradePrice] = useState<number | ''>('')
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
  const [openReasonKey, setOpenReasonKey] = useState<string | null>(null)
  const [macroLoading, setMacroLoading] = useState(false)
  const [macroSnapshot, setMacroSnapshot] = useState<any | null>(null)
  const toast = useToast()

  const safeGradeAThreshold = Math.max(1, Math.min(100, Number(gradeAThreshold || 80)))
  const safeGradeBThreshold = Math.max(0, Math.min(safeGradeAThreshold - 1, Number(gradeBThreshold || 65)))
  const safeAddEntryMinScore = Math.max(0, Math.min(100, Number(addEntryMinScore || 70)))
  const safePartialTakeProfitPct = Math.max(0, Math.min(50, Number(partialTakeProfitPct || 8)))
  const safePartialWarnScoreMin = Math.max(0, Math.min(10, Number(partialWarnScoreMin || 3)))

  const policyByKey = useMemo(() => {
    const map = new Map<string, AccountPolicy>()
    for (const p of accountPolicies) {
      map.set(buildAccountKey(p.broker_name, p.account_name), p)
    }
    return map
  }, [accountPolicies])

  const macroRiskLevel = useMemo(() => {
    const us10y = Number(macroSnapshot?.indices?.us10y?.price)
    const wtiOil = Number(macroSnapshot?.indices?.wtiOil?.price)
    const cpiYoy = Number(macroSnapshot?.cpi?.yoy)
    const riskScore = Number(macroSnapshot?.diagnosis?.riskScore)
    const score = Number.isFinite(riskScore) ? riskScore : 50

    let addScorePenalty = 0
    let partialTakeProfitBonus = 0
    let label = '중립'

    if (score >= 75 || us10y >= 5 || wtiOil >= 95 || cpiYoy >= 3.5) {
      addScorePenalty = 8
      partialTakeProfitBonus = 2
      label = '방어'
    } else if (score >= 60 || us10y >= 4.6 || wtiOil >= 85 || cpiYoy >= 3.0) {
      addScorePenalty = 4
      partialTakeProfitBonus = 1
      label = '주의'
    }

    return {
      label,
      addScorePenalty,
      partialTakeProfitBonus,
      us10y: Number.isFinite(us10y) ? us10y : null,
      wtiOil: Number.isFinite(wtiOil) ? wtiOil : null,
      cpiYoy: Number.isFinite(cpiYoy) ? cpiYoy : null,
      diagnosis: String(macroSnapshot?.regimeLabel || '시장 진단 없음'),
    }
  }, [macroSnapshot])

  const safeAddEntryMinScoreWithMacro = Math.max(0, Math.min(100, safeAddEntryMinScore + macroRiskLevel.addScorePenalty))
  const safePartialTakeProfitPctWithMacro = Math.max(0, Math.min(50, safePartialTakeProfitPct - macroRiskLevel.partialTakeProfitBonus))

  const resolvePolicyForRow = useCallback((row: any): AccountPolicy | null => {
    const key = buildAccountKey(row?.broker_name, row?.account_name)
    return policyByKey.get(key) ?? null
  }, [policyByKey])

  const resolveAdvisoryThresholds = useCallback((row: any) => {
    const policy = resolvePolicyForRow(row)
    const addEntry = Math.max(0, Math.min(100, safeAddEntryMinScoreWithMacro + Number(policy?.add_entry_score_adjust || 0)))
    const partialTp = Math.max(0, Math.min(50, safePartialTakeProfitPctWithMacro + Number(policy?.partial_take_profit_adjust_pct || 0)))
    return {
      addEntry,
      partialTp,
      policy,
    }
  }, [resolvePolicyForRow, safeAddEntryMinScoreWithMacro, safePartialTakeProfitPctWithMacro])

  const getScoreValue = (row: any): number | null => {
    const score = Number(row?.total_score)
    return Number.isFinite(score) ? score : null
  }

  const getWarnReasonDetails = (row: any): string[] => {
    const details: string[] = []
    for (const item of WARN_REASON_LABELS) {
      if (row?.[item.key] === true) details.push(item.label)
    }
    return details
  }

  const evaluateHoldingState = (row: any): { state: 'hold' | 'add' | 'partial'; reasons: string[] } => {
    const reasons: string[] = []
    const thresholds = resolveAdvisoryThresholds(row)
    const pct = Number(row?.unrealized_pct)
    const warnScoreNum = Number(row?.warn_score)
    const warnScore = Number.isFinite(warnScoreNum) ? warnScoreNum : null
    const scoreSignal = String(row?.score_signal || '').trim().toUpperCase()
    const entryGrade = String(row?.entry_grade || '').trim().toUpperCase()
    const trendGrade = String(row?.trend_grade || '').trim().toUpperCase()
    const warnGrade = String(row?.warn_grade || '').trim().toUpperCase()
    const warnDetails = getWarnReasonDetails(row)

    const partialSignalHit = ['SELL', 'HOLD'].includes(scoreSignal) || ['WARN', 'SELL'].includes(warnGrade)
    const partialWarnScoreHit = warnScore != null && warnScore >= safePartialWarnScoreMin
    if (Number.isFinite(pct) && pct >= thresholds.partialTp && partialSignalHit && partialWarnScoreHit) {
      reasons.push(`수익률 ${formatNumber(pct, 2)}% >= ${formatNumber(thresholds.partialTp, 2)}%`)
      reasons.push(`신호/경고 조건 충족 (신호 ${toSignalLabel(scoreSignal)} / 경고 ${toWarnLabel(warnGrade)})`)
      reasons.push(`경고점수 ${formatNumber(warnScore, 1)} >= 기준 ${formatNumber(safePartialWarnScoreMin, 1)}`)
      if (thresholds.policy) reasons.push(`계좌정책 반영(${accountLabel(thresholds.policy.broker_name, thresholds.policy.account_name)})`)
      if (warnDetails.length > 0) reasons.push(`상세 경고: ${warnDetails.join(', ')}`)
      return { state: 'partial', reasons }
    }

    const score = getScoreValue(row)
    const hasAddSignal = Number(row?.recommended_buy_qty || 0) > 0
    const hasPullbackHint = Boolean(entryGrade || trendGrade || warnGrade)
    const entryTrendOk = !hasPullbackHint || (['A', 'B'].includes(entryGrade) && ['A', 'B'].includes(trendGrade))
    const riskOk = !warnGrade || ['SAFE', 'WATCH'].includes(warnGrade)
    const signalOk = !scoreSignal || scoreSignal !== 'SELL'
    const scoreOk = score == null || score >= thresholds.addEntry
    if (hasAddSignal && scoreOk && entryTrendOk && riskOk && signalOk) {
      reasons.push(`추가매수 제안 수량 ${Number(row?.recommended_buy_qty || 0)}주`) 
      reasons.push(`점수 조건 ${score == null ? '점수 없음' : formatNumber(score, 1)} / 기준 ${formatNumber(thresholds.addEntry, 1)}`)
      reasons.push(`진입/추세/경고 ${entryGrade || '-'} / ${trendGrade || '-'} / ${toWarnLabel(warnGrade)}`)
      if (thresholds.policy) reasons.push(`계좌정책 반영(${accountLabel(thresholds.policy.broker_name, thresholds.policy.account_name)})`)
      if (warnDetails.length > 0) reasons.push(`상세 경고: ${warnDetails.join(', ')}`)
      return { state: 'add', reasons }
    }

    reasons.push('추가매수/부분청산 조건 미충족')
    if (Number.isFinite(pct)) reasons.push(`현재 수익률 ${formatNumber(pct, 2)}%`)
    if (warnScore != null) reasons.push(`경고점수 ${formatNumber(warnScore, 1)}`)
    if (warnDetails.length > 0) reasons.push(`상세 경고: ${warnDetails.join(', ')}`)
    return { state: 'hold', reasons }
  }

  const getHoldingState = (row: any): 'hold' | 'add' | 'partial' => {
    return evaluateHoldingState(row).state
  }

  const getPerformanceGrade = (row: any): 'A' | 'B' | 'C' => {
    const score = getScoreValue(row)
    if (score == null) return 'C'
    if (score >= safeGradeAThreshold) return 'A'
    if (score >= safeGradeBThreshold) return 'B'
    return 'C'
  }

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

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(PORTFOLIO_RULES_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      const nextA = Number(parsed?.gradeAThreshold)
      const nextB = Number(parsed?.gradeBThreshold)
      const nextAdd = Number(parsed?.addEntryMinScore)
      const nextPartialPct = Number(parsed?.partialTakeProfitPct)
      const nextPartialWarn = Number(parsed?.partialWarnScoreMin)
      if (Number.isFinite(nextA)) setGradeAThreshold(nextA)
      if (Number.isFinite(nextB)) setGradeBThreshold(nextB)
      if (Number.isFinite(nextAdd)) setAddEntryMinScore(nextAdd)
      if (Number.isFinite(nextPartialPct)) setPartialTakeProfitPct(nextPartialPct)
      if (Number.isFinite(nextPartialWarn)) setPartialWarnScoreMin(nextPartialWarn)
    } catch {
      // ignore malformed local storage value
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(PORTFOLIO_RULES_STORAGE_KEY, JSON.stringify({
        gradeAThreshold,
        gradeBThreshold,
        addEntryMinScore,
        partialTakeProfitPct,
        partialWarnScoreMin,
      }))
    } catch {
      // ignore local storage write errors
    }
  }, [gradeAThreshold, gradeBThreshold, addEntryMinScore, partialTakeProfitPct, partialWarnScoreMin])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(PORTFOLIO_ASSET_OVERVIEW_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      const nextInitialCapital = Number(parsed?.initialCapital)
      const nextOpen = parsed?.assetAccordionOpen
      if (Number.isFinite(nextInitialCapital) && nextInitialCapital > 0) {
        setInitialCapital(nextInitialCapital)
        setInitialCapitalInput(String(Math.round(nextInitialCapital)))
      }
      if (typeof nextOpen === 'boolean') setAssetAccordionOpen(nextOpen)
    } catch {
      // ignore malformed local storage value
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(PORTFOLIO_ASSET_OVERVIEW_STORAGE_KEY, JSON.stringify({
        initialCapital,
        assetAccordionOpen,
      }))
    } catch {
      // ignore local storage write errors
    }
  }, [initialCapital, assetAccordionOpen])

  // 클라이언트 사이드 파생 상태 – API 재호출 없이 즉시 필터링
  const holdingAll = useMemo(() => allRows.filter((r: any) => r.position_type === 'holding'), [allRows])
  const virtualHoldingRows = useMemo(() => holdingAll.filter((r: any) => isVirtualPositionRow(r)), [holdingAll])

  const sectors = useMemo(() => {
    const base = holdingAll
    const seen = new Map<string, { id: string; name: string }>()
    for (const r of base) {
      const s = r.stock?.sector
      if (s?.id && s?.name && !seen.has(String(s.id))) {
        seen.set(String(s.id), { id: String(s.id), name: String(s.name) })
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  }, [holdingAll])

  const filteredRows = useMemo(() => {
    let result: any[] = holdingAll
    if (selectedAccountKey === 'virtual') {
      result = result.filter((r: any) => isVirtualPositionRow(r))
    } else if (selectedAccountKey !== 'all') {
      result = result.filter((r: any) => buildAccountKey(r?.broker_name, r?.account_name) === selectedAccountKey)
    }
    if (selectedSector) result = result.filter((r: any) => String(r.stock?.sector_id ?? '') === selectedSector)
    if (search) {
      const q = search.toLowerCase()
      result = result.filter((r: any) =>
        (r.code || '').toLowerCase().includes(q) ||
        (r.stock_name || '').toLowerCase().includes(q)
      )
    }

    if (holdingStateFilter !== 'all') {
      result = result.filter((r: any) => getHoldingState(r) === holdingStateFilter)
    }

    if (gradeFilter !== 'all') {
      result = result.filter((r: any) => getPerformanceGrade(r) === gradeFilter)
    }

    return result
  }, [holdingAll, selectedAccountKey, selectedSector, search, holdingStateFilter, gradeFilter, safePartialTakeProfitPctWithMacro, safePartialWarnScoreMin, safeAddEntryMinScoreWithMacro, safeGradeAThreshold, safeGradeBThreshold])

  const total = filteredRows.length
  const totalPages = Math.ceil(total / pageSize)
  const rows = filteredRows.slice((page - 1) * pageSize, page * pageSize)
  const summaryRows = selectedAccountKey === 'all'
    ? holdingAll
    : selectedAccountKey === 'virtual'
      ? virtualHoldingRows
      : holdingAll.filter((r: any) => buildAccountKey(r?.broker_name, r?.account_name) === selectedAccountKey)
  const selectedAccountLabel = selectedAccountKey === 'all'
    ? '전체 계좌'
    : selectedAccountKey === 'virtual'
      ? '가상매매'
      : accountLabel(
          accountFolders.find(f => f.key === selectedAccountKey)?.brokerName,
          accountFolders.find(f => f.key === selectedAccountKey)?.accountName,
        )
  const totalUnrealized = summaryRows.reduce((acc: number, r: any) => acc + Number(r.unrealized_pnl || 0), 0)
  const totalInvested = summaryRows.reduce((acc: number, r: any) => acc + (Number(r.quantity || 0) * Number(r.avg_price || 0)), 0)
  // 비용 계산: 매수비용(이미 발생) + 매도예상비용(현재가 기준)
  const totalTradeCost = summaryRows.reduce((acc: number, r: any) => {
    const invested = Number(r.quantity || 0) * Number(r.avg_price || 0)
    const currentValue = invested + Number(r.unrealized_pnl || 0)
    const buyCost = invested * (buyFeeRatePct / 100)
    const sellCost = currentValue > 0 ? currentValue * (sellFeeRatePct / 100) : 0
    return acc + buyCost + sellCost
  }, 0)
  const adjustedUnrealized = includeCost ? totalUnrealized - totalTradeCost : totalUnrealized
  const totalReturnPct = totalInvested > 0 ? (adjustedUnrealized / totalInvested) * 100 : 0
  const totalEvaluationValue = totalInvested + adjustedUnrealized
  const estimatedCash = initialCapital - totalInvested
  const totalAssetValue = totalEvaluationValue + estimatedCash
  const allocationRows = useMemo(() => {
    const items = summaryRows
      .map((r: any) => {
        const quantity = Number(r.quantity || 0)
        const avgPrice = Number(r.avg_price || 0)
        const unrealized = Number(r.unrealized_pnl || 0)
        const marketValue = quantity > 0 ? (quantity * avgPrice + unrealized) : 0
        const safeValue = Number.isFinite(marketValue) ? marketValue : 0
        return {
          code: String(r.code || '-'),
          name: String(r.stock_name || r.ticker || r.symbol || r.code || '-'),
          value: Math.max(0, safeValue),
        }
      })
      .filter((row) => row.value > 0)
      .sort((a, b) => b.value - a.value)

    if (estimatedCash > 0) {
      items.push({
        code: 'CASH',
        name: '현금',
        value: estimatedCash,
      })
    }

    const sum = items.reduce((acc, row) => acc + row.value, 0)
    if (sum <= 0) return [] as Array<{ code: string; name: string; value: number; ratio: number }>

    return items.map((row) => ({
      ...row,
      ratio: (row.value / sum) * 100,
    }))
  }, [summaryRows, estimatedCash])

  const allocationColors = [
    '#2f7ae5',
    '#14b8a6',
    '#f59e0b',
    '#ef4444',
    '#8b5cf6',
    '#06b6d4',
    '#84cc16',
    '#f97316',
    '#ec4899',
    '#64748b',
  ]

  const allocationChartStyle = useMemo(() => {
    if (allocationRows.length === 0) return 'conic-gradient(#e5e7eb 0deg 360deg)'
    let currentAngle = 0
    const parts = allocationRows.map((row, idx) => {
      const start = currentAngle
      const angle = (row.ratio / 100) * 360
      currentAngle += angle
      const end = idx === allocationRows.length - 1 ? 360 : currentAngle
      return `${allocationColors[idx % allocationColors.length]} ${start.toFixed(2)}deg ${end.toFixed(2)}deg`
    })
    return `conic-gradient(${parts.join(', ')})`
  }, [allocationRows])

  const applyInitialCapital = () => {
    const next = Number(initialCapitalInput)
    if (!Number.isFinite(next) || next <= 0) {
      toast.show('가상 예수금은 1원 이상으로 입력해 주세요')
      setInitialCapitalInput(String(Math.round(initialCapital || DEFAULT_INITIAL_CAPITAL)))
      return
    }
    setInitialCapital(Math.round(next))
    toast.show('가상 예수금을 저장했습니다')
  }

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
        toast.show(`${label} 계좌/보유 저장(${action}) 완료 ✓`)
      } else if (maintMode === 'holdingdelete') {
        toast.show(`${maintCode} 종목이 완전 삭제되었습니다 (기록 포함)`)
      } else {
        toast.show('보유수정 완료 ✓')
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

  const submitTrade = async () => {
    if (!modalRow) return
    if (!tradeQty || tradeQty <= 0) { setTradeError('수량은 1 이상이어야 합니다'); return }
    if (tradePrice !== '' && Number(tradePrice) <= 0) { setTradeError('가격은 0보다 커야 합니다'); return }

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
        toast.show(`${modalSide === 'buy' ? '매수' : '매도'} 등록 완료 ✓`)
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

  const visibleSectors = showAllSectors ? sectors : sectors.slice(0, 8)

  const onSectorChange = (sectorId: string | null) => {
    setSelectedSector(sectorId)
    setPage(1)
  }

  const formatSignedKrw = (value: number) => {
    const num = Number(value || 0)
    if (num === 0) return formatKrw(0)
    return `${num > 0 ? '+' : '-'}${formatKrw(Math.abs(num))}`
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
      <table className="xls-table" style={{ width: '100%', tableLayout: 'fixed', marginBottom: 'var(--space-4)' }}>
        <colgroup>
          <col style={{ width: '18%' }} />
          <col style={{ width: '18%' }} />
          <col style={{ width: '16%' }} />
          <col style={{ width: '16%' }} />
          <col style={{ width: '16%' }} />
          <col style={{ width: '16%' }} />
        </colgroup>
        <tbody>
          <tr className="xls-row xls-row--even">
            <td className="xls-cell" colSpan={6} style={{ padding: '8px 10px' }}>
              <SheetHeaderBar
                title="포트폴리오"
                subtitle={portfolioHeaderSubtitle}
                action={<EconomicEventBadge onNavigateToCalendar={() => navigate('/market')} />}
              />
            </td>
          </tr>
          <tr className="xls-row xls-row--even">
            <td className="xls-cell" colSpan={4} style={{ padding: '8px 10px' }}>
              <div className="portfolio-head-controls" style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
                <Button variant="secondary" onClick={() => load({ force: true })} disabled={loading || refreshing}>
                  {refreshing ? '새로고침 중...' : '새로고침'}
                </Button>
                <span className="portfolio-total-pill">
                  {allRows.length > 0 ? `총 ${allRows.length}개` : '포지션 집계 준비중'}
                </span>
                <Button variant="secondary" onClick={() => setShareModalOpen(true)} disabled={loading || holdingAll.length === 0}>공유 요약 보기</Button>
              </div>
            </td>
            <td className="xls-cell" colSpan={2} style={{ padding: '8px 10px' }}>
              <div className="portfolio-head-maintenance" role="group" aria-label="포트폴리오 유지보수 작업" style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
                <Button variant="ghost" size="sm" onClick={() => openMaintenanceModal('holdingrestore')} disabled={loading}>
                  계좌/보유 추가
                </Button>
                <Button variant="ghost" size="sm" onClick={() => openMaintenanceModal('liquidateall')} disabled={loading || holdingAll.length === 0}>
                  전체매도
                </Button>
              </div>
            </td>
          </tr>
          <tr className="xls-row">
            <td className="xls-cell" colSpan={6} style={{ padding: '8px 10px' }}>
              <div className="portfolio-account-tabs" style={{ display: 'flex', gap: 'var(--space-1)', padding: '0', overflowX: 'auto' }}>
                <button className={`portfolio-tab ${selectedAccountKey === 'all' ? 'active' : ''}`} onClick={() => { setSelectedAccountKey('all'); setPage(1) }} style={{ padding: 'var(--space-2) var(--space-3)', border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: selectedAccountKey === 'all' ? 'var(--font-weight-bold)' : 'normal', color: selectedAccountKey === 'all' ? 'var(--color-text-primary)' : 'var(--color-text-secondary)', borderBottom: selectedAccountKey === 'all' ? '2px solid var(--color-primary)' : 'none', fontSize: 'var(--font-size-sm)', whiteSpace: 'nowrap', flexShrink: 0 }}>전체</button>
                <button className={`portfolio-tab ${selectedAccountKey === 'virtual' ? 'active' : ''}`} onClick={() => { setSelectedAccountKey('virtual'); setPage(1) }} style={{ padding: 'var(--space-2) var(--space-3)', border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: selectedAccountKey === 'virtual' ? 'var(--font-weight-bold)' : 'normal', color: selectedAccountKey === 'virtual' ? 'var(--color-text-primary)' : 'var(--color-text-secondary)', borderBottom: selectedAccountKey === 'virtual' ? '2px solid var(--color-primary)' : 'none', fontSize: 'var(--font-size-sm)', whiteSpace: 'nowrap', flexShrink: 0 }}>가상매매 ({virtualHoldingRows.length})</button>
                {accountFolders.map((account) => (
                  <button key={account.key} className={`portfolio-tab ${selectedAccountKey === account.key ? 'active' : ''}`} onClick={() => { setSelectedAccountKey(account.key); setPage(1) }} style={{ padding: 'var(--space-2) var(--space-3)', border: 'none', background: 'transparent', cursor: 'pointer', fontWeight: selectedAccountKey === account.key ? 'var(--font-weight-bold)' : 'normal', color: selectedAccountKey === account.key ? 'var(--color-text-primary)' : 'var(--color-text-secondary)', borderBottom: selectedAccountKey === account.key ? '2px solid var(--color-primary)' : 'none', fontSize: 'var(--font-size-sm)', whiteSpace: 'nowrap', flexShrink: 0 }} title={`${accountLabel(account.brokerName, account.accountName)} (${account.count})`}>
                    {accountLabel(account.brokerName, account.accountName)} ({account.count})
                  </button>
                ))}
              </div>
            </td>
          </tr>
          <tr className="xls-row xls-row--even portfolio-summary-row portfolio-summary-row--label">
            <td className="xls-cell" colSpan={2} style={{ fontSize: 13, fontWeight: 600 }}>보유 종목</td>
            <td className="xls-cell" colSpan={2} style={{ fontSize: 13, fontWeight: 600 }}>현재 실제 매수금</td>
            <td className="xls-cell" colSpan={2} style={{ fontSize: 13, fontWeight: 600 }}>평가손익 합계</td>
          </tr>
          <tr className="xls-row portfolio-summary-row portfolio-summary-row--value">
            <td className="xls-cell portfolio-cell-num" colSpan={2} style={{ fontSize: 18, fontWeight: 700 }}>{summaryRows.length}</td>
            <td className="xls-cell portfolio-cell-num" colSpan={2} style={{ fontSize: 18, fontWeight: 700 }}>{formatKrw(totalInvested)}</td>
            <td className="xls-cell portfolio-cell-num" colSpan={2} style={{ fontSize: 18, fontWeight: 700 }}>
              <span className={adjustedUnrealized < 0 ? 'negative' : 'positive'}>{formatKrw(adjustedUnrealized)}</span>
            </td>
          </tr>
          <tr className="xls-row xls-row--even portfolio-summary-row portfolio-summary-row--note">
            <td className="xls-cell" colSpan={2} style={{ color: 'var(--color-text-tertiary)', fontSize: 11 }}>{selectedAccountLabel}</td>
            <td className="xls-cell portfolio-cell-num" colSpan={2} style={{ color: 'var(--color-text-tertiary)', fontSize: 11 }}>보유 수량×평균 매수가</td>
            <td className="xls-cell portfolio-cell-num" colSpan={2} style={{ color: 'var(--color-text-tertiary)', fontSize: 11 }}>
              {includeCost
                ? `비용 ${formatKrw(Math.round(totalTradeCost))} 차감`
                : '보유 포지션 기준'}
            </td>
          </tr>
        </tbody>
      </table>

      <div className="card mb-4 portfolio-macro-card">
        <div className="title-md" style={{ marginBottom: 'var(--space-2)' }}>거시 반영 어드바이저 (금리·유가·CPI)</div>
        <div className="caption muted" style={{ marginBottom: 'var(--space-2)' }}>
          {macroLoading
            ? '거시지표 로딩 중...'
            : `${macroRiskLevel.diagnosis} · 정책 ${macroRiskLevel.label} · 추가매수 기준 +${macroRiskLevel.addScorePenalty}점 · 부분익절 기준 -${macroRiskLevel.partialTakeProfitBonus}%p`}
        </div>
        <div className="portfolio-macro-grid">
          <div className="portfolio-macro-metric"><span>미국10년물</span><strong>{macroRiskLevel.us10y != null ? `${formatNumber(macroRiskLevel.us10y, 2)}%` : '—'}</strong></div>
          <div className="portfolio-macro-metric"><span>WTI유가</span><strong>{macroRiskLevel.wtiOil != null ? `$${formatNumber(macroRiskLevel.wtiOil, 1)}` : '—'}</strong></div>
          <div className="portfolio-macro-metric"><span>CPI YoY</span><strong>{macroRiskLevel.cpiYoy != null ? `${formatNumber(macroRiskLevel.cpiYoy, 2)}%` : '미설정'}</strong></div>
        </div>
      </div>

      <div className="card mb-4 portfolio-policy-card">
        <button
          type="button"
          className="portfolio-policy-head"
          onClick={() => setPolicyAccordionOpen((prev) => !prev)}
          aria-expanded={policyAccordionOpen}
          style={{
            background: 'none',
            border: 'none',
            padding: 0,
            cursor: 'pointer',
            width: '100%',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: policyAccordionOpen ? 'var(--space-3)' : 0,
          }}
        >
          <div>
            <div className="title-md">계좌별 위험정책</div>
            <div className="caption muted" style={{ marginTop: 'var(--space-1)' }}>
              {selectedAccountKey === 'all' 
                ? '계좌 폴더를 선택하면 정책 설정'
                : selectedAccountKey === 'virtual'
                  ? '가상매매는 개별 정책 미적용'
                  : `${accountLabel(policyDraft?.broker_name, policyDraft?.account_name)} ${policyLoading ? '조회 중...' : ''}`
              }
            </div>
          </div>
          <ChevronDown size={20} style={{ transform: policyAccordionOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', flexShrink: 0 }} />
        </button>

        {policyAccordionOpen && (
          <div className="portfolio-policy-body" style={{ paddingTop: 'var(--space-3)' }}>
            {selectedAccountKey === 'all' ? (
              <div className="caption muted">계좌 폴더를 선택하면 해당 계좌의 정책(최대보유/일손실/현금비중/점수 가감)을 설정할 수 있습니다.</div>
            ) : selectedAccountKey === 'virtual' ? (
              <div className="caption muted">가상매매 탭은 개별 계좌 정책 대상이 아닙니다. 특정 계좌 탭을 선택하면 정책을 설정할 수 있습니다.</div>
            ) : policyDraft ? (
              <>
                <div className="caption muted" style={{ marginBottom: 'var(--space-3)' }}>
                  대상: {accountLabel(policyDraft.broker_name, policyDraft.account_name)}
                  {policyLoading ? ' · 정책 조회 중...' : ''}
                </div>
                <div className="portfolio-policy-grid">
                  <label className="ui-label">
                    <span>리스크 프로필</span>
                    <select
                      className="input"
                      value={String(policyDraft.risk_profile)}
                      onChange={(e: any) => setPolicyDraft((prev) => prev ? { ...prev, risk_profile: (String(e?.target?.value || 'balanced') as any) } : prev)}
                    >
                      <option value="safe">safe</option>
                      <option value="balanced">balanced</option>
                      <option value="active">active</option>
                    </select>
                  </label>
                  <Input
                    label="최대 보유 종목 수"
                    type="number"
                    value={policyDraft.max_positions == null ? '' : String(policyDraft.max_positions)}
                    onChange={(e: any) => setPolicyDraft((prev) => prev ? { ...prev, max_positions: e?.target?.value === '' ? null : Number(e?.target?.value) } : prev)}
                  />
                  <Input
                    label="일손실 한도(%)"
                    type="number"
                    value={policyDraft.daily_loss_limit_pct == null ? '' : String(policyDraft.daily_loss_limit_pct)}
                    onChange={(e: any) => setPolicyDraft((prev) => prev ? { ...prev, daily_loss_limit_pct: e?.target?.value === '' ? null : Number(e?.target?.value) } : prev)}
                  />
                  <Input
                    label="최소 현금 비중(%)"
                    type="number"
                    value={policyDraft.min_cash_reserve_pct == null ? '' : String(policyDraft.min_cash_reserve_pct)}
                    onChange={(e: any) => setPolicyDraft((prev) => prev ? { ...prev, min_cash_reserve_pct: e?.target?.value === '' ? null : Number(e?.target?.value) } : prev)}
                  />
                  <Input
                    label="추가매수 점수 가감"
                    type="number"
                    value={String(policyDraft.add_entry_score_adjust || 0)}
                    onChange={(e: any) => setPolicyDraft((prev) => prev ? { ...prev, add_entry_score_adjust: Number(e?.target?.value || 0) } : prev)}
                  />
                  <Input
                    label="부분익절 기준 가감(%p)"
                    type="number"
                    value={String(policyDraft.partial_take_profit_adjust_pct || 0)}
                    onChange={(e: any) => setPolicyDraft((prev) => prev ? { ...prev, partial_take_profit_adjust_pct: Number(e?.target?.value || 0) } : prev)}
                  />
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
                  <Button variant="secondary" onClick={() => { void savePolicyDraft() }} disabled={policySaving}>
                    {policySaving ? '저장 중...' : '정책 저장'}
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        )}
      </div>

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
                  ? `신뢰점수 ${advisorPerf.summary.trustScore ?? '—'} · 의사결정 ${advisorPerf.summary.totalDecisions ?? 0}건`
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
                  <div className="portfolio-performance-metric"><span>신뢰 점수</span><strong>{advisorPerf.summary.trustScore ?? '—'}</strong></div>
                  <div className="portfolio-performance-metric"><span>의사결정 수</span><strong>{advisorPerf.summary.totalDecisions ?? 0}</strong></div>
                  <div className="portfolio-performance-metric"><span>매도 승률</span><strong>{advisorPerf.summary.linkedSellWinRatePct != null ? `${formatNumber(advisorPerf.summary.linkedSellWinRatePct, 1)}%` : '—'}</strong></div>
                  <div className="portfolio-performance-metric"><span>누적 실현손익</span><strong>{formatKrw(Number(advisorPerf.summary.linkedRealizedPnl || 0))}</strong></div>
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

      <div className="card mb-4 portfolio-asset-overview-card">
        <button
          type="button"
          className="portfolio-asset-overview-head"
          onClick={() => setAssetAccordionOpen((prev) => !prev)}
          aria-expanded={assetAccordionOpen}
        >
          <div>
            <div className="title-md">가상 자산 구성 및 리밸런싱 기준</div>
            <div className="caption muted">
              {selectedAccountKey === 'all' 
                ? '전체 가상 계좌의 예수금, 평가금, 현금, 종목별 비중을 확인합니다.'
                : selectedAccountKey === 'virtual'
                  ? '가상매매 보유분의 예수금, 평가금, 현금, 종목별 비중을 확인합니다.'
                  : `${accountLabel(
                      accountFolders.find(f => f.key === selectedAccountKey)?.brokerName,
                      accountFolders.find(f => f.key === selectedAccountKey)?.accountName
                    )} 계좌의 예수금, 평가금, 현금, 종목별 비중을 확인합니다.`
              }
            </div>
          </div>
          <span className="portfolio-asset-overview-toggle" aria-hidden>
            <ChevronDown size={20} style={{ transform: assetAccordionOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s' }} />
          </span>
        </button>

        {assetAccordionOpen && (
          <div className="portfolio-asset-overview-body">

            <div className="portfolio-asset-overview-input-row">
              <Input
                label="가상 예수금"
                type="number"
                value={initialCapitalInput}
                onChange={(e: any) => setInitialCapitalInput(String(e?.target?.value || ''))}
              />
              <Button variant="secondary" onClick={applyInitialCapital}>적용</Button>
            </div>

            <div className="portfolio-asset-metrics">
              <div className="portfolio-asset-metric">
                <div className="portfolio-capture-label">가상 예수금</div>
                <div className="portfolio-capture-value">{formatKrw(initialCapital)}</div>
              </div>
              <div className="portfolio-asset-metric">
                <div className="portfolio-capture-label">보유 평가금</div>
                <div className="portfolio-capture-value">{formatKrw(totalEvaluationValue)}</div>
              </div>
              <div className="portfolio-asset-metric">
                <div className="portfolio-capture-label">추정 예수금</div>
                <div className={`portfolio-capture-value ${estimatedCash < 0 ? 'negative' : ''}`}>{formatKrw(estimatedCash)}</div>
              </div>
              <div className="portfolio-asset-metric">
                <div className="portfolio-capture-label">총 자산(보유 평가금 + 예수금)</div>
                <div className={`portfolio-capture-value ${totalAssetValue < 0 ? 'negative' : 'positive'}`}>{formatKrw(totalAssetValue)}</div>
              </div>
            </div>

            <div className="portfolio-allocation-wrap">
              <div className="portfolio-allocation-chart-wrap">
                <div className="portfolio-allocation-chart" style={{ background: allocationChartStyle }} />
                <div className="portfolio-allocation-chart-center">
                  <div className="portfolio-allocation-center-label">총 자산</div>
                  <div className="portfolio-allocation-center-value">{formatKrw(totalAssetValue)}</div>
                </div>
              </div>

              <div className="portfolio-allocation-list">
                {allocationRows.length === 0 ? (
                  <div className="caption muted">비중을 계산할 데이터가 없습니다.</div>
                ) : (
                  allocationRows.map((row, idx) => (
                    <div key={`${row.code}-${idx}`} className="portfolio-allocation-item">
                      <div className="portfolio-allocation-item-name">
                        <span className="portfolio-allocation-dot" style={{ background: allocationColors[idx % allocationColors.length] }} />
                        <span>{row.name}</span>
                      </div>
                      <div className="portfolio-allocation-item-values">
                        <span>{formatNumber(row.ratio, 1)}%</span>
                        <span className="muted">{formatKrw(row.value)}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            <div className="caption muted" style={{ marginTop: 'var(--space-2)' }}>
              추정 예수금은 시작 자금에서 보유 투자금액을 뺀 값입니다. 실제 증권사 예수금이 있으면 그 값을 우선 쓰는 편이 더 정확합니다.
            </div>
          </div>
        )}
      </div>

      {/* 필터 */}
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
            {filterAccordionOpen ? '접기 ▲' : '펼치기 ▼'}
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
              {visibleSectors.map((s: any) => (
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
                    onChange={(e: any) => setSellFeeRatePct(Math.max(0, Number(e?.target?.value ?? 0.195)))}
                  />
                </div>
                <div className="caption muted" style={{ marginTop: 'var(--space-1)' }}>
                  기본값 매수 0.015% · 매도 0.195% (수수료 0.015% + KOSPI 거래세 0.18%). 실제 증권사 수수료나 시장별 세율이 다르면 직접 조정하세요.
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

      {error && (
        <div className="portfolio-error-wrap">
          <ErrorState message={error} onRetry={() => load({ force: true })} />
        </div>
      )}

      <div className="cards-list portfolio-cards-list">
        {loading && rows.length === 0 && <div className="card portfolio-loading-card"><Skeleton lines={5} height={18} /></div>}

        {!loading && !error && rows.length === 0 && (
          <>
            <EmptyState
              title="보유 포지션 없음"
              description="상단 유지보수 > 계좌/보유 추가에서 계좌와 종목을 바로 등록할 수 있습니다."
            />
            <div style={{ display: 'flex', justifyContent: 'center', marginTop: 'var(--space-3)' }}>
              <Button variant="secondary" onClick={() => openMaintenanceModal('holdingrestore')} disabled={loading}>
                계좌/보유 추가 열기
              </Button>
            </div>
          </>
        )}

        {!error && rows.map((r: any) => {
          const pnl = r.unrealized_pnl
          const stateEvaluation = evaluateHoldingState(r)
          const holdingState = stateEvaluation.state
          const grade = getPerformanceGrade(r)
          const score = getScoreValue(r)
          const scoreSignal = String(r?.score_signal || '').trim().toUpperCase()
          const entryGrade = String(r?.entry_grade || '').trim().toUpperCase()
          const trendGrade = String(r?.trend_grade || '').trim().toUpperCase()
          const warnGrade = String(r?.warn_grade || '').trim().toUpperCase()
          const warnScore = Number.isFinite(Number(r?.warn_score)) ? Number(r?.warn_score) : null
          const reasonKey = String(r?.id ?? r?.code ?? Math.random())
          const reasonOpen = openReasonKey === reasonKey

          // 판정근거 배지 계산
          const reasonBadges: { label: string; type: 'partial' | 'add' | 'warn' | 'ok' | 'neutral' }[] = []
          if (holdingState === 'partial') {
            reasonBadges.push({ label: '익절구간', type: 'partial' })
            if (['SELL', 'HOLD'].includes(scoreSignal)) reasonBadges.push({ label: scoreSignal === 'SELL' ? '매도신호' : '보유신호', type: 'warn' })
            if (['WARN', 'SELL'].includes(warnGrade)) reasonBadges.push({ label: '경고강함', type: 'warn' })
            if (warnScore != null) reasonBadges.push({ label: `경고점수 ${formatNumber(warnScore, 0)}`, type: 'warn' })
          } else if (holdingState === 'add') {
            reasonBadges.push({ label: '추가진입', type: 'add' })
            if (score != null) reasonBadges.push({ label: `점수충족 ${formatNumber(score, 0)}`, type: 'ok' })
            if (['A', 'B'].includes(entryGrade)) reasonBadges.push({ label: `진입${entryGrade}`, type: 'ok' })
            if (['A', 'B'].includes(trendGrade)) reasonBadges.push({ label: `추세${trendGrade}`, type: 'ok' })
          } else {
            if (score != null && score < safeAddEntryMinScore) reasonBadges.push({ label: '점수부족', type: 'neutral' })
            if (['WARN', 'SELL'].includes(warnGrade)) reasonBadges.push({ label: '경고있음', type: 'warn' })
            if (['SELL'].includes(scoreSignal)) reasonBadges.push({ label: '매도신호', type: 'warn' })
            if (reasonBadges.length === 0) reasonBadges.push({ label: '관망', type: 'neutral' })
          }

          return (
            <div key={r.id} className="card card-lg portfolio-position-card">

              {/* ── 헤더: 종목명 + 손익 ── */}
              <div className="portfolio-card-header">
                <div className="portfolio-card-title-group">
                  <span className="title-lg">{r.stock_name ?? r.ticker ?? r.symbol}</span>
                  <span className="caption muted portfolio-stock-code">{r.code}</span>
                </div>
                <div className="text-right portfolio-position-pnl">
                  {(() => {
                    const rawPnl = pnl != null ? Number(pnl) : null
                    let displayPnl = rawPnl
                    let displayPct = r.unrealized_pct != null ? Number(r.unrealized_pct) : null
                    if (includeCost && rawPnl != null) {
                      const inv = Number(r.quantity || 0) * Number(r.avg_price || 0)
                      const curVal = inv + rawPnl
                      const cost = inv * (buyFeeRatePct / 100) + (curVal > 0 ? curVal * (sellFeeRatePct / 100) : 0)
                      displayPnl = rawPnl - cost
                      displayPct = inv > 0 ? (displayPnl / inv) * 100 : null
                    }
                    return (
                      <>
                        <div
                          className={`portfolio-pnl-amount${displayPnl != null ? (displayPnl < 0 ? ' negative' : ' positive') : ''}`}
                        >
                          {displayPnl != null ? formatKrw(displayPnl) : '—'}
                        </div>
                        <div className="caption muted">
                          {displayPct != null ? `${formatNumber(displayPct, 2)}%` : '—'}
                          {r.hold_days != null ? ` · ${r.hold_days}일` : ''}
                        </div>
                      </>
                    )
                  })()}
                </div>
              </div>

              {/* ── 보유 정보: 수량 · 평균매수가 · 매수일 ── */}
              <div className="caption muted portfolio-position-meta">
                {r.quantity}주 · 평균가 {formatKrw(r.avg_price)}{r.buy_date ? ` · ${r.buy_date}` : ''}
              </div>

              {/* ── 계좌 · 상태 · 등급 칩 ── */}
              <div className="portfolio-card-chips">
                <span className="portfolio-account-chip">
                  <Building2 size={11} />
                  {accountLabel(r?.broker_name, r?.account_name)}
                </span>
                <span className={`portfolio-state-chip portfolio-state-chip--${holdingState}`}>
                  {holdingState === 'partial' ? '부분청산 후보' : holdingState === 'add' ? '추가매수' : '보통 보유'}
                </span>
                <span className="portfolio-grade-chip">
                  등급 {grade} · 점수 {score != null ? formatNumber(score, 1) : '—'}
                  {scoreSignal ? ` · ${toSignalLabel(scoreSignal)}` : ''}
                </span>
                {(entryGrade || trendGrade || warnGrade) && (
                  <span className="portfolio-grade-chip">
                    진입 {entryGrade || '-'} / 추세 {trendGrade || '-'} / 경고 {toWarnLabel(warnGrade)}
                  </span>
                )}
              </div>

              {/* ── 판정 배지 + 판정근거 토글 ── */}
              <div className="portfolio-card-badges-row">
                {reasonBadges.map((b, i) => (
                  <span
                    key={i}
                    className={`portfolio-reason-badge portfolio-reason-badge--${b.type}`}
                    title={BADGE_TOOLTIPS[b.label] || b.label}
                  >
                    {b.label}
                  </span>
                ))}
                {stateEvaluation.reasons.length > 0 && (
                  <button
                    type="button"
                    className="portfolio-reason-toggle"
                    onClick={() => setOpenReasonKey(reasonOpen ? null : reasonKey)}
                    aria-expanded={reasonOpen}
                  >
                    {reasonOpen ? '판정근거 접기' : '판정근거 보기'}
                  </button>
                )}
              </div>

              {/* ── 판정근거 패널 ── */}
              {reasonOpen && stateEvaluation.reasons.length > 0 && (
                <div className="portfolio-reason-panel" role="note" aria-label="판정 근거 상세">
                  {stateEvaluation.reasons.map((reason, idx) => (
                    <div key={`${reasonKey}-${idx}`} className="portfolio-reason-line">• {reason}</div>
                  ))}
                </div>
              )}

              {/* ── 로트 이력 ── */}
              {r.lots?.length > 0 && (
                <div className="caption portfolio-lots">
                  로트: {r.lots.map((l: any) => `${l.acquired_quantity}주 @${formatKrw(l.acquired_price)}`).join(' · ')}
                </div>
              )}

              {/* ── 액션 버튼 ── */}
              <div className="portfolio-actions-row" style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center', marginTop: 'var(--space-2)' }}>
                <Button className="portfolio-action-btn" variant="secondary" onClick={() => openTradeModal(r, 'buy')} style={{ flex: '1 1 auto', minWidth: '80px' }}>
                  <PlusCircle size={14} />추가매수
                </Button>
                <Button className="portfolio-action-btn" variant="secondary" onClick={() => openMaintenanceModal('holdingedit', r)} style={{ flex: '1 1 auto', minWidth: '80px' }}>
                  보유 수정
                </Button>
                <Button className="portfolio-action-btn" variant="ghost" onClick={() => openTradeModal(r, 'sell')} style={{ flex: '1 1 auto', minWidth: '100px' }}>
                  매도 · 수익기록
                </Button>
                <Button className="portfolio-action-btn" variant="ghost" onClick={() => openMaintenanceModal('holdingdelete', r)} style={{ flex: '1 1 auto', minWidth: '60px', color: 'var(--color-error)' }}>
                  삭제
                </Button>
              </div>
            </div>
          )
        })}
      </div>

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

      <Modal
        isOpen={modalOpen}
        title={modalSide === 'buy' ? '추가매수' : '매도 · 수익기록'}
        onClose={() => setModalOpen(false)}
        size="sm"
      >
        {modalRow && (
          <>
            <div className="muted" style={{ marginBottom: 'var(--space-3)' }}>
              <strong style={{ color: 'var(--color-text-primary)' }}>
                {modalRow.stock_name ?? modalRow.code}
              </strong>
              <span className="caption"> ({modalRow.code})</span>
            </div>

            {modalSide === 'buy' && modalRow?.lots?.length > 0 && (
              <div className="portfolio-modal-lots">
                <div className="portfolio-modal-lots-title">기존 매수 내역</div>
                {modalRow.lots.map((l: any, i: number) => (
                  <div key={i} className="portfolio-modal-lots-row">
                    {l.acquired_quantity}주 @ {formatKrw(l.acquired_price)}
                    {l.acquired_date ? <span className="muted"> · {l.acquired_date}</span> : null}
                  </div>
                ))}
              </div>
            )}

            {modalSide === 'buy' && (!modalRow?.lots || modalRow.lots.length === 0) && (
              <div className="portfolio-modal-lots">
                <div className="caption muted">현재 매수 내역: {modalRow.quantity}주 · 평균 {formatKrw(modalRow.avg_price)}</div>
              </div>
            )}

            <div className="grid-two" style={{ marginBottom: 'var(--space-4)' }}>
              <Input
                label="수량"
                type="number"
                value={String(tradeQty)}
                onChange={(e: any) => setTradeQty(Number(e.target.value))}
              />
              <Input
                label="가격 (미입력 시 현재가)"
                type="number"
                value={tradePrice === '' ? '' : String(tradePrice)}
                onChange={(e: any) => setTradePrice(e.target.value === '' ? '' : Number(e.target.value))}
              />
            </div>

            {tradeError && (
              <div className="state-error" style={{ marginBottom: 'var(--space-3)' }}>
                <div className="state-error-title">{tradeError}</div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <Button variant="primary" onClick={submitTrade} disabled={tradeLoading}>
                {tradeLoading ? '처리 중…' : '실행'}
              </Button>
              <Button variant="ghost" onClick={() => setModalOpen(false)}>취소</Button>
            </div>
          </>
        )}
      </Modal>

      <Modal
        isOpen={shareModalOpen}
        title="포트폴리오 공유 요약"
        onClose={() => setShareModalOpen(false)}
        size="lg"
      >
        <div className="portfolio-capture-card">
          <div className="portfolio-capture-top">
            <div>
              <div className="portfolio-capture-title">포트폴리오 요약</div>
              <div className="portfolio-capture-time">기준시각 {captureGeneratedAt}</div>
            </div>
              <div className="portfolio-capture-count">보유 {holdingAll.length}종목</div>
          </div>

          <div className="portfolio-share-control-grid">
            <div className="portfolio-share-ttl-field">
              <div className="caption muted" style={{ marginBottom: 'var(--space-1)' }}>링크 만료</div>
              <select
                className="input"
                value={String(shareTtlHours)}
                onChange={(e) => setShareTtlHours(Number(e.target.value) || 48)}
                disabled={shareCreating}
              >
                <option value="24">24시간</option>
                <option value="48">48시간</option>
                <option value="168">7일</option>
              </select>
            </div>

            <div className="portfolio-share-url-block">
              <div className="caption muted portfolio-share-url-label">공유 URL (인증 없이 접근 가능)</div>
              <div className="portfolio-share-url-row">
                <input
                  className="ui-text portfolio-share-url-input"
                  readOnly
                  value={sharedSummaryUrl || (shareCreating ? '공유 URL 생성 중...' : '')}
                />
                <Button variant="secondary" onClick={createPublicShareUrl} disabled={shareCreating}>
                  {shareCreating ? '생성 중...' : 'URL 재생성'}
                </Button>
                <Button variant="secondary" onClick={copyPortfolioShareUrl} disabled={!sharedSummaryUrl}>URL 복사</Button>
              </div>
            </div>
          </div>
          {shareExpiresAt && (
            <div className="caption muted" style={{ marginBottom: 'var(--space-3)' }}>
              링크 만료: {new Date(shareExpiresAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}
            </div>
          )}

          <div className="caption muted" style={{ marginBottom: 'var(--space-3)' }}>
            이 URL은 누구나 열람 가능한 공유 전용 단독 페이지입니다.
          </div>

          <div className="card" style={{ margin: 0, marginBottom: 'var(--space-3)', padding: 'var(--space-3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
              <div className="title-md">최근 공유 링크</div>
              <Button variant="secondary" onClick={() => { void loadShareHistory() }} disabled={shareHistoryLoading}>
                {shareHistoryLoading ? '조회 중...' : '새로고침'}
              </Button>
            </div>

            {shareHistory.length === 0 ? (
              <div className="caption muted">공유 이력이 없습니다.</div>
            ) : (
              <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
                {shareHistory.map((item) => {
                  const isRevoked = Boolean(item.revokedAt)
                  const isExpired = new Date(item.expiresAt).getTime() <= Date.now()
                  return (
                    <div key={item.shareId} className="portfolio-share-history-item">
                      <div className="portfolio-share-history-head">
                        <div className="caption">
                          생성 {item.createdAt ? new Date(item.createdAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) : '-'}
                          {' · '}만료 {new Date(item.expiresAt).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}
                          {' · '}조회 {Number(item.accessCount || 0)}회
                        </div>
                        <div className={`portfolio-share-history-status ${isRevoked ? 'is-revoked' : isExpired ? 'is-expired' : 'is-active'}`}>
                          {isRevoked ? '철회됨' : isExpired ? '만료됨' : '활성'}
                        </div>
                      </div>
                      <div className="portfolio-share-history-url">{item.url}</div>
                      <div className="portfolio-share-history-actions">
                        <Button
                          variant="secondary"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(String(item.url || ''))
                              toast.show('공유 URL을 복사했습니다')
                            } catch {
                              toast.show('공유 URL 복사에 실패했습니다')
                            }
                          }}
                        >
                          URL 복사
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => revokeShare(item.shareId)}
                          disabled={isRevoked || isExpired || revokingShareId === item.shareId || deletingShareId === item.shareId}
                        >
                          {isRevoked ? '철회됨' : isExpired ? '만료됨' : revokingShareId === item.shareId ? '철회 중...' : '철회'}
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => deleteShare(item.shareId)}
                          disabled={revokingShareId === item.shareId || deletingShareId === item.shareId}
                        >
                          {deletingShareId === item.shareId ? '삭제 중...' : '삭제'}
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="portfolio-capture-metrics">
            <div className="portfolio-capture-metric">
              <div className="portfolio-capture-label">총 매수원금</div>
              <div className="portfolio-capture-value">{formatKrw(totalInvested)}</div>
            </div>
            <div className="portfolio-capture-metric">
              <div className="portfolio-capture-label">평가손익</div>
              <div className={`portfolio-capture-value ${totalUnrealized < 0 ? 'negative' : 'positive'}`}>
                {formatSignedKrw(totalUnrealized)}
              </div>
            </div>
            <div className="portfolio-capture-metric">
              <div className="portfolio-capture-label">현재 수익률</div>
              <div className={`portfolio-capture-value ${totalReturnPct < 0 ? 'negative' : 'positive'}`}>
                {`${totalReturnPct > 0 ? '+' : ''}${formatNumber(totalReturnPct, 2)}%`}
              </div>
            </div>
          </div>

          <div className="portfolio-capture-table-wrap">
            <table className="portfolio-capture-table">
              <thead>
                <tr>
                  <th>종목명</th>
                  <th>종목코드</th>
                  <th>보유수량</th>
                  <th>매수가</th>
                  <th>매수일</th>
                  <th>손익</th>
                  <th>수익률</th>
                </tr>
              </thead>
              <tbody>
                {holdingAll.map((r: any) => {
                  const pnl = Number(r.unrealized_pnl || 0)
                  const pct = Number(r.unrealized_pct || 0)
                  return (
                    <tr key={`capture-${r.id}`}>
                      <td>{r.stock_name ?? r.ticker ?? r.symbol ?? '-'}</td>
                      <td>{r.code || '-'}</td>
                      <td>{`${formatNumber(Number(r.quantity || 0), 0)}주`}</td>
                      <td>{formatKrw(Number(r.avg_price || 0))}</td>
                      <td>{r.buy_date || '-'}</td>
                      <td className={pnl < 0 ? 'negative' : pnl > 0 ? 'positive' : ''}>{formatSignedKrw(pnl)}</td>
                      <td className={pct < 0 ? 'negative' : pct > 0 ? 'positive' : ''}>{`${pct > 0 ? '+' : ''}${formatNumber(pct, 2)}%`}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={maintModalOpen}
        title={
          maintMode === 'liquidateall' ? '전체매도' :
          maintMode === 'holdingrestore' ? (maintStep === 1 ? '1단계 · 계좌 설정' : '2단계 · 종목 추가') :
          '보유 종목 수정'
        }
        onClose={() => setMaintModalOpen(false)}
        size="sm"
      >
        {maintMode === 'liquidateall' && (
          <div className="muted" style={{ marginBottom: 'var(--space-3)' }}>
            현재 보유 종목을 기준가로 일괄 매도 처리합니다. 실행 후 보유수량이 0으로 전환됩니다.
          </div>
        )}

        {maintMode === 'holdingedit' && (
          <>
            <div className="muted" style={{ marginBottom: 'var(--space-3)' }}>
              <strong>{maintRow?.stock_name || maintCode || '종목'}</strong>의 매수가/수량/계좌를 수정합니다.
            </div>
            <div className="ui-field" style={{ marginBottom: 'var(--space-3)' }}>
              <label className="ui-label">종목코드</label>
              <StockSearchInput
                value={maintCode}
                onChange={(v) => setMaintCode(v.toUpperCase())}
                onSelect={(s) => setMaintCode(s.code)}
                placeholder="예) 005930 또는 종목명"
              />
            </div>
            <div style={{ marginBottom: 'var(--space-3)' }}>
              <Input 
                label="보유 수량" 
                type="number" 
                value={String(maintQty)} 
                onChange={(e: any) => setMaintQty(Math.max(1, Number(e?.target?.value || 1)))}
                onMouseDown={(e) => e.stopPropagation()}
              />
            </div>
            <div style={{ marginBottom: 'var(--space-3)' }}>
              <Input
                label="최초 매수일"
                type="date"
                value={maintBuyDate}
                onChange={(e: any) => setMaintBuyDate(String(e?.target?.value || getTodayLocalYmd()))}
                onMouseDown={(e) => e.stopPropagation()}
              />
            </div>
            <div style={{ marginBottom: 'var(--space-3)' }}>
              <Input
                label="평균 매수가 (원)"
                type="number"
                value={maintBuyPrice === '' ? '' : String(maintBuyPrice)}
                onChange={(e: any) => setMaintBuyPrice(e?.target?.value === '' ? '' : Number(e?.target?.value))}
                onMouseDown={(e) => e.stopPropagation()}
              />
            </div>
            <div className="grid-two" style={{ marginBottom: 'var(--space-3)' }}>
              <Input 
                label="증권사" 
                placeholder="예) NH, 토스, 삼성" 
                value={maintBrokerName} 
                onChange={(e: any) => setMaintBrokerName(String(e?.target?.value || ''))}
                onMouseDown={(e) => e.stopPropagation()}
              />
              <Input 
                label="계좌명" 
                placeholder="예) ISA, 연금, 일반" 
                value={maintAccountName} 
                onChange={(e: any) => setMaintAccountName(String(e?.target?.value || ''))}
                onMouseDown={(e) => e.stopPropagation()}
              />
            </div>
          </>
        )}

        {maintMode === 'holdingrestore' && maintStep === 1 && (
          <>
            <div className="muted" style={{ marginBottom: 'var(--space-3)' }}>
              매매 계좌 정보를 입력합니다. 증권사와 계좌명이 계좌 폴더의 기준이 됩니다.
            </div>

            {accountFolders.length > 0 && maintAccountMode === 'select' && (
              <>
                <div className="ui-field" style={{ marginBottom: 'var(--space-3)' }}>
                  <label className="ui-label">기존 계좌 선택</label>
                  <select
                    className="input"
                    value={[maintBrokerName, maintAccountName].filter(Boolean).join('||')}
                    onChange={(e) => {
                      const val = e.target.value
                      if (val === '__new__') {
                        setMaintBrokerName('')
                        setMaintAccountName('')
                        setMaintAccountMode('manual')
                      } else {
                        const [broker, account] = val.split('||')
                        setMaintBrokerName(broker ?? '')
                        setMaintAccountName(account ?? '')
                      }
                    }}
                  >
                    <option value="">계좌를 선택하세요</option>
                    {accountFolders.map((f) => {
                      const val = [f.brokerName, f.accountName].filter(Boolean).join('||')
                      return (
                        <option key={f.key} value={val}>
                          {accountLabel(f.brokerName, f.accountName)} ({f.count}종목)
                        </option>
                      )
                    })}
                    <option value="__new__">➕ 새로 입력하기</option>
                  </select>
                </div>
              </>
            )}

            {(accountFolders.length === 0 || maintAccountMode === 'manual') && (
              <>
                {accountFolders.length > 0 && (
                  <button
                    type="button"
                    className="caption"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', marginBottom: 'var(--space-2)', padding: 0 }}
                    onClick={() => {
                      setMaintBrokerName('')
                      setMaintAccountName('')
                      setMaintAccountMode('select')
                    }}
                  >
                    ← 기존 계좌에서 선택
                  </button>
                )}
                <div className="grid-two" style={{ marginBottom: 'var(--space-3)' }}>
                  <Input
                    label="증권사"
                    placeholder="예) 토스, NH, 삼성"
                    value={maintBrokerName}
                    onChange={(e: any) => setMaintBrokerName(String(e?.target?.value || ''))}
                    onMouseDown={(e) => e.stopPropagation()}
                  />
                  <Input
                    label="계좌명"
                    placeholder="예) ISA, 연금, 일반"
                    value={maintAccountName}
                    onChange={(e: any) => setMaintAccountName(String(e?.target?.value || ''))}
                    onMouseDown={(e) => e.stopPropagation()}
                  />
                </div>
                <div className="caption muted" style={{ marginBottom: 'var(--space-3)' }}>
                  예) 증권사: 토스증권 / 계좌명: ISA → 화면에 <strong>토스증권 / ISA</strong> 폴더로 표시됩니다.
                </div>
              </>
            )}

            {maintError && (
              <div className="state-error" style={{ marginBottom: 'var(--space-3)' }}>
                <div className="state-error-title">{maintError}</div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <Button
                variant="primary"
                onClick={() => {
                  if (!String(maintBrokerName || '').trim() && !String(maintAccountName || '').trim()) {
                    setMaintError('증권사 또는 계좌명을 입력해 주세요')
                    return
                  }
                  setMaintError(null)
                  setMaintStep(2)
                }}
              >
                다음 → 종목 추가
              </Button>
              <Button variant="ghost" onClick={() => setMaintModalOpen(false)}>취소</Button>
            </div>
          </>
        )}

        {maintMode === 'holdingrestore' && maintStep === 2 && (
          <>
            <div className="muted" style={{ marginBottom: 'var(--space-3)' }}>
              계좌: <strong>{[maintBrokerName, maintAccountName].filter(Boolean).join(' / ') || '미지정'}</strong>
              <br />추가할 종목의 매수 정보를 입력합니다.
            </div>
            <div className="ui-field" style={{ marginBottom: 'var(--space-3)' }}>
              <label className="ui-label">종목코드</label>
              <StockSearchInput
                value={maintCode}
                onChange={(v) => setMaintCode(v.toUpperCase())}
                onSelect={(s) => setMaintCode(s.code)}
                placeholder="예) 005930 또는 종목명"
              />
            </div>
            <div style={{ marginBottom: 'var(--space-3)' }}>
              <Input
                label="보유 수량"
                type="number"
                value={String(maintQty)}
                onChange={(e: any) => setMaintQty(Math.max(1, Number(e?.target?.value || 1)))}
              />
            </div>
            <Input
              label="평균 매수가 (원)"
              type="number"
              placeholder="예) 75000"
              value={maintBuyPrice === '' ? '' : String(maintBuyPrice)}
              onChange={(e: any) => setMaintBuyPrice(e?.target?.value === '' ? '' : Number(e?.target?.value))}
            />
            <div style={{ marginTop: 'var(--space-3)' }}>
              <Input
                label="최초 매수일"
                type="date"
                value={maintBuyDate}
                onChange={(e: any) => setMaintBuyDate(String(e?.target?.value || getTodayLocalYmd()))}
              />
            </div>
            <div className="caption muted" style={{ marginTop: 'var(--space-2)', marginBottom: 'var(--space-1)' }}>
              저장 후 가상매도 시 수익/손실이 자동 기록됩니다.
            </div>
            {maintError && (
              <div className="state-error" style={{ marginTop: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                <div className="state-error-title">{maintError}</div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
              <Button variant="primary" onClick={runMaintenance} disabled={maintLoading}>
                {maintLoading ? '저장 중…' : '종목 저장'}
              </Button>
              <Button variant="secondary" onClick={() => { setMaintError(null); setMaintStep(1) }}>← 계좌 수정</Button>
              <Button variant="ghost" onClick={() => setMaintModalOpen(false)}>취소</Button>
            </div>
          </>
        )}

        {maintMode === 'liquidateall' && (
          <>
            {maintError && (
              <div className="state-error" style={{ marginTop: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
                <div className="state-error-title">{maintError}</div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
              <Button variant="primary" onClick={runMaintenance} disabled={maintLoading}>
                {maintLoading ? '처리 중…' : '전체매도 실행'}
              </Button>
              <Button variant="ghost" onClick={() => setMaintModalOpen(false)}>취소</Button>
            </div>
          </>
        )}

        {maintMode === 'holdingedit' && (
          <>
            {maintError && (
              <div className="state-error" style={{ marginTop: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
                <div className="state-error-title">{maintError}</div>
              </div>
            )}
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
              <Button variant="primary" onClick={runMaintenance} disabled={maintLoading}>
                {maintLoading ? '저장 중…' : '수정 저장'}
              </Button>
              <Button variant="ghost" onClick={() => setMaintModalOpen(false)}>취소</Button>
            </div>
          </>
        )}
      </Modal>

      <Modal
        isOpen={deleteConfirmOpen}
        title="종목 완전 삭제"
        onClose={() => setDeleteConfirmOpen(false)}
        size="sm"
      >
        <div className="muted" style={{ marginBottom: 'var(--space-3)' }}>
          <strong style={{ color: 'var(--color-error)' }}>{deleteConfirmCode || '종목'}</strong>을(를) 포트폴리오에서 완전히 삭제합니다.
        </div>
        <div className="muted" style={{ marginBottom: 'var(--space-4)', fontSize: 'var(--font-size-sm)', opacity: 0.8 }}>
          • 보유 수량 및 평가손익이 제거됩니다<br />
          • 모든 거래 기록이 삭제됩니다 (복구 불가)<br />
          • 스냅샷도 함께 제거됩니다
        </div>

        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <Button variant="primary" onClick={() => { setMaintMode('holdingdelete'); setMaintCode(deleteConfirmCode); runMaintenance() }} disabled={maintLoading} style={{ background: 'var(--color-error)' }}>
            {maintLoading ? '삭제 중…' : '삭제 확인'}
          </Button>
          <Button variant="ghost" onClick={() => setDeleteConfirmOpen(false)}>취소</Button>
        </div>
      </Modal>
    </section>
  )
}
