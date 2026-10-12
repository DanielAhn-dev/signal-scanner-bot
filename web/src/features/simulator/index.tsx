import { useSeedCapital } from '../../lib/useSeedCapital'
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useCurrentChatId } from '../../stores/profileStore'
import { formatKrw, formatKstDateTime } from '../../lib/format'
import { apiFetch } from '../../lib/api'
import { useToast } from '../../components/ToastProvider'
import { searchStocks } from '../../lib/stockCache'
import StockDetailModal from '../../components/StockDetailModal'
import type { CompareResult, PlanHistoryEntry, RecommendSource } from './types'
import { mergeAlgoCandidates } from './lib/algoCandidates'
import {
  countTradeable,
  getCandidatesBySource as getCandidatesBySourceFor,
  recommendWithStyleFallback as recommendWithStyleFallbackFor,
} from './lib/recommend'
import { calcItemMeta, calcScenarioRows, calcSummary } from './lib/summary'
import { buildWatchlistCandidates } from './lib/watchlistCandidates'
import SummaryCard from './components/SummaryCard'
import RecommendSection from './components/RecommendSection'
import SettingsPanel from './components/SettingsPanel'
import ItemsSection from './components/ItemsSection'
import GoalPathSection from './components/GoalPathSection'
import ScenarioSection from './components/ScenarioSection'
import {
  defaultPlanItem,
  readSimulationPlan,
  saveSimulationPlan,
  type HighlightPlanItem,
} from './planStore'
import {
  buildTelegramMessage,
  calcPositionStatus,
  calcWeeklyCyclePlan,
  type RecommendationStyle,
  type TelegramFormat,
} from './telegramFormat'

