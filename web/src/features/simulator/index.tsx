import React, { useEffect, useMemo, useRef, useState } from 'react'
import { LucideIcon } from '../../components/LucideIcon'
import { useCurrentChatId } from '../../stores/profileStore'
import { EmptyState } from '../../components/StateViews'
import { formatKrw, formatNumber } from '../../lib/format'
import { apiFetch } from '../../lib/api'
import { useToast } from '../../components/ToastProvider'
import { searchStocks } from '../../lib/stockCache'
import StockDetailModal from '../../components/StockDetailModal'
import {
  defaultPlanItem,
  readSimulationPlan,
  saveSimulationPlan,
  type HighlightPlanItem,
} from './planStore'
import {
  buildTelegramMessage,
  calcExpectedValue,
  calcKelly,
  calcMaxPortfolioLoss,
  calcPositionStatus,
  calcRR,
  calcScenarioNet,
  calcSplitInvested,
  calcWeeklyCyclePlan,
  clampPercent,
  getTradeGrade,
  POSITION_STATUS_LABEL,
  recommendPortfolio,
  calcRequiredAnnualReturn,
  calcAllocationWeight,
  type RecommendationStyle,
  type PositionStatus,
  type TelegramFormat,
  type TradeGrade,
} from './telegramFormat'

const SCENARIOS = [-8, -5, -3, 3, 5, 8]

function GradeChip({ grade }: { grade: TradeGrade }) {
  const cls =
    grade === 'A' ? 'sim-grade-a'
    : grade === 'B' ? 'sim-grade-b'
    : grade === 'C' ? 'sim-grade-c'
    : 'sim-grade-d'
  return <span className={`sim-grade-chip ${cls}`}>{grade}</span>
}

function PositionStatusBadge({ status, changePct }: { status: PositionStatus; changePct: number | null }) {
  const cls =
    status === 'take_profit' ? 'sim-status-badge--profit'
    : status === 'near_profit' ? 'sim-status-badge--near-profit'
    : status === 'stop_loss' ? 'sim-status-badge--stop'
    : status === 'near_stop' ? 'sim-status-badge--near-stop'
    : 'sim-status-badge--hold'
  const label = POSITION_STATUS_LABEL[status]
  return (
    <span className={`sim-status-badge ${cls}`} title={changePct != null ? `${changePct >= 0 ? '+' : ''}${formatNumber(changePct, 2)}%` : ''}>
      {label}
      {changePct != null && (
        <span className="sim-status-badge-pct">{changePct >= 0 ? '+' : ''}{formatNumber(changePct, 1)}%</span>
      )}
    </span>
  )
}

function RRBar({ rr }: { rr: number }) {
  const pct = Math.min(100, (rr / 4) * 100)
  const color = rr >= 2.5 ? 'var(--color-success)' : rr >= 2.0 ? 'var(--color-brand)' : rr >= 1.5 ? 'var(--color-warning)' : 'var(--color-error)'
  return (
    <div className="sim-rr-bar-wrap" title={`R:R = ${formatNumber(rr, 2)}`}>
      <div className="sim-rr-bar-track">
        <div className="sim-rr-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="sim-rr-label" style={{ color }}>{formatNumber(rr, 1)}:1</span>
    </div>
  )
}

function NumInput({
  label, value, onChange, min, max, step, suffix,
}: {
  label: string
  value: number | string
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
}) {
  return (
    <div className="sim-input-group">
      <label className="sim-input-label">{label}</label>
      <div className="sim-input-row">
        <input
          className="sim-input"
          type="number"
          min={min}
          max={max}
          step={step ?? 1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value || 0))}
        />
        {suffix && <span className="sim-input-suffix">{suffix}</span>}
      </div>
    </div>
  )
}

