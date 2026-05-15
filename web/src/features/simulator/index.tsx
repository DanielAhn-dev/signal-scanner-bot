import React, { useEffect, useMemo, useRef, useState } from 'react'
import { LucideIcon } from '../../components/LucideIcon'
import { useCurrentChatId } from '../../stores/profileStore'
import { EmptyState } from '../../components/StateViews'
import { formatKrw, formatNumber } from '../../lib/format'
import { apiFetch } from '../../lib/api'
import { useToast } from '../../components/ToastProvider'
import { searchStocks } from '../../lib/stockCache'
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
  calcRR,
  calcScenarioNet,
  calcSplitInvested,
  clampPercent,
  getTradeGrade,
  recommendPortfolio,
  calcRequiredAnnualReturn,
  calcAllocationWeight,
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
  const [loadingCandidates, setLoadingCandidates] = useState(false)
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

  const generateRecommendation = () => {
    if (monthlyProfitTarget <= 0) {
      toast.show('월 목표 수익을 입력하세요.')
      return
    }
    // 관심종목 > 알고리즘 > items 우선순위
    let candidates: HighlightPlanItem[] = []
    if (chatId && watchlistCandidates.length > 0) candidates = watchlistCandidates
    else if (!chatId && algoCandidates.length > 0) candidates = algoCandidates
    else candidates = items
    if (candidates.length === 0) {
      toast.show('추천할 종목이 없습니다. 관심종목을 추가하거나 포트폴리오에 종목을 추가하세요.')
      return
    }
    const recommended = recommendPortfolio(candidates, totalCapital, monthlyProfitTarget)
    if (recommended.length === 0) {
      toast.show('추천 가능한 종목이 없습니다. (품질 기준 미충족)')
      return
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

  const loadWatchlistCandidates = async () => {
    if (!chatId) {
      setWatchlistCandidates([])
      return
    }
    setLoadingCandidates(true)
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
          // 기본값으로 초기화 (나중에 사용자가 조정 가능)
          return defaultPlanItem({ code, name, sector_id: pos.sector_id })
        })
        .filter((item: any) => item != null)
      setWatchlistCandidates(candidates)
    } catch (e: any) {
      console.warn('관심종목 로드 실패:', e?.message)
      setWatchlistCandidates([])
    } finally {
      setLoadingCandidates(false)
    }
  }

  // chatId 없을 때 내부 알고리즘 후보군 fetch
  const loadAlgoCandidates = async () => {
    if (chatId) { setAlgoCandidates([]); return }
    setLoadingCandidates(true)
    try {
      console.log('[loadAlgoCandidates] 시작...')
      // scan-candidates fetch
      const scanRes = await apiFetch('/api/ui?route=scan-candidates&limit=50', { cacheMs: 10000, timeoutMs: 15000 })
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
      
      // code 기준 중복 제거 & 품질 등급별 파라미터 설정
      const merged: Record<string, HighlightPlanItem> = {}
      
      // scan-candidates 처리 (entry_grade 기반) - A/B/C는 포함, D만 제외
      let scanCandidateCount = 0
      for (const row of scanList) {
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
      for (const row of hlList) {
        const code = String(row.code || '').trim()
        const name = String(row.name || code || '').trim()
        if (!code || !name) continue
        
        // 하이라이트 데이터: upside/downside 직접 사용
        let targetPct = Number(row.expected_upside_pct ?? 8) || 8
        let stopPct = Math.abs(Number(row.expected_drawdown_pct ?? 2.5) || 2.5)
        let winProb = Math.max(30, Math.min(70, Number(row.confidence_pct ?? 58) || 58))
        
        // code가 이미 merged에 있으면 건너뛰기 (scan-candidates 우선)
        if (code in merged) continue
        
        // 가격 정보 저장 (entry_price 우선, 없으면 현황 가격)
        const entryPrice = Number(row.entry_price ?? 0)
        
        const item = defaultPlanItem({ code, name, sector_id: row.sector_id })
        merged[code] = {
          ...item,
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
      setLoadingCandidates(false)
    }
  }

  // 초기화 시 관심종목/내부 알고리즘 후보 자동 로드
  useEffect(() => {
    if (chatId) void loadWatchlistCandidates()
    else void loadAlgoCandidates()
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
            <span className="sim-summary-label">기대손익</span>
            <span className={`sim-summary-value sim-summary-value--lg${summary.evAfterCost >= 0 ? ' sim-pos' : ' sim-neg'}`}>
              {summary.evAfterCost >= 0 ? '+' : ''}{formatKrw(summary.evAfterCost)}
            </span>
          </div>
          <div className="sim-summary-item">
            <span className="sim-summary-label">최대 손실 (전량 손절)</span>
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
        <div className="sim-watchlist-status">
          {chatId ? (
            watchlistCandidates.length > 0 ? (
              <div className="sim-watchlist-info-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 32 }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <span className="sim-watchlist-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <LucideIcon name="List" size={18} style={{ marginRight: 2 }} />
                    관심종목
                  </span>
                  <span className="sim-watchlist-count">{watchlistCandidates.length}개 불러옴</span>
                </div>
                <button 
                  className="sim-btn sim-btn--ghost sim-btn--sm" 
                  onClick={() => loadWatchlistCandidates()}
                  disabled={loadingCandidates}
                  title="관심종목 새로고침"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                >
                  {loadingCandidates ? '로딩 중...' : <LucideIcon name="RefreshCw" size={16} />}
                </button>
              </div>
            ) : (
              <div className="sim-watchlist-empty">
                <span className="sim-watchlist-badge">—</span>
                <span className="sim-watchlist-text">관심종목이 없습니다. 관심종목 페이지에서 종목을 추가하세요.</span>
              </div>
            )
          ) : (
            <div className="sim-watchlist-empty">
              <span className="sim-watchlist-badge">—</span>
              <span className="sim-watchlist-text">관심종목 기반 추천을 위해 텔레그램 연동이 필요합니다.</span>
            </div>
          )}
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
        </div>

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
                const weights = recommendedPortfolio.reduce((acc, r) => acc + calcAllocationWeight(r), 0)
                const allocPct = weights > 0 ? (calcAllocationWeight(rec) / weights) * 100 : 0
                const rr = calcRR(rec)
                const ev = calcExpectedValue(rec)
                return (
                  <div key={`${rec.code}-${idx}`} className="sim-rec-item">
                    <div className="sim-rec-item-name">
                      <span className="sim-rec-code">{rec.code}</span>
                      <span className="sim-rec-name">{rec.name}</span>
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
    </div>
  )
}