export default function SimulatorPage() {
  const chatId = useCurrentChatId()
  const location = useLocation()
  const navigate = useNavigate()
  const proposedCapital = Number((location.state as { seedBuilderCapital?: number } | null)?.seedBuilderCapital)
  const fromSeedBuilder = Number.isSafeInteger(proposedCapital) && proposedCapital > 0
  const initialPlan = useMemo(() => readSimulationPlan(), [])
  const [totalCapital, setTotalCapital] = useState(fromSeedBuilder ? proposedCapital : initialPlan?.totalCapital || 10_000_000)
  // 집행우선·백테스트가 넘긴 종목으로 시작한다. 예전엔 "항상 빈 배열"이라 투자금만 넘어오고 종목은 버려져
  // 시뮬레이터가 비어 있었다(계획에 종목이 있으면 서버 불러오기도 건너뛰어 아무것도 안 보였다).
  const [items, setItems] = useState<HighlightPlanItem[]>(() => (Array.isArray(initialPlan?.items) ? initialPlan!.items : []))
  // 넘겨받은 계획에 투자금이 없으면 내 시드로 (1천만원 고정 대신)
  const seedCapital = useSeedCapital()
  useEffect(() => {
    if (!fromSeedBuilder && !(initialPlan?.totalCapital) && seedCapital) setTotalCapital(seedCapital)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedCapital])
  const [monthlyProfitTarget, setMonthlyProfitTarget] = useState(500_000) // 월 500만원 기본값
  const [fillRatePct, setFillRatePct] = useState(100)
  const [feePct, setFeePct] = useState(0.15)
  const [taxPct, setTaxPct] = useState(0.2)
  const [memo, setMemo] = useState(initialPlan?.notes || '')
  const [syncing, setSyncing] = useState(false)
  const [lastServerSavedAt, setLastServerSavedAt] = useState<string>('')
  const [telegramFormat, setTelegramFormat] = useState<TelegramFormat>('detailed')
  const [history, setHistory] = useState<PlanHistoryEntry[]>([])
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
  const [recommendSource, setRecommendSource] = useState<RecommendSource>('algo')
  const [recommendStyle, setRecommendStyle] = useState<RecommendationStyle>('stable')
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null)
  const [showCompare, setShowCompare] = useState(false)
  const [showStockDetail, setShowStockDetail] = useState(false)
  const [selectedStockCode, setSelectedStockCode] = useState<string>('')
  const [selectedStockName, setSelectedStockName] = useState<string>('')
  const addDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const addWrapRef = useRef<HTMLDivElement>(null)
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

  const summary = useMemo(
    () => calcSummary({ items, fillRatePct, feePct, taxPct, totalCapital }),
    [items, fillRatePct, feePct, taxPct, totalCapital],
  )

  const scenarioRows = useMemo(
    () => calcScenarioRows(items, fillRatePct, feePct, taxPct),
    [items, fillRatePct, feePct, taxPct],
  )

  const itemMeta = useMemo(() => calcItemMeta(items, fillRatePct), [items, fillRatePct])

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

  const getCandidatesBySource = (source: RecommendSource): HighlightPlanItem[] =>
    getCandidatesBySourceFor(source, { algo: algoCandidates, watchlist: watchlistCandidates, items })

  const recommendWithStyleFallback = (
    baseCandidates: HighlightPlanItem[],
    preferredStyle: RecommendationStyle,
    allowFallback: boolean,
  ) => recommendWithStyleFallbackFor(baseCandidates, preferredStyle, allowFallback, totalCapital, monthlyProfitTarget)

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
      setWatchlistCandidates(buildWatchlistCandidates(positions))
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

      const finalCandidates = mergeAlgoCandidates(scanList, hlList)
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

  const loadFromHistory = (entry: PlanHistoryEntry) => {
    applyPlan(entry.plan)
    saveSimulationPlan(entry.plan)
    setLastServerSavedAt(entry.updatedAt)
    setHistoryOpen(false)
    toast.show(`${formatKstDateTime(entry.updatedAt)} 계획을 불러왔습니다.`)
  }

  useEffect(() => {
    if (fromSeedBuilder || initialPlan?.items?.length) return
    void loadServer()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const showAddDropdown = addFocused && addSearch.trim().length >= 2

  return (
    <div className="sim-page">
      {fromSeedBuilder && (
        <div role="status" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '10px 14px', marginBottom: 12, border: '1px solid var(--color-border-default)', background: 'var(--color-bg-sunken)', fontSize: 13 }}>
          <span>시드 만들기에서 확인한 가용 현금 {formatKrw(proposedCapital)}으로 시작했습니다. 저장된 계획과 가상 시드는 바뀌지 않았습니다.</span>
          <button type="button" onClick={() => navigate('/seed-builder')} style={{ border: 0, background: 'none', color: 'var(--color-brand)', cursor: 'pointer', font: 'inherit', padding: 0 }}>시드 만들기로 돌아가기</button>
        </div>
      )}
      {/* ── 헤더 ── */}
      <div className="sim-header">
        <div>
          <h1 className="sim-title">시뮬레이터</h1>
          <p className="sim-desc">넣을 돈과 종목을 정하면, 잘 풀릴 때와 안 풀릴 때 얼마가 되는지 미리 보여줍니다.</p>
          <p className="sim-desc" style={{ marginTop: 4 }}>
            ① 총 투자금 입력 → ② 종목 추가(고르기 어려우면 아래 "종목 추천받기") → ③ 맨 아래 시나리오 분석 확인
          </p>
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
      <SummaryCard
        totalCapital={totalCapital}
        setTotalCapital={setTotalCapital}
        summary={summary}
      />

      {/* ── 월 수익 목표 & 추천 ── */}
      <RecommendSection
        totalCapital={totalCapital}
        items={items}
        setItems={setItems}
        monthlyProfitTarget={monthlyProfitTarget}
        setMonthlyProfitTarget={setMonthlyProfitTarget}
        feePct={feePct}
        taxPct={taxPct}
        recommendedPortfolio={recommendedPortfolio}
        showRecommendation={showRecommendation}
        setShowRecommendation={setShowRecommendation}
        watchlistCandidates={watchlistCandidates}
        algoCandidates={algoCandidates}
        loadingAlgo={loadingAlgo}
        loadingWatchlist={loadingWatchlist}
        loadingCandidates={loadingCandidates}
        recommendSource={recommendSource}
        setRecommendSource={setRecommendSource}
        recommendStyle={recommendStyle}
        setRecommendStyle={setRecommendStyle}
        compareResult={compareResult}
        showCompare={showCompare}
        setShowCompare={setShowCompare}
        setShowStockDetail={setShowStockDetail}
        setSelectedStockCode={setSelectedStockCode}
        setSelectedStockName={setSelectedStockName}
        toast={toast}
        chatId={chatId}
        generateRecommendation={generateRecommendation}
        applyRecommendation={applyRecommendation}
        generateCompare={generateCompare}
        loadWatchlistCandidates={loadWatchlistCandidates}
        loadAlgoCandidates={loadAlgoCandidates}
      />

      {/* ── 설정 패널 (접기/펼치기) ── */}
      {settingsOpen && (
        <SettingsPanel
          totalCapital={totalCapital}
          setTotalCapital={setTotalCapital}
          fillRatePct={fillRatePct}
          setFillRatePct={setFillRatePct}
          feePct={feePct}
          setFeePct={setFeePct}
          taxPct={taxPct}
          setTaxPct={setTaxPct}
          memo={memo}
          setMemo={setMemo}
          syncing={syncing}
          lastServerSavedAt={lastServerSavedAt}
          telegramFormat={telegramFormat}
          setTelegramFormat={setTelegramFormat}
          history={history}
          historyOpen={historyOpen}
          setHistoryOpen={setHistoryOpen}
          historyLoading={historyLoading}
          saveLocal={saveLocal}
          saveServer={saveServer}
          loadServer={loadServer}
          sendTelegram={sendTelegram}
          loadHistory={loadHistory}
          loadFromHistory={loadFromHistory}
        />
      )}

      {/* ── 종목 목록 ── */}
      <ItemsSection
        totalCapital={totalCapital}
        items={items}
        expandedIdx={expandedIdx}
        setExpandedIdx={setExpandedIdx}
        addSearch={addSearch}
        setAddSearch={setAddSearch}
        addResults={addResults}
        setAddResults={setAddResults}
        setAddFocused={setAddFocused}
        addWrapRef={addWrapRef}
        itemMeta={itemMeta}
        statusMeta={statusMeta}
        updateItem={updateItem}
        addRow={addRow}
        removeRow={removeRow}
        showAddDropdown={showAddDropdown}
      />

      {/* ── 목표 달성 경로 ── */}
      <GoalPathSection
        items={items}
        monthlyProfitTarget={monthlyProfitTarget}
        weeklyPlan={weeklyPlan}
      />

      {/* ── 시나리오 분석 ── */}
      {items.length > 0 && (
        <ScenarioSection
          summary={summary}
          scenarioRows={scenarioRows}
        />
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