function ComparePanel({
  algoPortfolio,
  watchlistPortfolio,
  totalCapital,
  monthlyTarget,
  feePct,
  taxPct,
  onClose,
  onApplyAlgo,
  onApplyWatchlist,
}: {
  algoPortfolio: HighlightPlanItem[]
  watchlistPortfolio: HighlightPlanItem[]
  totalCapital: number
  monthlyTarget: number
  feePct: number
  taxPct: number
  onClose: () => void
  onApplyAlgo: () => void
  onApplyWatchlist: () => void
}) {
  const CYCLES = 4

  function colSummary(portfolio: HighlightPlanItem[]) {
    const tradeable = portfolio.filter(i => i.code !== 'CASH')
    const totalEV = tradeable.reduce((acc, i) => acc + calcExpectedValue(i), 0)
    const plan = calcWeeklyCyclePlan(tradeable, monthlyTarget, feePct, taxPct)
    const maxProfit = plan.cycleMaxProfit
    const cycleEV = plan.cycleEV
    const monthlyEV = cycleEV * CYCLES
    const weeksNeeded = cycleEV > 0 ? Math.ceil(monthlyTarget / cycleEV) : Infinity
    return { totalEV, maxProfit, cycleEV, monthlyEV, weeksNeeded }
  }

  const algoSummary = colSummary(algoPortfolio)
  const watchSummary = colSummary(watchlistPortfolio)

  // 어느 쪽이 더 유리한지 표시용
  const algoWins = algoSummary.monthlyEV >= watchSummary.monthlyEV

  function PortfolioCol({
    label,
    portfolio,
    summary,
    onApply,
    highlight,
  }: {
    label: string
    portfolio: HighlightPlanItem[]
    summary: ReturnType<typeof colSummary>
    onApply: () => void
    highlight: boolean
  }) {
    const tradeable = portfolio.filter(i => i.code !== 'CASH')
    return (
      <div className={`sim-compare-col${highlight ? ' sim-compare-col--winner' : ''}`}>
        <div className="sim-compare-col-head">
          <span className="sim-compare-col-title">{label}</span>
          {highlight && <span className="sim-compare-winner-badge">더 유리</span>}
          <span className="sim-compare-col-count">{tradeable.length}개 종목</span>
        </div>

        {tradeable.length === 0 ? (
          <div className="sim-compare-empty">추천 종목 없음 (품질 기준 미충족)</div>
        ) : (
          <div className="sim-compare-stock-list">
            {tradeable.map((item, idx) => {
              const ev = calcExpectedValue(item)
              const rr = calcRR(item)
              return (
                <div key={`${item.code}-${idx}`} className="sim-compare-stock-row">
                  <div className="sim-compare-stock-info">
                    <span className="sim-compare-stock-name">{item.name}</span>
                    <span className="sim-compare-stock-code">{item.code}</span>
                  </div>
                  <div className="sim-compare-stock-metrics">
                    <span className="sim-compare-metric">{formatKrw(item.amount)}</span>
                    <span className="sim-compare-metric sim-compare-metric--rr">R:R {formatNumber(rr, 1)}:1</span>
                    <span className={`sim-compare-metric ${ev >= 0 ? 'sim-pos' : 'sim-neg'}`}>
                      {ev >= 0 ? '+' : ''}{formatKrw(ev)}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div className="sim-compare-summary">
          <div className="sim-compare-summary-row">
            <span className="sim-compare-summary-label">1사이클 기대수익</span>
            <span className={`sim-compare-summary-value ${summary.cycleEV >= 0 ? 'sim-pos' : 'sim-neg'}`}>
              {summary.cycleEV >= 0 ? '+' : ''}{formatKrw(summary.cycleEV)}
            </span>
          </div>
          <div className="sim-compare-summary-row">
            <span className="sim-compare-summary-label">전량 목표 달성 시</span>
            <span className="sim-compare-summary-value sim-pos">+{formatKrw(summary.maxProfit)}</span>
          </div>
          <div className="sim-compare-summary-row sim-compare-summary-row--highlight">
            <span className="sim-compare-summary-label">월 기대수익 (×4)</span>
            <span className={`sim-compare-summary-value ${summary.monthlyEV >= 0 ? 'sim-pos' : 'sim-neg'}`}>
              {summary.monthlyEV >= 0 ? '+' : ''}{formatKrw(summary.monthlyEV)}
            </span>
          </div>
          <div className="sim-compare-summary-row">
            <span className="sim-compare-summary-label">목표 달성 예상</span>
            <span className="sim-compare-summary-value">
              {summary.weeksNeeded < 1000
                ? `${summary.weeksNeeded}주 ≈ ${formatNumber(summary.weeksNeeded / 4, 1)}개월`
                : '달성 어려움'}
            </span>
          </div>
        </div>

        <button
          className={`sim-btn ${highlight ? 'sim-btn--primary' : 'sim-btn--ghost'} sim-compare-apply-btn`}
          onClick={onApply}
          disabled={tradeable.length === 0}
        >
          {label}으로 적용
        </button>
      </div>
    )
  }

  return (
    <div className="sim-compare-panel">
      <div className="sim-compare-header">
        <h3 className="sim-compare-title">📊 포트폴리오 비교</h3>
        <button className="sim-btn sim-btn--ghost" onClick={onClose}>닫기</button>
      </div>
      <p className="sim-compare-desc">
        동일 투자금 {formatKrw(totalCapital)} 기준 · 월 목표 {formatKrw(monthlyTarget)} · 주 1사이클 기준
      </p>
      <div className="sim-compare-grid">
        <PortfolioCol
          label="알고리즘 추천"
          portfolio={algoPortfolio}
          summary={algoSummary}
          onApply={onApplyAlgo}
          highlight={algoWins}
        />
        <PortfolioCol
          label="관심종목 추천"
          portfolio={watchlistPortfolio}
          summary={watchSummary}
          onApply={onApplyWatchlist}
          highlight={!algoWins}
        />
      </div>
    </div>
  )
}

export default function SimulatorPage() {
  const chatId = useCurrentChatId()
  const initialPlan = useMemo(() => readSimulationPlan(), [])
  const [totalCapital, setTotalCapital] = useState(initialPlan?.totalCapital ?? 10_000_000)
  const [items, setItems] = useState<HighlightPlanItem[]>([]) // 항상 빈 배열로 시작
  const [monthlyProfitTarget, setMonthlyProfitTarget] = useState(500_000) // 월 500만원 기본값
  const [fillRatePct, setFillRatePct] = useState(100)
  const [feePct, setFeePct] = useState(0.15)
  const [taxPct, setTaxPct] = useState(0.2)
  const [memo, setMemo] = useState(initialPlan?.notes || '')
  const [syncing, setSyncing] = useState(false)
  const [lastServerSavedAt, setLastServerSavedAt] = useState<string>('')
  const [telegramFormat, setTelegramFormat] = useState<TelegramFormat>('detailed')
  const [history, setHistory] = useState<Array<{ updatedAt: string; plan: any }>>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [expandedIdx, setExpandedIdx] = useState<number | null>(0)
  const [addSearch, setAddSearch] = useState('')
  const [addResults, setAddResults] = useState<any[]>([])
  const [addFocused, setAddFocused] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [recommendedPortfolio, setRecommendedPortfolio] = useState<HighlightPlanItem[]>([])
  const [showRecommendation, setShowRecommendation] = useState(false)
  const [watchlistCandidates, setWatchlistCandidates] = useState<HighlightPlanItem[]>([])
  const [algoCandidates, setAlgoCandidates] = useState<HighlightPlanItem[]>([])
  const [loadingAlgo, setLoadingAlgo] = useState(false)
  const [loadingWatchlist, setLoadingWatchlist] = useState(false)
  const loadingCandidates = loadingAlgo || loadingWatchlist
  // 'algo' = 알고리즘 추천 | 'watchlist' = 관심종목 | 'items' = 현재 종목
  const [recommendSource, setRecommendSource] = useState<'algo' | 'watchlist' | 'items'>('algo')
  const [recommendStyle, setRecommendStyle] = useState<RecommendationStyle>('stable')
  const [compareResult, setCompareResult] = useState<{ algo: HighlightPlanItem[]; watchlist: HighlightPlanItem[] } | null>(null)
  const [showCompare, setShowCompare] = useState(false)
  const [showStockDetail, setShowStockDetail] = useState(false)
  const [selectedStockCode, setSelectedStockCode] = useState<string>('')
  const [selectedStockName, setSelectedStockName] = useState<string>('')
  const addDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const toast = useToast()

  // 주식 검색 디바운스
  useEffect(() => {
    if (addDebounceRef.current) clearTimeout(addDebounceRef.current)
    const q = addSearch.trim()
    if (q.length < 2) { setAddResults([]); return }
    addDebounceRef.current = setTimeout(async () => {
      try {
        const results = await searchStocks(q, 8)
        setAddResults(results)
      } catch {
        setAddResults([])
      }
    }, 100)
  }, [addSearch])

  const summary = useMemo(() => {
    const allocated = items.reduce((acc, row) => acc + Number(row.amount || 0), 0)
    const splitInvested = items.reduce((acc, row) => acc + calcSplitInvested(row, fillRatePct), 0)
    const ev = items.reduce((acc, row) => acc + calcExpectedValue(row), 0)
    const feeTax = splitInvested * ((feePct + taxPct) / 100)
    const maxLoss = calcMaxPortfolioLoss(items)
    return {
      allocated,
      splitInvested,
      ev,
      evAfterCost: ev - feeTax,
      feeTax,
      remaining: totalCapital - allocated,
      maxLoss,
    }
  }, [items, fillRatePct, feePct, taxPct, totalCapital])

  const scenarioRows = useMemo(() =>
    SCENARIOS.map((pct) => ({
      pct,
      net: calcScenarioNet(items, pct, fillRatePct, feePct, taxPct),
    })),
  [items, fillRatePct, feePct, taxPct])

  const itemMeta = useMemo(() =>
    items.map((item) => ({
      rr: calcRR(item),
      kelly: calcKelly(item),
      grade: getTradeGrade(item),
      ev: calcExpectedValue(item),
      splitInvested: calcSplitInvested(item, fillRatePct),
    })),
  [items, fillRatePct])

  const statusMeta = useMemo(() =>
    items.map((item) => calcPositionStatus(item)),
  [items])

  const weeklyPlan = useMemo(() =>
    calcWeeklyCyclePlan(items, monthlyProfitTarget, feePct, taxPct),
  [items, monthlyProfitTarget, feePct, taxPct])

  const updateItem = (idx: number, patch: Partial<HighlightPlanItem>) =>
    setItems((prev) => prev.map((row, i) => i === idx ? { ...row, ...patch } : row))

  const addRow = (stock?: { code: string; name: string }) => {
    const newItem = defaultPlanItem(stock ?? { code: '', name: '' })
    setItems((prev) => [...prev, newItem])
    setExpandedIdx(items.length)
    setAddSearch('')
    setAddResults([])
  }

  const removeRow = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx))
    if (expandedIdx === idx) setExpandedIdx(null)
    else if (expandedIdx !== null && expandedIdx > idx) setExpandedIdx(expandedIdx - 1)
  }

  const countTradeable = (rows: HighlightPlanItem[]) => rows.filter(r => r.code !== 'CASH').length

  const getCandidatesBySource = (source: 'algo' | 'watchlist' | 'items'): HighlightPlanItem[] => {
    if (source === 'algo') return algoCandidates
    if (source === 'watchlist') return watchlistCandidates
    return items.filter(i => i.code !== 'CASH')
  }

  const recommendWithStyleFallback = (
    baseCandidates: HighlightPlanItem[],
    preferredStyle: RecommendationStyle,
    allowFallback: boolean,
  ): { rows: HighlightPlanItem[]; styleUsed: RecommendationStyle } => {
    const styleOrder: RecommendationStyle[] = !allowFallback
      ? [preferredStyle]
      : preferredStyle === 'stable'
        ? ['stable', 'balanced', 'aggressive']
        : preferredStyle === 'balanced'
          ? ['balanced', 'aggressive']
          : ['aggressive']

    for (const style of styleOrder) {
      const rows = recommendPortfolio(baseCandidates, totalCapital, monthlyProfitTarget, {
        style,
      })
      if (countTradeable(rows) > 0) {
        return { rows, styleUsed: style }
      }
    }

    const fallbackStyle = styleOrder[styleOrder.length - 1]
    return {
      rows: recommendPortfolio(baseCandidates, totalCapital, monthlyProfitTarget, {
        style: fallbackStyle,
      }),
      styleUsed: fallbackStyle,
    }
  }

  const generateRecommendation = () => {
    if (monthlyProfitTarget <= 0) {
      toast.show('월 목표 수익을 입력하세요.')
      return
    }

    const candidates = getCandidatesBySource(recommendSource)
    if (candidates.length === 0) {
      const srcLabel = recommendSource === 'algo' ? '알고리즘 후보' : recommendSource === 'watchlist' ? '관심종목' : '현재 종목'
      toast.show(`${srcLabel}이 없습니다. 다른 소스를 선택하거나 종목을 추가하세요.`)
      return
    }
    const allowFallback = recommendSource === 'watchlist'
    const { rows: recommended, styleUsed } = recommendWithStyleFallback(candidates, recommendStyle, allowFallback)

    if (countTradeable(recommended) === 0) {
      toast.show('추천 가능한 종목이 없습니다. (품질 기준 미충족)')
      return
    }

    if (allowFallback && styleUsed !== recommendStyle) {
      const label = styleUsed === 'balanced' ? '균형' : '공격'
      toast.show(`관심종목은 ${recommendStyle === 'stable' ? '안정' : '선택'} 기준 미충족으로 ${label} 기준을 적용했습니다.`)
    }

    setRecommendedPortfolio(recommended)
    setShowRecommendation(true)
  }

  const applyRecommendation = () => {
    if (recommendedPortfolio.length === 0) return
    setItems(recommendedPortfolio)
    setShowRecommendation(false)
    setRecommendedPortfolio([])
    toast.show('추천 포트폴리오를 적용했습니다.')
  }

  const generateCompare = () => {
    if (monthlyProfitTarget <= 0) {
      toast.show('월 목표 수익을 입력하세요.')
      return
    }
    const algoRec = algoCandidates.length > 0
      ? recommendWithStyleFallback(algoCandidates, recommendStyle, false).rows
      : []
    const watchlistRec = chatId && watchlistCandidates.length > 0
      ? recommendWithStyleFallback(watchlistCandidates, recommendStyle, true).rows
      : []
    if (countTradeable(algoRec) === 0 && countTradeable(watchlistRec) === 0) {
      toast.show('두 소스 모두 추천 가능한 종목이 없습니다.')
      return
    }
    setCompareResult({ algo: algoRec, watchlist: watchlistRec })
    setShowCompare(true)
  }

  // 추천 패널이 열려있는 상태에서 월 목표/성향/소스가 바뀌면 즉시 재계산
  useEffect(() => {
    if (!showRecommendation) return
    if (monthlyProfitTarget <= 0) return

    const candidates = getCandidatesBySource(recommendSource)
    if (candidates.length === 0) {
      setRecommendedPortfolio([])
      return
    }
    const allowFallback = recommendSource === 'watchlist'
    const { rows } = recommendWithStyleFallback(candidates, recommendStyle, allowFallback)
    setRecommendedPortfolio(rows)
  }, [
    showRecommendation,
    monthlyProfitTarget,
    recommendSource,
    recommendStyle,
    totalCapital,
    algoCandidates,
    watchlistCandidates,
    items,
  ])

  // 비교 패널이 열려있는 상태에서도 입력 변경 시 즉시 재계산
  useEffect(() => {
    if (!showCompare || monthlyProfitTarget <= 0) return

    const algoRec = algoCandidates.length > 0
      ? recommendWithStyleFallback(algoCandidates, recommendStyle, false).rows
      : []
    const watchlistRec = chatId && watchlistCandidates.length > 0
      ? recommendWithStyleFallback(watchlistCandidates, recommendStyle, true).rows
      : []

    setCompareResult({ algo: algoRec, watchlist: watchlistRec })
  }, [
    showCompare,
    monthlyProfitTarget,
    recommendStyle,
    totalCapital,
    algoCandidates,
    watchlistCandidates,
    chatId,
  ])

  const loadWatchlistCandidates = async () => {
    if (!chatId) {
      setWatchlistCandidates([])
      return
    }
    setLoadingWatchlist(true)
    try {
      const res = await apiFetch(`/api/ui/positions?positionType=interest&pageSize=50&cacheMs=30000&chat_id=${encodeURIComponent(chatId)}`, { 
        cacheMs: 30000, 
        timeoutMs: 10_000 
      })
      const positions = res?.data ?? []
      // position을 HighlightPlanItem으로 변환
      const candidates: HighlightPlanItem[] = positions
        .map((pos: any) => {
          const code = String(pos.code || pos.symbol || pos.ticker || '').trim()
          const name = String(pos.stock_name || pos.name || code || '').trim()
          if (!code || !name) return null
          const currentPrice = Number(pos.current_price ?? pos.close ?? pos.stock?.close ?? 0) || 50000
          const closePrice = Number(pos.close ?? pos.stock?.close ?? 0) || currentPrice
          // 기본값으로 초기화 (나중에 사용자가 조정 가능)
          return {
            ...defaultPlanItem({ code, name, sector_id: pos.sector_id }),
            source: 'watchlist',
            signal_score: Number(pos.priority ?? 0) || 0,
            signal_rank: Number(pos.rank ?? 9999) || 9999,
            market: String(pos.market || pos.market_type || pos.exchange || pos.stock?.market || ''),
            current_price: currentPrice,
            close: closePrice,
          }
        })
        .filter((item: any) => item != null)
      setWatchlistCandidates(candidates)
    } catch (e: any) {
      console.warn('관심종목 로드 실패:', e?.message)
      setWatchlistCandidates([])
    } finally {
      setLoadingWatchlist(false)
    }
  }

  // 알고리즘 후보군 fetch (chatId 여부와 무관하게 항상 로드)
  const loadAlgoCandidates = async () => {
    setLoadingAlgo(true)
    try {
      console.log('[loadAlgoCandidates] 시작...')
      // scan-candidates fetch
      const ts = Date.now()
      const scanRes = await apiFetch(`/api/ui/scan-candidates?limit=80&cacheMs=0&_ts=${ts}`, { cacheMs: 0, timeoutMs: 20_000 })
      const scanList = Array.isArray(scanRes?.data) ? scanRes.data : []
      console.log('[loadAlgoCandidates] scan-candidates:', scanList.length, '개')
      if (scanList.length > 0) {
        console.log('[loadAlgoCandidates] API 원본 첫 종목:', {
          code: scanList[0].code,
          current_price: scanList[0].current_price,
          close: scanList[0].close,
          entry_grade: scanList[0].entry_grade,
        })
      }
      // scan-highlights fetch
      const hlRes = await apiFetch('/api/ui?route=scan-highlights', { cacheMs: 10000, timeoutMs: 15000 })
      const hlList = Array.isArray(hlRes?.data) ? hlRes.data : []
      console.log('[loadAlgoCandidates] scan-highlights:', hlList.length, '개')

      const asNum = (v: any, fallback = 0) => {
        const n = Number(v)
        return Number.isFinite(n) ? n : fallback
      }
      const getRank = (row: any) => {
        const rank = asNum(
          row?.signal_rank ?? row?.pullback_rank ?? row?.rank ?? row?.priority_rank,
          9999,
        )
        return rank > 0 ? rank : 9999
      }
      const getSignalScore = (row: any) => asNum(
        row?.signal_score ?? row?.adaptive_score ?? row?.confidence_pct ?? row?.score,
        0,
      )

      // 스캔 페이지 기본 정렬(priority_score desc)과 동일한 우선순위 정렬
      const sortedScanList = [...scanList].sort((a, b) => {
        const pa = Number.isFinite(Number(a?.adaptive_score))
          ? Number(a.adaptive_score)
          : (Number(a?.entry_score ?? 0) * 20 - Number(a?.warn_score ?? 0) * 3)
        const pb = Number.isFinite(Number(b?.adaptive_score))
          ? Number(b.adaptive_score)
          : (Number(b?.entry_score ?? 0) * 20 - Number(b?.warn_score ?? 0) * 3)
        if (pb !== pa) return pb - pa
        const rankDiff = getRank(a) - getRank(b)
        if (rankDiff !== 0) return rankDiff
        return getSignalScore(b) - getSignalScore(a)
      })
      const sortedHlList = [...hlList].sort((a, b) => {
        const rankDiff = getRank(a) - getRank(b)
        if (rankDiff !== 0) return rankDiff
        return getSignalScore(b) - getSignalScore(a)
      })
      
      // code 기준 중복 제거 & 품질 등급별 파라미터 설정
      const merged: Record<string, HighlightPlanItem> = {}
      
      // scan-candidates 처리 (entry_grade 기반) - A/B/C는 포함, D만 제외
      let scanCandidateCount = 0
      for (const row of sortedScanList) {
        const code = String(row.code || '').trim()
        const name = String(row.name || code || '').trim()
        if (!code || !name) continue
        
        // 품질 필터: entry_grade D는 제외 (A/B/C는 포함)
        const grade = String(row.entry_grade || '').toUpperCase()
        if (grade === 'D') continue
        
        // entry_grade에 따라 수익/손절 설정
        let targetPct = 5, stopPct = 3, winProb = 58
        if (grade === 'A') {
          targetPct = 8
          stopPct = 2.5
          winProb = 70
        } else if (grade === 'B') {
          targetPct = 5
          stopPct = 3
          winProb = 58
        } else {
          // C 등급
          targetPct = 3
          stopPct = 4
          winProb = 52
        }
        
        // adaptive_score를 활용한 winProb 미세조정 (30~70%)
        const baseScore = Number(row.adaptive_score ?? 50)
        if (baseScore > 0) {
          winProb = Math.max(30, Math.min(70, 50 + (baseScore / 100) * 20))
        }
        
        // 가격 정보 저장 (current_price 우선, 없으면 close, 둘 다 없으면 기본값 50,000원)
        const currentPrice = Number(row.current_price ?? row.close ?? 0) || 50000
        const closePrice = Number(row.close ?? 0) || 50000
        
        const item = defaultPlanItem({ code, name, sector_id: row.sector_id })
        merged[code] = {
          ...item,
          source: 'scan-candidates',
          signal_score: getSignalScore(row),
          signal_rank: getRank(row),
          market: String(row.market || row.market_type || row.exchange || ''),
          targetPct,
          stopPct,
          winProb: Math.round(winProb),
          current_price: currentPrice,
          close: closePrice,
        }
        scanCandidateCount++
        if (scanCandidateCount <= 3) {
          console.log(`[loadAlgoCandidates] scan-candidates[${scanCandidateCount}] ${code}: current_price=${row.current_price}, close=${row.close} → stored=${currentPrice}`)
        }
      }
      console.log('[loadAlgoCandidates] scan-candidates 필터 통과:', scanCandidateCount, '개')
      
      // scan-highlights 처리 (expected_upside_pct 기반)
      let hlCandidateCount = 0
      for (const row of sortedHlList) {
        const code = String(row.code || '').trim()
        const name = String(row.name || code || '').trim()
        if (!code || !name) continue
        
        // 하이라이트 데이터: upside/downside 직접 사용
        let targetPct = Number(row.expected_upside_pct ?? 8) || 8
        let stopPct = Math.abs(Number(row.expected_drawdown_pct ?? 2.5) || 2.5)
        let winProb = Math.max(30, Math.min(70, Number(row.confidence_pct ?? 58) || 58))
        
        // 하이라이트와 후보가 중복되면, 하이라이트 신호 정보를 우선 반영
        if (code in merged) {
          merged[code] = {
            ...merged[code],
            source: 'scan-highlights',
            signal_score: Math.max(Number(merged[code].signal_score || 0), getSignalScore(row)),
            signal_rank: Math.min(Number(merged[code].signal_rank || 9999), getRank(row)),
            market: String(row.market || row.market_type || row.exchange || merged[code].market || ''),
            current_price: Number(row.entry_price ?? merged[code].current_price ?? 0) || merged[code].current_price,
          }
          continue
        }
        
        // 가격 정보 저장 (entry_price 우선, 없으면 현황 가격)
        const entryPrice = Number(row.entry_price ?? 0)
        
        const item = defaultPlanItem({ code, name, sector_id: row.sector_id })
        merged[code] = {
          ...item,
          source: 'scan-highlights',
          signal_score: getSignalScore(row),
          signal_rank: getRank(row),
          market: String(row.market || row.market_type || row.exchange || ''),
          targetPct,
          stopPct,
          winProb: Math.round(winProb),
          current_price: entryPrice || undefined,
        }
        hlCandidateCount++
        if (hlCandidateCount <= 3) {
          console.log(`[loadAlgoCandidates] scan-highlights[${hlCandidateCount}] ${code}: entry_price=${row.entry_price} → stored=${entryPrice}`)
        }
      }
      console.log('[loadAlgoCandidates] scan-highlights 필터 통과:', hlCandidateCount, '개')
      
      const finalCandidates = Object.values(merged)
      console.log('[loadAlgoCandidates] 최종 후보:', finalCandidates.length, '개')
      if (finalCandidates.length > 0) {
        console.log('[loadAlgoCandidates] 첫 후보:', finalCandidates[0].code, finalCandidates[0].name)
      }
      setAlgoCandidates(finalCandidates)
    } catch (e: any) {
      console.warn('내부 추천 후보 로드 실패:', e?.message)
      setAlgoCandidates([])
    } finally {
      setLoadingAlgo(false)
    }
  }

  // 초기화 시 항상 알고리즘 후보 로드, chatId 있으면 관심종목도 함께 로드
  useEffect(() => {
    void loadAlgoCandidates()
    if (chatId) void loadWatchlistCandidates()
  }, [chatId])

  const buildPlan = () => ({
    createdAt: Date.now(),
    totalCapital: Math.max(0, totalCapital),
    notes: memo,
    items,
  })

  const applyPlan = (plan: any) => {
    if (!plan || !Array.isArray(plan.items)) return
    setTotalCapital(Math.max(0, Number(plan.totalCapital || 0)))
    setMemo(String(plan.notes || ''))
    setItems(plan.items)
    setExpandedIdx(null)
  }

  const saveLocal = () => {
    saveSimulationPlan(buildPlan())
    toast.show('로컬에 저장했습니다.')
  }

  const saveServer = async () => {
    if (!chatId) {
      toast.show('서버 저장은 텔레그램 연동 후 이용 가능합니다.')
      return
    }
    setSyncing(true)
    try {
      await apiFetch(`/api/ui/simulation-plan?chat_id=${encodeURIComponent(chatId)}`, {
        method: 'POST',
        body: JSON.stringify({ plan: buildPlan() }),
        cacheMs: 0, timeoutMs: 15_000,
      })
      setLastServerSavedAt(new Date().toISOString())
      toast.show('서버에 저장했습니다.')
    } catch (e: any) {
      toast.show(`저장 실패: ${e?.message || String(e)}`)
    } finally {
      setSyncing(false)
    }
  }

  const loadServer = async () => {
    if (!chatId) {
      toast.show('서버 불러오기는 텔레그램 연동 후 이용 가능합니다.')
      return
    }
    setSyncing(true)
    try {
      const res = await apiFetch(`/api/ui/simulation-plan?mode=latest&chat_id=${encodeURIComponent(chatId)}`, { cacheMs: 0, timeoutMs: 12_000 })
      const plan = res?.data?.plan
      if (!plan) { toast.show('저장된 계획이 없습니다.'); return }
      applyPlan(plan)
      saveSimulationPlan(plan)
      setLastServerSavedAt(String(res?.data?.updatedAt || ''))
      toast.show('서버 계획을 불러왔습니다.')
    } catch (e: any) {
      toast.show(`불러오기 실패: ${e?.message || String(e)}`)
    } finally {
      setSyncing(false)
    }
  }

  const sendTelegram = async () => {
    setSyncing(true)
    try {
      const message = buildTelegramMessage({
        totalCapital: Math.max(0, totalCapital),
        fillRatePct, feePct, taxPct,
        expectedAfterCost: summary.evAfterCost,
        remaining: summary.remaining,
        items,
        format: telegramFormat,
      })
      await apiFetch('/api/ui/notify', {
        method: 'POST',
        body: JSON.stringify({ message }),
        cacheMs: 0, timeoutMs: 12_000,
      })
      toast.show(`텔레그램 전송 완료`)
    } catch (e: any) {
      toast.show(`전송 실패: ${e?.message || String(e)}`)
    } finally {
      setSyncing(false)
    }
  }

  const loadHistory = async () => {
    if (!chatId) {
      toast.show('히스토리는 텔레그램 연동 후 이용 가능합니다.')
      return
    }
    setHistoryLoading(true)
    try {
      const res = await apiFetch(`/api/ui/simulation-plan?mode=history&limit=10&chat_id=${encodeURIComponent(chatId)}`, { cacheMs: 0, timeoutMs: 12_000 })
      setHistory(res?.data || [])
      setHistoryOpen(true)
    } catch (e: any) {
      toast.show(`히스토리 실패: ${e?.message || String(e)}`)
    } finally {
      setHistoryLoading(false)
    }
  }

  const loadFromHistory = (entry: { updatedAt: string; plan: any }) => {
    applyPlan(entry.plan)
    saveSimulationPlan(entry.plan)
    setLastServerSavedAt(entry.updatedAt)
    setHistoryOpen(false)
    toast.show(`${new Date(entry.updatedAt).toLocaleString('ko-KR')} 계획을 불러왔습니다.`)
  }

  useEffect(() => {
    if (initialPlan?.items?.length) return
    void loadServer()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const showAddDropdown = addFocused && addSearch.trim().length >= 2

  return (
    <div className="sim-page">
      {/* ── 헤더 ── */}
      <div className="sim-header">
        <div>
          <h1 className="sim-title">시뮬레이터</h1>
          <p className="sim-desc">분할진입 · 기대수익 · 리스크 분석으로 최적 집행 계획을 수립합니다.</p>
        </div>
        <button className="sim-settings-btn" onClick={() => setSettingsOpen((v) => !v)} aria-expanded={settingsOpen}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" stroke="currentColor" strokeWidth="1.8"/>
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" stroke="currentColor" strokeWidth="1.8"/>
          </svg>
          설정
        </button>
      </div>

      {/* ── 요약 카드 ── */}
      <div className="sim-summary-card">
        <div className="sim-summary-grid">
          <div className="sim-summary-item">
            <span className="sim-summary-label">총 투자금</span>
            <span className="sim-summary-value">{formatKrw(totalCapital)}</span>
          </div>
          <div className="sim-summary-item">
            <span className="sim-summary-label">배분 합계</span>
            <span className={`sim-summary-value${summary.remaining < 0 ? ' sim-neg' : ''}`}>{formatKrw(summary.allocated)}</span>
          </div>
          <div className="sim-summary-item">
            <span className="sim-summary-label">잔여 자금</span>
            <span className={`sim-summary-value${summary.remaining < 0 ? ' sim-neg' : ' sim-pos'}`}>
              {summary.remaining >= 0 ? '+' : ''}{formatKrw(summary.remaining)}
            </span>
          </div>
          <div className="sim-summary-divider" />
          <div className="sim-summary-item">
            <span className="sim-summary-label">기대손익 (월 목표 기준)</span>
            <span className={`sim-summary-value sim-summary-value--lg${summary.evAfterCost >= 0 ? ' sim-pos' : ' sim-neg'}`}>
              {summary.evAfterCost >= 0 ? '+' : ''}{formatKrw(summary.evAfterCost)}
            </span>
          </div>
          <div className="sim-summary-item">
            <span className="sim-summary-label">최대 손실 (월 목표 기준)</span>
            <span className="sim-summary-value sim-neg">{formatKrw(summary.maxLoss)}</span>
          </div>
          <div className="sim-summary-item">
            <span className="sim-summary-label">체결 반영 투자금</span>
            <span className="sim-summary-value">{formatKrw(summary.splitInvested)}</span>
          </div>
        </div>
        {summary.remaining < 0 && (
          <div className="sim-warning-bar">
            배분 합계가 총 투자금을 {formatKrw(-summary.remaining)} 초과합니다.
          </div>
        )}
      </div>

      {/* ── 월 수익 목표 & 추천 ── */}
      <div className="sim-section sim-monthly-target-section">
        <div className="sim-section-head">
          <span className="sim-section-label">월 수익 목표</span>
        </div>
        {/* 추천 소스 선택 */}
        <div className="sim-rec-source-group">
          <button
            className={`sim-rec-source-btn${recommendSource === 'algo' ? ' sim-rec-source-btn--active' : ''}`}
            onClick={() => setRecommendSource('algo')}
          >
            <span className="sim-rec-source-label">알고리즘 추천</span>
            <span className="sim-rec-source-count">
              {loadingAlgo ? '...' : `${algoCandidates.length}개`}
            </span>
          </button>
          {chatId && (
            <button
              className={`sim-rec-source-btn${recommendSource === 'watchlist' ? ' sim-rec-source-btn--active' : ''}`}
              onClick={() => setRecommendSource('watchlist')}
            >
              <span className="sim-rec-source-label">관심종목</span>
              <span className="sim-rec-source-count">
                {loadingWatchlist ? '...' : `${watchlistCandidates.length}개`}
              </span>
            </button>
          )}
          <button
            className={`sim-rec-source-btn${recommendSource === 'items' ? ' sim-rec-source-btn--active' : ''}`}
            onClick={() => setRecommendSource('items')}
          >
            <span className="sim-rec-source-label">현재 종목</span>
            <span className="sim-rec-source-count">{items.filter(i => i.code !== 'CASH').length}개</span>
          </button>
          <button
            className="sim-btn sim-btn--ghost sim-btn--sm sim-rec-refresh-btn"
            onClick={() => { void loadAlgoCandidates(); if (chatId) void loadWatchlistCandidates() }}
            disabled={loadingCandidates}
            title="후보 새로고침"
          >
            <LucideIcon name="RefreshCw" size={14} />
          </button>
        </div>

        <div className="sim-rec-profile-group" role="group" aria-label="추천 성향">
          <button
            className={`sim-rec-profile-btn${recommendStyle === 'stable' ? ' sim-rec-profile-btn--active' : ''}`}
            onClick={() => setRecommendStyle('stable')}
            disabled={!showRecommendation}
          >
            안정
          </button>
          <button
            className={`sim-rec-profile-btn${recommendStyle === 'balanced' ? ' sim-rec-profile-btn--active' : ''}`}
            onClick={() => setRecommendStyle('balanced')}
            disabled={!showRecommendation}
          >
            균형
          </button>
          <button
            className={`sim-rec-profile-btn${recommendStyle === 'aggressive' ? ' sim-rec-profile-btn--active' : ''}`}
            onClick={() => setRecommendStyle('aggressive')}
            disabled={!showRecommendation}
          >
            공격
          </button>
        </div>

        <div className="sim-cash-reserve-info">
          <span>💰 현금 보유 추천:</span>
          <span className="sim-cash-reserve-value">{formatKrw(totalCapital * 0.2)} (20%)</span>
        </div>

        <div className="sim-monthly-target-wrap">
          <div className="sim-input-group">
            <label className="sim-input-label">원하는 월 수익</label>
            <div className="sim-input-row">
              <input 
                className="sim-input" 
                type="number" 
                min={0} 
                value={monthlyProfitTarget}
                onChange={(e) => setMonthlyProfitTarget(Math.max(0, Number(e.target.value || 0)))} 
              />
              <span className="sim-input-suffix">원</span>
            </div>
          </div>
          <div className="sim-monthly-calc">
            <div className="sim-monthly-item">
              <span className="sim-monthly-label">필요 연간 수익률</span>
              <span className="sim-monthly-value">
                {formatNumber(calcRequiredAnnualReturn(monthlyProfitTarget, totalCapital), 2)}%
              </span>
            </div>
            <div className="sim-monthly-item">
              <span className="sim-monthly-label">연간 목표 수익</span>
              <span className="sim-monthly-value">
                {formatKrw(monthlyProfitTarget * 12)}
              </span>
            </div>
          </div>
          <button 
            className="sim-btn sim-btn--primary" 
            onClick={generateRecommendation}
            disabled={monthlyProfitTarget <= 0 || 
              (items.length === 0 && 
               ((chatId && watchlistCandidates.length === 0) ||
                (!chatId && algoCandidates.length === 0)))}
            title="Half-Kelly Criterion: 장기 자본 성장 극대화, 변동성 관리를 위한 최적 배분 비율"
          >
            최적 포트폴리오 추천 (Half-Kelly 기반)
          </button>
          {chatId && algoCandidates.length > 0 && watchlistCandidates.length > 0 && (
            <button
              className="sim-btn sim-btn--ghost"
              onClick={generateCompare}
              disabled={monthlyProfitTarget <= 0 || loadingCandidates}
              title="알고리즘 추천 vs 관심종목 추천 비교"
            >
              포트폴리오 비교
            </button>
          )}
        </div>

        {/* 비교 패널 */}
        {showCompare && compareResult && (
          <ComparePanel
            algoPortfolio={compareResult.algo}
            watchlistPortfolio={compareResult.watchlist}
            totalCapital={totalCapital}
            monthlyTarget={monthlyProfitTarget}
            feePct={feePct}
            taxPct={taxPct}
            onClose={() => setShowCompare(false)}
            onApplyAlgo={() => {
              setItems(compareResult.algo)
              setShowCompare(false)
              toast.show('알고리즘 추천 포트폴리오를 적용했습니다.')
            }}
            onApplyWatchlist={() => {
              setItems(compareResult.watchlist)
              setShowCompare(false)
              toast.show('관심종목 추천 포트폴리오를 적용했습니다.')
            }}
          />
        )}

        {/* 추천 결과 표시 */}
        {showRecommendation && recommendedPortfolio.length > 0 && (
          <div className="sim-recommendation-panel">
            <div className="sim-rec-header">
              <h3 className="sim-rec-title">🎯 추천 포트폴리오</h3>
              <button className="sim-btn sim-btn--ghost" onClick={() => setShowRecommendation(false)}>닫기</button>
            </div>
            <p className="sim-rec-desc">
              월 {formatKrw(monthlyProfitTarget)} 목표 달성을 위해 Kelly Criterion 기반으로 선정된 포트폴리오입니다.
              각 종목의 기대값과 위험도를 고려해 배분되었습니다.
            </p>
            <div className="sim-rec-list">
              {recommendedPortfolio.map((rec, idx) => {
                const weights = recommendedPortfolio.reduce((acc, r) => acc + calcAllocationWeight(r, recommendStyle), 0)
                const allocPct = weights > 0 ? (calcAllocationWeight(rec, recommendStyle) / weights) * 100 : 0
                const rr = calcRR(rec)
                const ev = calcExpectedValue(rec)
                return (
                  <div key={`${rec.code}-${idx}`} className="sim-rec-item">
                    <div className="sim-rec-item-name">
                      <span className="sim-rec-code">{rec.code}</span>
                      <span className="sim-rec-name">{rec.name}</span>
                      <button
                        className="sim-btn sim-btn--xs sim-btn--ghost"
                        onClick={() => {
                          setSelectedStockCode(rec.code)
                          setSelectedStockName(rec.name)
                          setShowStockDetail(true)
                        }}
                      >
                        시세
                      </button>
                    </div>
                    <div className="sim-rec-metrics">
                      <div className="sim-rec-metric">
                        <span className="sim-rec-label">배분액</span>
                        <span className="sim-rec-value">{formatKrw(rec.amount)}</span>
                      </div>
                      <div className="sim-rec-metric">
                        <span className="sim-rec-label">비중</span>
                        <span className="sim-rec-value">{formatNumber(allocPct, 1)}%</span>
                      </div>
                      <div className="sim-rec-metric">
                        <span className="sim-rec-label">R:R</span>
                        <span className="sim-rec-value">{formatNumber(rr, 1)}:1</span>
                      </div>
                      <div className="sim-rec-metric">
                        <span className={`sim-rec-value${ev >= 0 ? ' sim-pos' : ' sim-neg'}`}>
                          {ev >= 0 ? '+' : ''}{formatKrw(ev)}
                        </span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="sim-rec-footer">
              <button className="sim-btn sim-btn--ghost" onClick={() => setShowRecommendation(false)}>취소</button>
              <button className="sim-btn sim-btn--primary" onClick={applyRecommendation}>이 포트폴리오 적용</button>
            </div>
          </div>
        )}
      </div>

      {/* ── 설정 패널 (접기/펼치기) ── */}
      {settingsOpen && (
        <div className="sim-settings-panel">
          <div className="sim-settings-grid">
            <div className="sim-input-group">
              <label className="sim-input-label">총 투자금 (원)</label>
              <div className="sim-input-row">
                <input className="sim-input" type="number" min={0} value={totalCapital}
                  onChange={(e) => setTotalCapital(Math.max(0, Number(e.target.value || 0)))} />
              </div>
            </div>
            <NumInput label="체결률 (%)" value={fillRatePct} suffix="%"
              onChange={(v) => setFillRatePct(clampPercent(v, 0, 100))} min={0} max={100} />
            <NumInput label="수수료율 (%)" value={feePct} suffix="%" step={0.01}
              onChange={(v) => setFeePct(Math.max(0, v))} min={0} />
            <NumInput label="세금/기타 (%)" value={taxPct} suffix="%" step={0.01}
              onChange={(v) => setTaxPct(Math.max(0, v))} min={0} />
          </div>

          <div className="sim-input-group sim-input-group--full">
            <label className="sim-input-label">메모</label>
            <input className="sim-input" value={memo} onChange={(e) => setMemo(e.target.value)}
              placeholder="예: 장 초반 변동성 높음, 2차까지만 체결 예상" />
          </div>

          {lastServerSavedAt && (
            <p className="sim-saved-at">서버 저장: {new Date(lastServerSavedAt).toLocaleString('ko-KR')}</p>
          )}

          <div className="sim-settings-actions">
            <button className="sim-btn sim-btn--ghost" onClick={saveLocal} disabled={syncing}>로컬 저장</button>
            <button className="sim-btn sim-btn--ghost" onClick={loadServer} disabled={syncing}>서버 불러오기</button>
            <button className="sim-btn sim-btn--ghost" onClick={loadHistory} disabled={syncing || historyLoading}>
              히스토리
            </button>
            <button className="sim-btn sim-btn--primary" onClick={saveServer} disabled={syncing}>서버 저장</button>
            <div className="sim-telegram-wrap">
              <select className="sim-select" value={telegramFormat}
                onChange={(e) => setTelegramFormat(e.target.value as TelegramFormat)}>
                <option value="simple">간단</option>
                <option value="detailed">상세</option>
              </select>
              <button className="sim-btn sim-btn--ghost" onClick={sendTelegram} disabled={syncing}>텔레그램 전송</button>
            </div>
          </div>

          {/* 히스토리 */}
          {historyOpen && (
            <div className="sim-history">
              <div className="sim-history-head">
                <span className="sim-section-label">저장 히스토리</span>
                <button className="sim-btn sim-btn--ghost" onClick={() => setHistoryOpen(false)}>닫기</button>
              </div>
              {history.length === 0
                ? <p className="sim-empty-text">저장된 히스토리가 없습니다.</p>
                : history.map((entry, i) => {
                  const p = entry.plan
                  const cap = p?.totalCapital ? formatKrw(Number(p.totalCapital)) : '-'
                  const cnt = Array.isArray(p?.items) ? p.items.length : 0
                  return (
                    <button key={i} className="sim-history-row" onClick={() => loadFromHistory(entry)}>
                      <div>
                        <div className="sim-history-date">{new Date(entry.updatedAt).toLocaleString('ko-KR')}</div>
                        <div className="sim-history-meta">{cap} · {cnt}개 종목{p?.notes ? ` · ${String(p.notes).slice(0, 30)}` : ''}</div>
                      </div>
                      <span className="sim-history-load">불러오기 →</span>
                    </button>
                  )
                })
              }
            </div>
          )}
        </div>
      )}

      {/* ── 종목 목록 ── */}
      <div className="sim-section">
        <div className="sim-section-head">
          <div>
            <span className="sim-section-label">종목별 집행안</span>
            <span className="sim-section-count">{items.length}개</span>
          </div>
        </div>

        {/* 종목 검색 추가 */}
        <div className="sim-add-wrap">
          <div className="sim-add-input-row">
            <svg className="sim-add-icon" width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
              <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M8 5v6M5 8h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <input
              className="sim-add-input"
              placeholder="종목명 또는 코드로 검색 후 추가"
              value={addSearch}
              onChange={(e) => setAddSearch(e.target.value)}
              onFocus={() => setAddFocused(true)}
              onBlur={() => setTimeout(() => setAddFocused(false), 150)}
            />
            {addSearch && (
              <button className="sim-add-clear" onClick={() => { setAddSearch(''); setAddResults([]) }}>×</button>
            )}
            <button className="sim-btn sim-btn--ghost sim-btn--sm" onClick={() => addRow()}>빈 행 추가</button>
          </div>
          {showAddDropdown && (
            <div className="sim-add-dropdown">
              {addResults.length === 0
                ? <div className="sim-add-empty">검색 결과 없음</div>
                : addResults.slice(0, 6).map((s: any) => (
                  <button key={s.code} className="sim-add-result" onClick={() => addRow({ code: String(s.code), name: String(s.name ?? s.code) })}>
                    <span className="sim-add-result-name">{s.name ?? s.code}</span>
                    <span className="sim-add-result-code">{s.code}</span>
                    <span className="sim-add-result-action">+ 추가</span>
                  </button>
                ))
              }
            </div>
          )}
        </div>

        {/* ── 이번 주 집행 요약 ── */}
        {items.filter(i => i.code !== 'CASH').length > 0 && (() => {
          const signals = statusMeta.filter((s, i) => items[i]?.code !== 'CASH')
          const takeProfitItems = signals.filter(s => s.status === 'take_profit')
          const nearProfitItems = signals.filter(s => s.status === 'near_profit')
          const stopLossItems = signals.filter(s => s.status === 'stop_loss')
          const nearStopItems = signals.filter(s => s.status === 'near_stop')
          const holdItems = signals.filter(s => s.status === 'hold')
          const hasAnySignal = takeProfitItems.length > 0 || stopLossItems.length > 0
          const realizedOnSignal = items
            .filter((_, i) => items[i]?.code !== 'CASH' && (statusMeta[i]?.status === 'take_profit' || statusMeta[i]?.status === 'stop_loss'))
            .reduce((acc, _, i) => acc + (statusMeta[i]?.unrealizedKrw ?? 0), 0)
          const hasPositions = items.some(i => i.code !== 'CASH' && (i.buyPrice ?? 0) > 0 && (i.shares ?? 0) > 0)
          if (!hasPositions) return null
          return (
            <div className="sim-weekly-summary">
              <div className="sim-weekly-summary-head">
                <span className="sim-weekly-summary-title">이번 주 집행 신호</span>
                {hasAnySignal && (
                  <span className={`sim-weekly-realized ${realizedOnSignal >= 0 ? 'sim-pos' : 'sim-neg'}`}>
                    신호대로 실행 시 {realizedOnSignal >= 0 ? '+' : ''}{formatKrw(realizedOnSignal)}
                  </span>
                )}
              </div>
              <div className="sim-weekly-signals">
                {takeProfitItems.length > 0 && (
                  <span className="sim-signal-tag sim-signal-tag--profit">익절 신호 {takeProfitItems.length}종목</span>
                )}
                {nearProfitItems.length > 0 && (
                  <span className="sim-signal-tag sim-signal-tag--near-profit">목표가 근접 {nearProfitItems.length}종목</span>
                )}
                {nearStopItems.length > 0 && (
                  <span className="sim-signal-tag sim-signal-tag--near-stop">손절가 근접 {nearStopItems.length}종목</span>
                )}
                {stopLossItems.length > 0 && (
                  <span className="sim-signal-tag sim-signal-tag--stop">손절 신호 {stopLossItems.length}종목</span>
                )}
                {holdItems.length > 0 && (
                  <span className="sim-signal-tag sim-signal-tag--hold">보유 유지 {holdItems.length}종목</span>
                )}
              </div>
            </div>
          )
        })()}

        {items.length === 0
          ? <EmptyState title="집행안이 비어 있습니다" description="위 검색창으로 종목을 추가하세요." />
          : (
            <div className="sim-stock-list">
              {items.map((row, idx) => {
                const meta = itemMeta[idx]
                const isOpen = expandedIdx === idx
                const splitTotal = row.split1 + row.split2 + row.split3
                const splitOver = splitTotal > 100

                return (
                  <div key={`${row.code || 'row'}-${idx}`} className={`sim-stock-card${isOpen ? ' sim-stock-card--open' : ''}`}>
                    {/* 아코디언 헤더 */}
                    <button
                      className="sim-stock-header"
                      onClick={() => setExpandedIdx(isOpen ? null : idx)}
                      aria-expanded={isOpen}
                    >
                      <GradeChip grade={meta.grade} />
                      <div className="sim-stock-info">
                        <span className="sim-stock-name">{row.name || '(미입력)'}</span>
                        <span className="sim-stock-code">{row.code || '—'}</span>
                      </div>
                      {statusMeta[idx].status !== 'no_price' && (
                        <PositionStatusBadge
                          status={statusMeta[idx].status}
                          changePct={statusMeta[idx].changePct}
                        />
                      )}
                      <div className="sim-stock-metrics">
                        <div className="sim-metric">
                          <span className="sim-metric-label">배분</span>
                          <span className="sim-metric-value">{formatKrw(row.amount)}</span>
                        </div>
                        <div className="sim-metric sim-metric--hide-sm">
                          <span className="sim-metric-label">R:R</span>
                          <span className="sim-metric-value">{formatNumber(meta.rr, 1)}:1</span>
                        </div>
                        <div className="sim-metric sim-metric--hide-sm">
                          <span className="sim-metric-label">기대손익</span>
                          <span className={`sim-metric-value${meta.ev >= 0 ? ' sim-pos' : ' sim-neg'}`}>
                            {meta.ev >= 0 ? '+' : ''}{formatKrw(meta.ev)}
                          </span>
                        </div>
                      </div>
                      <svg className={`sim-chevron${isOpen ? ' sim-chevron--open' : ''}`} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
                        <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>

                    {/* 아코디언 바디 */}
                    {isOpen && (
                      <div className="sim-stock-body">
                        {/* 종목 정보 */}
                        <div className="sim-stock-id-row">
                          <div className="sim-input-group">
                            <label className="sim-input-label">코드</label>
                            <input className="sim-input sim-input--mono" value={row.code}
                              onChange={(e) => updateItem(idx, { code: e.target.value })} placeholder="005930" />
                          </div>
                          <div className="sim-input-group sim-input-group--grow">
                            <label className="sim-input-label">종목명</label>
                            <input className="sim-input" value={row.name}
                              onChange={(e) => updateItem(idx, { name: e.target.value })} placeholder="삼성전자" />
                          </div>
                        </div>

                        {/* 핵심 파라미터 */}
                        <div className="sim-params-grid">
                          <div className="sim-input-group">
                            <label className="sim-input-label">투입 금액</label>
                            <div className="sim-input-row">
                              <input className="sim-input" type="number" min={0} value={row.amount}
                                onChange={(e) => updateItem(idx, { amount: Math.max(0, Number(e.target.value || 0)) })} />
                              <span className="sim-input-suffix">원</span>
                            </div>
                          </div>
                          <div className="sim-input-group">
                            <label className="sim-input-label">목표 상승</label>
                            <div className="sim-input-row">
                              <input className="sim-input" type="number" value={row.targetPct}
                                onChange={(e) => updateItem(idx, { targetPct: Number(e.target.value || 0) })} />
                              <span className="sim-input-suffix">%</span>
                            </div>
                          </div>
                          <div className="sim-input-group">
                            <label className="sim-input-label">손절</label>
                            <div className="sim-input-row">
                              <input className="sim-input" type="number" min={0} value={row.stopPct}
                                onChange={(e) => updateItem(idx, { stopPct: Math.max(0, Number(e.target.value || 0)) })} />
                              <span className="sim-input-suffix">%</span>
                            </div>
                          </div>
                          <div className="sim-input-group">
                            <label className="sim-input-label">승률 가정</label>
                            <div className="sim-input-row">
                              <input className="sim-input" type="number" min={0} max={100} value={row.winProb}
                                onChange={(e) => updateItem(idx, { winProb: clampPercent(Number(e.target.value || 0), 0, 100) })} />
                              <span className="sim-input-suffix">%</span>
                            </div>
                          </div>
                        </div>

                        {/* 분할 진입 */}
                        <div className="sim-split-section">
                          <span className="sim-split-label">분할 비율</span>
                          <div className="sim-split-grid">
                            <NumInput label="1차" value={row.split1} suffix="%" min={0} max={100}
                              onChange={(v) => updateItem(idx, { split1: clampPercent(v, 0, 100) })} />
                            <NumInput label="2차" value={row.split2} suffix="%" min={0} max={100}
                              onChange={(v) => updateItem(idx, { split2: clampPercent(v, 0, 100) })} />
                            <NumInput label="3차" value={row.split3} suffix="%" min={0} max={100}
                              onChange={(v) => updateItem(idx, { split3: clampPercent(v, 0, 100) })} />
                            <div className="sim-split-total">
                              <span className="sim-input-label">합계</span>
                              <span className={`sim-split-sum${splitOver ? ' sim-neg' : splitTotal === 100 ? ' sim-pos' : ''}`}>
                                {formatNumber(splitTotal, 0)}%
                              </span>
                              {splitOver && <span className="sim-split-warn">100% 초과</span>}
                            </div>
                          </div>
                        </div>

                        {/* 파생 지표 */}
                        <div className="sim-derived-row">
                          <div className="sim-derived-item">
                            <span className="sim-derived-label">R:R 비율</span>
                            <RRBar rr={meta.rr} />
                          </div>
                          <div className="sim-derived-item">
                            <span className="sim-derived-label">켈리 추천 비율</span>
                            <span className="sim-derived-value">{formatNumber(meta.kelly, 1)}%</span>
                            <span className="sim-derived-hint">
                              ({formatKrw(totalCapital * meta.kelly / 100)})
                            </span>
                          </div>
                          <div className="sim-derived-item">
                            <span className="sim-derived-label">기대손익</span>
                            <span className={`sim-derived-value${meta.ev >= 0 ? ' sim-pos' : ' sim-neg'}`}>
                              {meta.ev >= 0 ? '+' : ''}{formatKrw(meta.ev)}
                            </span>
                          </div>
                          <div className="sim-derived-item">
                            <span className="sim-derived-label">체결 반영 투자금</span>
                            <span className="sim-derived-value">{formatKrw(meta.splitInvested)}</span>
                          </div>
                        </div>

                        {/* 등급 안내 */}
                        {meta.grade === 'D' && (
                          <div className="sim-grade-warn">
                            이 거래는 기대값이 음수이거나 R:R이 불리합니다.
                            목표 상승률을 높이거나 손절을 좁히거나 승률을 재검토하세요.
                          </div>
                        )}
                        {meta.grade === 'C' && meta.rr < 2 && (
                          <div className="sim-grade-caution">
                            R:R이 2:1 미만입니다. 목표 대비 손절 비율 개선을 권장합니다.
                          </div>
                        )}

                        <div className="sim-stock-footer">
                          <button className="sim-btn sim-btn--danger" onClick={() => removeRow(idx)}>종목 제거</button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )
        }
      </div>

      {/* ── 목표 달성 경로 ── */}
      {items.filter(i => i.code !== 'CASH').length > 0 && monthlyProfitTarget > 0 && (
        <div className="sim-section">
          <span className="sim-section-label">목표 달성 경로</span>
          <p className="sim-section-desc">승률 가정 기반 · 주 1사이클(월~금) 기준</p>
          <div className="sim-goal-plan">
            <div className="sim-goal-row">
              <span className="sim-goal-label">1사이클 기대수익</span>
              <span className={`sim-goal-value ${weeklyPlan.cycleEV >= 0 ? 'sim-pos' : 'sim-neg'}`}>
                {weeklyPlan.cycleEV >= 0 ? '+' : ''}{formatKrw(weeklyPlan.cycleEV)}
              </span>
            </div>
            <div className="sim-goal-row">
              <span className="sim-goal-label">1사이클 전량 목표 달성 시</span>
              <span className="sim-goal-value sim-pos">+{formatKrw(weeklyPlan.cycleMaxProfit)}</span>
            </div>
            <div className="sim-goal-row sim-goal-row--highlight">
              <span className="sim-goal-label">월 4사이클 기준 기대수익</span>
              <span className={`sim-goal-value ${weeklyPlan.monthlyEV >= 0 ? 'sim-pos' : 'sim-neg'}`}>
                {weeklyPlan.monthlyEV >= 0 ? '+' : ''}{formatKrw(weeklyPlan.monthlyEV)}
              </span>
            </div>
            <div className="sim-goal-row">
              <span className="sim-goal-label">월 목표</span>
              <span className="sim-goal-value">{formatKrw(monthlyProfitTarget)}</span>
            </div>
            {/* 달성률 프로그레스 바 */}
            <div className="sim-goal-progress-wrap">
              <div className="sim-goal-progress-track">
                <div
                  className={`sim-goal-progress-fill ${weeklyPlan.progressPct >= 100 ? 'sim-goal-progress-fill--done' : weeklyPlan.progressPct >= 50 ? 'sim-goal-progress-fill--half' : 'sim-goal-progress-fill--low'}`}
                  style={{ width: `${Math.min(100, weeklyPlan.progressPct)}%` }}
                />
              </div>
              <span className="sim-goal-progress-label">{formatNumber(weeklyPlan.progressPct, 1)}%</span>
            </div>
            {weeklyPlan.cycleEV > 0 ? (
              <>
                <div className="sim-goal-row">
                  <span className="sim-goal-label">달성 예상</span>
                  <span className="sim-goal-value">
                    {weeklyPlan.cyclesNeeded < 1000
                      ? `${weeklyPlan.weeksNeeded}주 ≈ ${formatNumber(weeklyPlan.weeksNeeded / 4, 1)}개월`
                      : '현재 조건으로 달성 불가'}
                  </span>
                </div>
                {weeklyPlan.gapToTarget > 0 && (
                  <div className="sim-goal-hint">
                    💡 목표까지 월 {formatKrw(weeklyPlan.gapToTarget)} 부족 —
                    투자금을 {formatNumber((monthlyProfitTarget / weeklyPlan.monthlyEV), 1)}배 늘리거나
                    종목 수익률/승률 개선 필요
                  </div>
                )}
              </>
            ) : (
              <div className="sim-goal-hint sim-goal-hint--warn">
                ⚠️ 현재 포트폴리오의 기대수익이 0 이하입니다. 종목 파라미터를 점검하세요.
              </div>
            )}
            {/* 종목별 목표 기여 */}
            <div className="sim-goal-perstock">
              <span className="sim-goal-perstock-title">종목별 1사이클 기여 (목표 달성 시)</span>
              {weeklyPlan.perStock.map(s => (
                <div key={s.code} className="sim-goal-perstock-row">
                  <span className="sim-goal-perstock-name">{s.name}<span className="sim-goal-perstock-code"> {s.code}</span></span>
                  <span className="sim-goal-perstock-meta">목표 +{formatNumber(s.targetPct, 1)}% / 손절 -{formatNumber(s.stopPct, 1)}%</span>
                  <span className="sim-goal-perstock-ev sim-pos">목표 달성 +{formatKrw(s.targetGainNet)}</span>
                  <span className="sim-goal-perstock-ev sim-neg">손절 시 {formatKrw(s.stopLossNet)}</span>
                  <span className={`sim-goal-perstock-ev ${s.ev >= 0 ? 'sim-pos' : 'sim-neg'}`}>기대 {s.ev >= 0 ? '+' : ''}{formatKrw(s.ev)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── 시나리오 분석 ── */}
      {items.length > 0 && (
        <div className="sim-section">
          <span className="sim-section-label">시나리오 분석</span>
          <p className="sim-section-desc">체결 반영 투자금 기준 · 수수료·세금 차감 순수익</p>

          <div className="sim-scenario-table-wrap">
            <table className="sim-scenario-table">
              <thead>
                <tr>
                  <th className="sim-scenario-th">시나리오</th>
                  <th className="sim-scenario-th">순수익</th>
                  <th className="sim-scenario-th sim-scenario-th--hide-sm">수익률(투자금 대비)</th>
                </tr>
              </thead>
              <tbody>
                {/* 최대 손실 */}
                <tr className="sim-scenario-row sim-scenario-row--special">
                  <td className="sim-scenario-td">
                    <span className="sim-scenario-badge sim-scenario-badge--down">전량 손절</span>
                  </td>
                  <td className="sim-scenario-td sim-neg sim-scenario-amount">{formatKrw(summary.maxLoss)}</td>
                  <td className="sim-scenario-td sim-neg sim-scenario-th--hide-sm">
                    {summary.allocated > 0 ? formatNumber((summary.maxLoss / summary.allocated) * 100, 2) : '—'}%
                  </td>
                </tr>
                {scenarioRows.map((row) => {
                  const isPos = row.net >= 0
                  return (
                    <tr key={row.pct} className={`sim-scenario-row${row.pct === 0 ? ' sim-scenario-row--zero' : ''}`}>
                      <td className="sim-scenario-td">
                        <span className={`sim-scenario-badge${isPos ? ' sim-scenario-badge--up' : ' sim-scenario-badge--down'}`}>
                          {row.pct > 0 ? '+' : ''}{row.pct}%
                        </span>
                      </td>
                      <td className={`sim-scenario-td sim-scenario-amount${isPos ? ' sim-pos' : ' sim-neg'}`}>
                        {isPos ? '+' : ''}{formatKrw(row.net)}
                      </td>
                      <td className={`sim-scenario-td sim-scenario-th--hide-sm${isPos ? ' sim-pos' : ' sim-neg'}`}>
                        {summary.allocated > 0 ? `${isPos ? '+' : ''}${formatNumber((row.net / summary.allocated) * 100, 2)}%` : '—'}
                      </td>
                    </tr>
                  )
                })}
                {/* 기대값 행 */}
                <tr className="sim-scenario-row sim-scenario-row--special sim-scenario-row--ev">
                  <td className="sim-scenario-td">
                    <span className="sim-scenario-badge sim-scenario-badge--ev">기대값</span>
                  </td>
                  <td className={`sim-scenario-td sim-scenario-amount${summary.evAfterCost >= 0 ? ' sim-pos' : ' sim-neg'}`}>
                    {summary.evAfterCost >= 0 ? '+' : ''}{formatKrw(summary.evAfterCost)}
                  </td>
                  <td className={`sim-scenario-td sim-scenario-th--hide-sm${summary.evAfterCost >= 0 ? ' sim-pos' : ' sim-neg'}`}>
                    {summary.allocated > 0 ? `${summary.evAfterCost >= 0 ? '+' : ''}${formatNumber((summary.evAfterCost / summary.allocated) * 100, 2)}%` : '—'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 시세 상세 모달 */}
      <StockDetailModal
        code={selectedStockCode}
        name={selectedStockName}
        isOpen={showStockDetail}
        onClose={() => {
          setShowStockDetail(false)
          setSelectedStockCode('')
          setSelectedStockName('')
        }}
      />
    </div>
  )
}
