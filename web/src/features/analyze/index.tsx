import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { apiFetch } from '../../lib/api'
import { formatKrw, formatNumber } from '../../lib/format'
import { getStocks, type StockItem } from '../../lib/stockCache'
import Button from '../../components/ui/Button'
import Skeleton from '../../components/Skeleton'
import StockSearchInput from '../../components/StockSearchInput'
import { useToast } from '../../components/ToastProvider'
import ShareModal from '../../components/ShareModal'
import { useShareManager } from '../../hooks/useShareManager'
import CandleChart from '../../components/CandleChart'
import EconomicEventBadge from '../../components/EconomicEventBadge'
import { LayoutDashboard, TrendingUp, Flag, Activity, Search, Link2, HelpCircle } from 'lucide-react'
import type { OhlcvCandle } from '../../lib/types'
import { useCurrentChatId } from '../../stores/profileStore'

function scoreColor(score: number | null): string {
  if (score == null) return 'var(--color-text-tertiary)'
  if (score >= 70) return 'var(--color-success)'
  if (score >= 50) return 'var(--color-warning)'
  return 'var(--color-error)'
}

function advisorStatusStyle(status?: string): { background: string; color: string } {
  if (!status) return { background: 'var(--color-bg-sunken)', color: 'var(--color-text-secondary)' }
  const s = status.toLowerCase()
  if (s === 'strong_buy' || s === 'buy') {
    return { background: 'var(--color-success-bg)', color: 'var(--color-success)' }
  }
  if (s.includes('partial') || s === 'watch') {
    return { background: 'var(--color-warning-bg)', color: 'var(--color-warning)' }
  }
  return { background: 'var(--color-error-bg)', color: 'var(--color-error)' }
}

function regimeLabel(regime?: string): string {
  const r = String(regime || '').toLowerCase()
  if (r === 'risk_on') return '리스크온'
  if (r === 'risk_off') return '리스크오프'
  if (r === 'hold') return '중립/HOLD'
  return '—'
}

function twoStageActionStyle(action?: string): { background: string; color: string } {
  const a = String(action || '').toLowerCase()
  if (a === 'aggressive_buy' || a === 'pilot_buy') {
    return { background: 'var(--color-success-bg)', color: 'var(--color-success)' }
  }
  if (a === 'reduce' || a === 'hold') {
    return { background: 'var(--color-warning-bg)', color: 'var(--color-warning)' }
  }
  return { background: 'var(--color-error-bg)', color: 'var(--color-error)' }
}

function getFlowMetricLabel(metric?: string | null): string | null {
  if (metric === 'volume') return '거래량'
  if (metric === 'amount') return '거래대금'
  return null
}

function formatFlowValue(value: number | null, metric?: string | null): string {
  if (value == null) return '—'
  if (metric === 'volume') return `${formatNumber(value, 0)}주`
  return formatKrw(value)
}

function buildAnalyzeShareUrl(code: string): string {
  if (typeof window === 'undefined') return ''
  const url = new URL(window.location.href)
  url.searchParams.set('code', code)
  return url.toString()
}

const DIVIDER = (
  <div style={{ borderTop: '1px solid var(--color-border-default)', margin: 'var(--space-4) 0' }} />
)

/** 차트 토글 상태를 localStorage에 영속 저장하는 훅 */
function useLocalStorageBool(
  key: string,
  defaultValue: boolean,
): [boolean, React.Dispatch<React.SetStateAction<boolean>>] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(key)
      return stored !== null ? stored === 'true' : defaultValue
    } catch {
      return defaultValue
    }
  })
  const set = useCallback((next: React.SetStateAction<boolean>) => {
    setValue((prev) => {
      const resolved = typeof next === 'function' ? (next as (v: boolean) => boolean)(prev) : next
      try { localStorage.setItem(key, String(resolved)) } catch { /* ignore */ }
      return resolved
    })
  }, [key])
  return [value, set]
}

/** 최근 검색 종목을 localStorage에 저장/관리 (최대 5개) */
function useRecentSearches(): [
  Array<{ code: string; name: string }>,
  (stock: { code: string; name: string }) => void,
] {
  const KEY = 'analyze.recentSearches'
  const [list, setList] = useState<Array<{ code: string; name: string }>>(() => {
    try {
      const raw = localStorage.getItem(KEY)
      return raw ? (JSON.parse(raw) as Array<{ code: string; name: string }>) : []
    } catch {
      return []
    }
  })
  const push = useCallback((stock: { code: string; name: string }) => {
    setList(prev => {
      const filtered = prev.filter(s => s.code !== stock.code)
      const next = [stock, ...filtered].slice(0, 5)
      try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [])
  return [list, push]
}

export default function AnalyzePage({ onNavigate }: { onNavigate?: (r: string) => void }) {
  const chatId = useCurrentChatId()
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<any | null>(null)
  const [candles, setCandles] = useState<OhlcvCandle[]>([])
  const [flow, setFlow] = useState<any | null>(null)
  const [creditShort, setCreditShort] = useState<any | null>(null)
  const [advisor, setAdvisor] = useState<any | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showExtendedIndicators, setShowExtendedIndicators] = useState(false)
  // 차트 토글 — localStorage에 저장, 기본값: HUD만 켜짐 / MA·세력선은 꺼짐
  const [showChartHud, setShowChartHud] = useLocalStorageBool('chart.showHud', true)
  const [showMaEmaOverlay, setShowMaEmaOverlay] = useLocalStorageBool('chart.showMaEma', false)
  const [showTradeMarkers, setShowTradeMarkers] = useLocalStorageBool('chart.showMarkers', true)
  const [showForceLine, setShowForceLine] = useLocalStorageBool('chart.showForce', false)
  const [showPersonalized, setShowPersonalized] = useState(false)
  const [recentSearches, pushRecentSearch] = useRecentSearches()
  const inputRef = useRef<HTMLInputElement>(null)
  const toast = useToast()
  const shareManager = useShareManager({
    endpoint: '/api/ui/route-share',
    scopeKey: 'kind',
    requiresCode: false,
  })

  // 데이터 신뢰성 검증
  const dataValidation = useMemo(() => {
    if (!result || !advisor) return { isReliable: true, warnings: [] as string[] }
    
    const warnings: string[] = []
    const currentPrice = result.close ?? 0
    const entryMid = advisor.entryLow != null && advisor.entryHigh != null
      ? (advisor.entryLow + advisor.entryHigh) / 2
      : null
    
    // 진입가와 현재가의 갭 검증 (스케일링 이슈)
    if (entryMid && currentPrice > 0) {
      const ratio = Math.max(currentPrice, entryMid) / Math.min(currentPrice, entryMid)
      if (ratio > 3) {
        warnings.push(`진입가와 현재가의 갭이 큼 (비율: ${ratio.toFixed(1)}배). DB 데이터 동기화 확인 필요`)
      } else if (ratio > 2) {
        warnings.push(`진입가와 현재가의 차이가 예상보다 큼 (비율: ${ratio.toFixed(1)}배)`)
      }
    }
    
    return {
      isReliable: warnings.length === 0,
      warnings,
    }
  }, [result, advisor])

  // 서버에서 내려온 값을 직접 사용한다. 클라이언트 재계산은 서버와 불일치를 유발한다.
  const computedSma20 = result?.sma20 ?? null
  const computedSma50 = result?.sma50 ?? null
  const computedSma200 = result?.sma200 ?? null
  const computedEma20 = result?.ema20 ?? null
  const computedEma50 = result?.ema50 ?? null
  const computedEma200 = result?.ema200 ?? null
  const computedRsi14 = result?.rsi14 ?? null
  const flowMetricLabel = getFlowMetricLabel(flow?.metric)
  const hasCreditShortData =
    creditShort?.creditRatio != null ||
    creditShort?.shortRatio != null ||
    creditShort?.shortBalance != null
  const intradayDelta =
    result?.close != null && result?.open != null
      ? Number(result.close) - Number(result.open)
      : null

  const analyze = async (code?: string) => {
    const q = code ?? query.trim()
    if (!q) return

    setLoading(true)
    setError(null)
    setResult(null)
    setFlow(null)
    setCreditShort(null)
    setAdvisor(null)
    setCandles([])

    try {
      const chatQs = chatId ? `&chat_id=${encodeURIComponent(chatId)}` : ''
      const res = await apiFetch(`/api/ui/stock-latest?code=${encodeURIComponent(q)}${chatQs}`, { cacheMs: 0 })
      if (res?.profile || res?.latest) {
        const merged = { ...res.profile, ...res.latest }
        setResult(merged)
        if (merged.code && (merged.name || merged.code)) {
          pushRecentSearch({ code: merged.code, name: merged.name ?? merged.code })
        }
        // OHLCV 캔들 데이터: 서버 series를 OhlcvCandle 형태로 정규화
        const rawData: any[] = res?.data ?? []
        setCandles(
          rawData
            .map((r: any) => ({
              date: String(r.date || r.Date || ''),
              open: Number(r.open),
              high: Number(r.high),
              low: Number(r.low),
              close: Number(r.close),
              volume: Number(r.volume ?? 0),
            }))
            .filter((c) => {
              if (!c.date) return false
              if (![c.open, c.high, c.low, c.close].every(Number.isFinite)) return false
              if (c.open <= 0 || c.high <= 0 || c.low <= 0 || c.close <= 0) return false
              return c.high >= Math.max(c.open, c.close, c.low) && c.low <= Math.min(c.open, c.close, c.high)
            })
        )
        setFlow(res?.flow ?? null)
        setCreditShort(res?.creditShort ?? null)
        setAdvisor(res?.advisor ?? null)
      } else if (res?.error) {
        setError(res.error)
      } else {
        setError('조회 결과 없음')
      }
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!result?.code || typeof window === 'undefined') return
    try {
      const nextUrl = buildAnalyzeShareUrl(result.code)
      if (nextUrl !== window.location.href) {
        window.history.replaceState({}, '', nextUrl)
      }
    } catch {
      // ignore
    }
  }, [result?.code])

  const handleStockSelect = (stock: StockItem) => {
    analyze(stock.code)
  }

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const sharedCode = params.get('code')?.trim()
      const pending = sessionStorage.getItem('analyze_pending_code')
      const initialCode = sharedCode || pending
      if (pending) {
        sessionStorage.removeItem('analyze_pending_code')
      }
      if (initialCode) {
        setQuery(initialCode)
        void analyze(initialCode)
      }
    } catch {
      // ignore
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const formatDate = (value: unknown) => {
    if (!value) return '—'
    const d = new Date(String(value))
    if (Number.isNaN(d.getTime())) return String(value)
    return d.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'Asia/Seoul',
    })
  }

  const formatDateTime = (value: unknown) => {
    if (!value) return '—'
    const d = new Date(String(value))
    if (Number.isNaN(d.getTime())) return String(value)
    return d.toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Seoul',
    })
  }

  const priceBarPct =
    result?.high != null && result?.low != null && result?.high !== result?.low
      ? ((result.close - result.low) / (result.high - result.low)) * 100
      : null

  const shareSummaryLines = useMemo(() => {
    if (!result) return [] as string[]
    const lines: string[] = []

    if (result.high != null && result.low != null) {
      lines.push(`일중 범위 ${formatKrw(result.low)} ~ ${formatKrw(result.high)}`)
    }

    const fundamentalBits = [
      result.per != null ? `PER ${formatNumber(result.per, 2)}` : null,
      result.pbr != null ? `PBR ${formatNumber(result.pbr, 2)}` : null,
      result.roe != null ? `ROE ${formatNumber(result.roe, 2)}%` : null,
    ].filter(Boolean) as string[]
    if (fundamentalBits.length > 0) {
      lines.push(fundamentalBits.join(' / '))
    }

    if (advisor?.statusLabel || advisor?.finalScore != null) {
      const advisorParts = [
        advisor?.statusLabel ? `AI 판정 ${advisor.statusLabel}` : null,
        advisor?.finalScore != null ? `${formatNumber(advisor.finalScore, 1)}점` : null,
        advisor?.twoStage?.actionLabel ? `실행 ${advisor.twoStage.actionLabel}` : null,
      ].filter(Boolean) as string[]
      if (advisorParts.length > 0) {
        lines.push(advisorParts.join(' · '))
      }
    }

    if (advisor?.entryLow != null && advisor?.entryHigh != null) {
      lines.push(`진입구간 ${formatKrw(advisor.entryLow)} ~ ${formatKrw(advisor.entryHigh)}`)
    }

    if (advisor?.target1 != null && advisor?.stopPrice != null) {
      lines.push(`1차 목표 ${formatKrw(advisor.target1)} / 손절 ${formatKrw(advisor.stopPrice)}`)
    }

    return lines.slice(0, 4)
  }, [advisor, result])

  const chartHud = useMemo(() => {
    if (!candles.length) {
      return {
        support: null as number | null,
        resistance: null as number | null,
      }
    }

    const recent = [...candles].slice(-20)
    const lows = recent.map((c) => Number(c.low)).filter((v) => Number.isFinite(v))
    const highs = recent.map((c) => Number(c.high)).filter((v) => Number.isFinite(v))

    return {
      support: lows.length ? Math.min(...lows) : null,
      resistance: highs.length ? Math.max(...highs) : null,
    }
  }, [candles])

  const signalText = useMemo(() => {
    if (advisor?.twoStage?.actionLabel) return `${advisor.twoStage.actionLabel} (${advisor?.statusLabel || '대기'})`
    const status = String(advisor?.status || '').toLowerCase()
    if (status === 'strong_buy' || status === 'buy-now') return '강력매수'
    if (status === 'buy' || status === 'buy-on-pullback') return '매수'
    if (status === 'add_buy' || status === 'add-buy' || status === 'additional_buy' || status === 'additional-buy' || status === 'scale_in' || status === 'scale-in') return '추가매수'
    if (status === 'partial_sell') return '익절'
    if (status === 'sell') return '손절/매도'
    if (status === 'watch') return '관망'
    return advisor?.statusLabel || '대기'
  }, [advisor])

  const analyzeCaptureId = result?.code ? `analyze-result-capture-${result.code}` : 'analyze-result-capture'

  const onShareAnalyze = async () => {
    const code = String(result?.code || query || '').trim()
    if (!code) {
      toast.show('먼저 종목을 조회해 주세요')
      return
    }
    const recentCloses = candles
      .slice(-10)
      .map((c) => Number(c.close))
      .filter((v) => Number.isFinite(v))
      .reverse()

    await shareManager.createShare('analyze', {
      kind: 'analyze',
      payload: {
        stock: {
          code,
          name: result?.name,
          price: result?.close,
          changePct: result?.change_pct,
          date: result?.date,
          open: result?.open,
          high: result?.high,
          low: result?.low,
          volume: result?.volume,
          marketCap: result?.market_cap,
          per: result?.per,
          pbr: result?.pbr,
          roe: result?.roe,
        },
        advisor: {
          statusLabel: advisor?.statusLabel,
          finalScore: advisor?.finalScore,
          entryLow: advisor?.entryLow,
          entryHigh: advisor?.entryHigh,
          target1: advisor?.target1,
          target2: advisor?.target2,
          stopPrice: advisor?.stopPrice,
        },
        summaryLines: shareSummaryLines,
        recentCloses,
      },
    })
  }

  return (
    <section className="container-app analyze-sheet xls-page-inset">
      <table className="xls-table analyze-sheet__meta-table" style={{ width: '100%', tableLayout: 'fixed', marginBottom: 'var(--space-4)' }}>
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
            <td className="xls-cell" colSpan={4} style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-brand)' }}>
              종목 분석
            </td>
            <td className="xls-cell" colSpan={2} style={{ textAlign: 'right' }}>
              <EconomicEventBadge onNavigateToCalendar={() => onNavigate?.('economy')} />
            </td>
          </tr>
          <tr className="xls-row" style={{ position: 'relative', zIndex: 30 }}>
            <td
              className="xls-cell"
              colSpan={6}
              style={{
                padding: '8px 10px',
                overflow: 'visible',
                position: 'relative',
                zIndex: 30,
              }}
            >
              <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'nowrap', alignItems: 'center' }}>
                <div style={{ flex: '1 1 0', minWidth: 0 }}>
                  <StockSearchInput
                    value={query}
                    onChange={setQuery}
                    onSelect={handleStockSelect}
                    placeholder="종목 코드(예: 005930) 또는 한글명(예: 삼성전자)"
                    disabled={loading}
                  />
                </div>
                <Button
                  variant="primary"
                  onClick={() => analyze()}
                  disabled={loading || !query.trim()}
                  aria-label="분석"
                  title="분석"
                  style={{ padding: '0 0.75rem', flexShrink: 0 }}
                >
                  {loading
                    ? <span style={{ display: 'inline-block', width: 16, height: 16, border: '2px solid currentColor', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                    : <Search size={16} />}
                </Button>
                <Button
                  variant="secondary"
                  onClick={onShareAnalyze}
                  disabled={loading || !result?.code}
                  aria-label="링크 공유"
                  title="링크 공유"
                  style={{ padding: '0 0.75rem', flexShrink: 0 }}
                >
                  <Link2 size={16} />
                </Button>
                <button
                  type="button"
                  aria-label="검색 도움말"
                  title={'종목 코드(6자리) 또는 종목명으로 검색합니다.\n텔레그램 /analyze 에 대응합니다.'}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '0 var(--space-1)',
                    color: 'var(--color-text-tertiary)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    flexShrink: 0,
                    lineHeight: 1,
                  }}
                >
                  <HelpCircle size={16} />
                </button>
              </div>
            </td>
          </tr>
          {recentSearches.length > 0 && (
            <tr className="xls-row xls-row--even">
              <td className="xls-cell" colSpan={2} style={{ color: 'var(--color-text-secondary)', fontSize: 11, fontWeight: 600 }}>
                최근 조회
              </td>
              <td className="xls-cell" colSpan={4} style={{ padding: '8px 10px' }}>
                <div
                  style={{
                    display: 'flex',
                    gap: 'var(--space-1)',
                    overflowX: 'auto',
                    WebkitOverflowScrolling: 'touch',
                    scrollbarWidth: 'none',
                    msOverflowStyle: 'none',
                    flexWrap: 'nowrap',
                  }}
                >
                  {recentSearches.map(s => (
                    <button
                      key={s.code}
                      className="tag"
                      style={{ flexShrink: 0 }}
                      onClick={() => { setQuery(s.code); void analyze(s.code) }}
                      title={s.code}
                    >
                      {s.name}
                    </button>
                  ))}
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {loading && <div className="card"><Skeleton lines={5} height={14} /></div>}

      {error && (
        <div className="state-error">
          <div className="state-error-title">{error}</div>
        </div>
      )}

      {result && !loading && (
        <div className="card card-lg analyze-sheet__result" id={analyzeCaptureId}>
          <table className="xls-table analyze-sheet__result-head" style={{ width: '100%', tableLayout: 'fixed', marginBottom: 'var(--space-4)' }}>
            <colgroup>
              <col style={{ width: '22%' }} />
              <col style={{ width: '22%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '20%' }} />
            </colgroup>
            <tbody>
              <tr className="xls-row xls-row--even">
                <td className="xls-cell" colSpan={3} style={{ fontSize: 18, fontWeight: 700 }}>
                  {result.name ?? result.code}
                </td>
                <td className="xls-cell" colSpan={2} style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-bold)', fontVariantNumeric: 'tabular-nums' }}>
                    {result.close != null ? formatKrw(result.close) : '—'}
                  </div>
                  {result.change_pct != null && (
                    <div className={result.change_pct > 0 ? 'positive' : result.change_pct < 0 ? 'negative' : 'neutral'}>
                      {result.change_pct > 0 ? '+' : ''}{formatNumber(result.change_pct, 2)}%
                    </div>
                  )}
                </td>
              </tr>
              <tr className="xls-row">
                <td className="xls-cell" colSpan={5} style={{ color: 'var(--color-text-secondary)', fontSize: 11 }}>
                  {result.code} · {result.price_source === 'realtime'
                    ? `실시간 반영${result.price_fetched_at ? ` · ${formatDateTime(result.price_fetched_at)}` : ''}`
                    : '종가 기준'}
                </td>
              </tr>
            </tbody>
          </table>

          {/* ── 일중 범위 바 ── */}
          {result.high != null && result.low != null && (
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-1)' }}>
                <span className="caption">{formatKrw(result.low)}</span>
                <span className="caption" style={{ color: 'var(--color-text-tertiary)' }}>일중 범위</span>
                <span className="caption">{formatKrw(result.high)}</span>
              </div>
              <div style={{
                height: 6,
                background: 'var(--color-border-default)',
                borderRadius: 999,
                position: 'relative',
              }}>
                {priceBarPct != null && (
                  <div style={{
                    position: 'absolute',
                    left: `${Math.max(2, Math.min(98, priceBarPct))}%`,
                    top: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    background: intradayDelta != null
                      ? intradayDelta > 0
                        ? 'var(--color-stock-up)'
                        : intradayDelta < 0
                          ? 'var(--color-stock-down)'
                          : 'var(--color-stock-flat)'
                      : result.change_pct > 0
                      ? 'var(--color-stock-up)'
                      : result.change_pct < 0
                        ? 'var(--color-stock-down)'
                        : 'var(--color-stock-flat)',
                    border: '2px solid var(--color-bg-surface)',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
                  }} />
                )}
              </div>
              <div className="caption muted" style={{ marginTop: 'var(--space-1)' }}>
                원형 색상 기준: 시가 대비 {intradayDelta == null ? '미확인' : intradayDelta > 0 ? '상승(빨강)' : intradayDelta < 0 ? '하락(파랑)' : '보합'}
              </div>
            </div>
          )}

          {/* ── 시장 데이터 ── */}
          <div className="cards-grid cols-2">
            {([
              ['날짜', formatDate(result.date)],
              ['시가', result.open != null ? formatKrw(result.open) : '—'],
              ['고가', result.high != null ? formatKrw(result.high) : '—'],
              ['저가', result.low != null ? formatKrw(result.low) : '—'],
              ['거래량', result.volume != null ? formatNumber(result.volume, 0) : '—'],
              ['시가총액', result.market_cap != null ? formatKrw(result.market_cap) : '—'],
            ] as [string, string][]).map(([label, val]) => (
              <div key={label}>
                <div className="stat-label">{label}</div>
                <div className="stat-value" style={{ fontSize: 'var(--font-size-lg)', color: val === '—' ? 'var(--color-text-disabled)' : undefined }}>{val}</div>
              </div>
            ))}
          </div>

          {DIVIDER}

          {/* ── 투자지표 ── */}
          <div className="title-md" style={{ marginBottom: 'var(--space-2)' }}>투자지표</div>
          <div className="cards-grid cols-3">
            {([
              { label: 'PER', val: result.per != null ? formatNumber(result.per, 2) : '—' },
              { label: 'PBR', val: result.pbr != null ? formatNumber(result.pbr, 2) : '—' },
              {
                label: 'PEG',
                val: result.peg != null ? formatNumber(result.peg, 2) : '—',
                tag: result?.peg_meta?.label ?? null,
                hint:
                  result?.peg_meta?.growthPct != null
                    ? `${result?.peg_meta?.growthBasis === 'net_income_forward'
                      ? '순이익 선행성장률'
                      : result?.peg_meta?.growthBasis === 'op_income'
                      ? '영업이익성장률'
                      : result?.peg_meta?.growthBasis === 'sales'
                        ? '매출성장률'
                        : '순이익성장률'} ${formatNumber(result.peg_meta.growthPct, 2)}% 기반`
                    : '성장률 데이터 부족 시 신뢰도 낮음',
              },
              { label: 'EPS', val: result.eps != null ? formatKrw(result.eps) : '—' },
              { label: 'BPS', val: result.bps != null ? formatKrw(result.bps) : '—' },
              { label: 'ROE', val: result.roe != null ? formatNumber(result.roe, 2) + '%' : '—' },
              { label: '부채비율', val: result.debt_ratio != null ? formatNumber(result.debt_ratio, 2) + '%' : '—' },
            ] as { label: string; val: string; tag?: string | null; hint?: string }[]).map(({ label, val, tag, hint }) => (
              <div key={label}>
                <div className="stat-label" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}>
                  <span>{label}</span>
                  {tag && (
                    <span
                      style={{
                        fontSize: 'var(--font-size-xs)',
                        padding: '1px 6px',
                        borderRadius: 999,
                        background:
                          tag === '실데이터'
                            ? 'var(--color-success-bg)'
                            : tag === '추정치'
                              ? 'var(--color-warning-bg)'
                              : 'var(--color-error-bg)',
                        color:
                          tag === '실데이터'
                            ? 'var(--color-success)'
                            : tag === '추정치'
                              ? 'var(--color-warning)'
                              : 'var(--color-error)',
                      }}
                    >
                      {tag}
                    </span>
                  )}
                </div>
                <div className="stat-value" style={{ fontSize: 'var(--font-size-base)', color: val === '—' ? 'var(--color-text-disabled)' : undefined }}>{val}</div>
                {hint && (
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                    {hint}
                  </div>
                )}
              </div>
            ))}
          </div>
          {result.fundamentals_as_of && (
            <div className="caption" style={{ marginTop: 'var(--space-2)' }}>
              재무 기준일: {formatDate(result.fundamentals_as_of)}
            </div>
          )}

          {DIVIDER}

          {/* ── 수급/기술 ── */}
          <div className="analyze-section-head">
            <div className="analyze-section-head__title">
              <div className="title-md">수급/기술</div>
            </div>
            <button
              className="btn btn-sm analyze-section-head__action"
              type="button"
              onClick={() => setShowExtendedIndicators((v) => !v)}
              aria-pressed={showExtendedIndicators}
            >
              {showExtendedIndicators ? '확장 지표 숨기기' : '확장 지표 보기'}
            </button>
          </div>
          <div className="cards-grid cols-3">
            {([
              result.foreign_ratio != null
                ? ['외국인 보유비율', formatNumber(result.foreign_ratio, 2) + '%']
                : null,
              flowMetricLabel && flow?.personal != null
                ? [`개인 순매수(${flowMetricLabel})`, formatFlowValue(flow.personal, flow?.metric)]
                : null,
              flowMetricLabel && flow?.foreign != null
                ? [`외국인 순매수(${flowMetricLabel})`, formatFlowValue(flow.foreign, flow?.metric)]
                : null,
              flowMetricLabel && flow?.institution != null
                ? [`기관 순매수(${flowMetricLabel})`, formatFlowValue(flow.institution, flow?.metric)]
                : null,
              ['SMA 20', computedSma20 != null ? formatKrw(computedSma20) : '—'],
              ['SMA 50', computedSma50 != null ? formatKrw(computedSma50) : '—'],
              ['SMA 200', computedSma200 != null ? formatKrw(computedSma200) : '—'],
              ['RSI 14', computedRsi14 != null ? formatNumber(computedRsi14, 1) : '—'],
              ...(showExtendedIndicators
                ? ([
                    ['EMA 20', computedEma20 != null ? formatKrw(computedEma20) : '—'],
                    ['EMA 50', computedEma50 != null ? formatKrw(computedEma50) : '—'],
                    ['EMA 200', computedEma200 != null ? formatKrw(computedEma200) : '—'],
                  ] as [string, string][])
                : []),
            ].filter(Boolean) as [string, string][]).map(([label, val]) => (
              <div key={label}>
                <div className="stat-label">{label}</div>
                <div className="stat-value" style={{ fontSize: 'var(--font-size-base)', color: val === '—' ? 'var(--color-text-disabled)' : undefined }}>{val}</div>
              </div>
            ))}
          </div>
          <div className="caption" style={{ marginTop: 'var(--space-2)' }}>
            기술지표 기준일: {result.indicators_as_of ? formatDate(result.indicators_as_of) : '—'}
            {flow?.date ? ` · 수급 기준일: ${formatDate(flow.date)}` : ''}
          </div>

          {/* ── 공매도 / 신용 ── */}
          <div className="title-md" style={{ marginTop: 'var(--space-6)', marginBottom: 'var(--space-3)' }}>공매도 / 신용</div>
          <div className="cards-grid cols-3">
            {([
              {
                label: '신용비율',
                val: creditShort?.creditRatio != null ? formatNumber(creditShort.creditRatio, 2) + '%' : '—',
                hint: '신용잔고 ÷ 상장주식수',
                warn: creditShort?.creditRatio != null ? creditShort.creditRatio > 5 : false,
              },
              {
                label: '공매도 잔고비율',
                val: creditShort?.shortRatio != null ? formatNumber(creditShort.shortRatio, 2) + '%' : '—',
                hint: '공매도 잔고 ÷ 상장주식수',
                warn: creditShort?.shortRatio != null ? creditShort.shortRatio > 1 : false,
              },
              {
                label: '공매도 잔고(주)',
                val: creditShort?.shortBalance != null ? formatNumber(creditShort.shortBalance, 0) : '—',
                hint: '최근 KRX 신고 기준',
                warn: false,
              },
            ] as { label: string; val: string; hint: string; warn: boolean }[]).map(({ label, val, hint, warn }) => (
              <div key={label}>
                <div className="stat-label">{label}</div>
                <div className="stat-value" style={{
                  fontSize: 'var(--font-size-base)',
                  color: val === '—' ? 'var(--color-text-disabled)' : warn ? 'var(--color-error)' : undefined,
                }}>{val}</div>
                <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginTop: 2 }}>{hint}</div>
              </div>
            ))}
          </div>
          <div className="caption" style={{ marginTop: 'var(--space-2)' }}>
            {creditShort?.source === 'db' && `공매도/신용 기준일: ${creditShort.asOf ? formatDate(creditShort.asOf) : '—'}`}
            {creditShort?.source === 'live' && `공매도/신용 조회시각: ${creditShort.fetchedAt ? formatDateTime(creditShort.fetchedAt) : '—'} (실시간 스크래핑)`}
            {creditShort?.source === 'stale' && `공매도/신용 마지막 기준일: ${creditShort.staleAsOf ? formatDate(creditShort.staleAsOf) : '—'} · 오래된 데이터로 분석에서 제외`}
            {creditShort?.source === 'proxy' && '공매도/신용 실데이터 없음 · 프록시 리스크만 반영'}
            {!creditShort && '공매도/신용 데이터 없음'}
          </div>
          {creditShort?.staleReason && (
            <div className="caption" style={{ marginTop: 'var(--space-1)', color: 'var(--color-warning)' }}>
              주의: {creditShort.staleReason}
            </div>
          )}

          {/* ── 캔들 차트 ── */}
          {candles.length > 0 && (
            <>
              {DIVIDER}
              <div className="analyze-section-head" style={{ marginBottom: 'var(--space-2)', alignItems: 'flex-start' }}>
                <div className="analyze-section-head__title">
                  <div className="title-md">가격 차트</div>
                </div>
                <div className="analyze-chart-toolbar">
                  <button
                    className="analyze-chart-toggle"
                    type="button"
                    onClick={() => setShowChartHud((v) => !v)}
                    aria-pressed={showChartHud}
                    title="HUD"
                    data-tone="info"
                    data-active={showChartHud}
                  >
                    <span className="analyze-chart-toggle__icon">
                      <LayoutDashboard size={14} />
                    </span>
                    <span className="analyze-chart-toggle__label">
                      HUD
                    </span>
                  </button>
                  <button
                    className="analyze-chart-toggle"
                    type="button"
                    onClick={() => setShowMaEmaOverlay((v) => !v)}
                    aria-pressed={showMaEmaOverlay}
                    title="EMA21/SMA50/SMA200"
                    data-tone="warning"
                    data-active={showMaEmaOverlay}
                  >
                    <span className="analyze-chart-toggle__icon">
                      <TrendingUp size={14} />
                    </span>
                    <span className="analyze-chart-toggle__label">
                      MA
                    </span>
                  </button>
                  <button
                    className="analyze-chart-toggle"
                    type="button"
                    onClick={() => setShowTradeMarkers((v) => !v)}
                    aria-pressed={showTradeMarkers}
                    title="신호 마커"
                    data-tone="success"
                    data-active={showTradeMarkers}
                  >
                    <span className="analyze-chart-toggle__icon">
                      <Flag size={14} />
                    </span>
                    <span className="analyze-chart-toggle__label">
                      마커
                    </span>
                  </button>
                  <button
                    className="analyze-chart-toggle"
                    type="button"
                    onClick={() => setShowForceLine((v) => !v)}
                    aria-pressed={showForceLine}
                    title="세력선"
                    data-tone="teal"
                    data-active={showForceLine}
                  >
                    <span className="analyze-chart-toggle__icon">
                      <Activity size={14} />
                    </span>
                    <span className="analyze-chart-toggle__label">
                      세력
                    </span>
                  </button>
                </div>
              </div>
              {showChartHud && (
                <div className="cards-grid cols-3" style={{ marginBottom: 'var(--space-3)' }}>
                  {([
                    ['신호', signalText],
                    ['1단계 레짐', regimeLabel(advisor?.twoStage?.regime)],
                    ['2단계 실행', advisor?.twoStage?.actionLabel ?? '—'],
                    ['지지선 (최근 20봉 최저)', chartHud.support != null ? formatKrw(chartHud.support) : '—'],
                    ['저항선 (최근 20봉 최고)', chartHud.resistance != null ? formatKrw(chartHud.resistance) : '—'],
                    ['권장 비중', advisor?.twoStage?.allocationPct != null ? `${formatNumber(advisor.twoStage.allocationPct, 0)}%` : '—'],
                    ['손절', advisor?.stopPrice != null ? formatKrw(advisor.stopPrice) : '—'],
                    ['1차 익절', advisor?.target1 != null ? formatKrw(advisor.target1) : '—'],
                    ['진입구간', advisor?.entryLow != null && advisor?.entryHigh != null ? `${formatKrw(advisor.entryLow)} ~ ${formatKrw(advisor.entryHigh)}` : '—'],
                  ] as [string, string][]).map(([label, val]) => (
                    <div key={label}>
                      <div className="stat-label">{label}</div>
                      <div className="stat-value" style={{ fontSize: 'var(--font-size-base)', color: val === '—' ? 'var(--color-text-disabled)' : undefined }}>{val}</div>
                    </div>
                  ))}
                </div>
              )}
              <CandleChart
                candles={candles}
                entryLow={showChartHud ? advisor?.entryLow : null}
                entryHigh={showChartHud ? advisor?.entryHigh : null}
                stopLoss={showChartHud ? advisor?.stopPrice : null}
                target1={showChartHud ? advisor?.target1 : null}
                tradeSignal={advisor?.status ?? null}
                showMaEmaOverlay={showMaEmaOverlay}
                showTradeMarkers={showTradeMarkers}
                showForceLine={showForceLine}
                support={chartHud?.support ?? null}
                resistance={chartHud?.resistance ?? null}
              />
            </>
          )}

          {/* ── 어드바이저 ── */}
          {advisor && (
            <>
              {DIVIDER}
              <div className="flex-between" style={{ marginBottom: 'var(--space-3)' }}>
                <div className="title-md">Nexora 어드바이저</div>
                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                  {dataValidation.warnings.length > 0 && (
                    <span
                      title={dataValidation.warnings.join('; ')}
                      style={{
                      display: 'inline-block',
                      padding: '0.2rem 0.75rem',
                      borderRadius: 999,
                      fontWeight: 'var(--font-weight-semibold)',
                      fontSize: 'var(--font-size-sm)',
                      background: 'var(--color-warning-bg)',
                      color: 'var(--color-warning)',
                      cursor: 'help',
                    }}>
                      ⚠️ 데이터 검증 필요
                    </span>
                  )}
                  {(Array.isArray(advisor.personalLines) && advisor.personalLines.length > 0) && (
                    <button
                      className="btn btn-sm"
                      type="button"
                      onClick={() => setShowPersonalized((v) => !v)}
                      aria-pressed={showPersonalized}
                      style={{ fontWeight: 'var(--font-weight-semibold)' }}
                    >
                      {showPersonalized ? '👤 MY 숨기기' : '👤 MY'}
                    </button>
                  )}
                </div>
              </div>
              <div className="card" style={{ background: 'var(--color-bg-sunken)' }}>

                {/* 점수 + 프로그레스 바 */}
                <div className="cards-grid cols-3" style={{ marginBottom: 'var(--space-4)' }}>
                  {([
                    ['종합 점수', advisor.finalScore],
                    ['기술 점수', advisor.technicalScore],
                    ['재무 점수', advisor.fundamentalScore],
                  ] as [string, number | null][]).map(([label, score]) => (
                    <div key={label}>
                      <div className="stat-label">{label}</div>
                      <div style={{
                        fontSize: 'var(--font-size-lg)',
                        fontWeight: 'var(--font-weight-bold)',
                        fontVariantNumeric: 'tabular-nums',
                        color: scoreColor(score),
                        marginBottom: 'var(--space-1)',
                      }}>
                        {score != null ? `${formatNumber(score, 1)}점` : '—'}
                      </div>
                      {score != null && (
                        <div style={{ height: 4, background: 'var(--color-border-default)', borderRadius: 999, overflow: 'hidden' }}>
                          <div style={{
                            width: `${Math.max(0, Math.min(100, score))}%`,
                            height: '100%',
                            background: scoreColor(score),
                            borderRadius: 999,
                            transition: 'width 0.4s ease',
                          }} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* 판정 배지 */}
                <div style={{ marginBottom: 'var(--space-3)' }}>
                  <div className="stat-label">판정</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-1)', marginBottom: 'var(--space-1)' }}>
                    <span style={{
                      display: 'inline-block',
                      padding: '0.2rem 0.75rem',
                      borderRadius: 999,
                      fontWeight: 'var(--font-weight-semibold)',
                      fontSize: 'var(--font-size-sm)',
                      ...advisorStatusStyle(advisor.status),
                    }}>
                      {advisor.statusLabel ?? '—'}
                    </span>
                    <span style={{
                      display: 'inline-block',
                      padding: '0.2rem 0.75rem',
                      borderRadius: 999,
                      fontWeight: 'var(--font-weight-semibold)',
                      fontSize: 'var(--font-size-sm)',
                      background: advisor?.twoStage?.regime === 'risk_on'
                        ? 'var(--color-success-bg)'
                        : advisor?.twoStage?.regime === 'risk_off'
                          ? 'var(--color-error-bg)'
                          : 'var(--color-warning-bg)',
                      color: advisor?.twoStage?.regime === 'risk_on'
                        ? 'var(--color-success)'
                        : advisor?.twoStage?.regime === 'risk_off'
                          ? 'var(--color-error)'
                          : 'var(--color-warning)',
                    }}>
                      1단계 {regimeLabel(advisor?.twoStage?.regime)}
                    </span>
                    <span style={{
                      display: 'inline-block',
                      padding: '0.2rem 0.75rem',
                      borderRadius: 999,
                      fontWeight: 'var(--font-weight-semibold)',
                      fontSize: 'var(--font-size-sm)',
                      ...twoStageActionStyle(advisor?.twoStage?.action),
                    }}>
                      2단계 {advisor?.twoStage?.actionLabel ?? '관망'}
                    </span>
                  </div>
                  {advisor.signalReason && <div className="caption" style={{ marginBottom: 'var(--space-1)' }}>신호 근거: {advisor.signalReason}</div>}
                  {advisor?.twoStage?.reason && (
                    <div className="caption" style={{ marginBottom: 'var(--space-1)' }}>
                      합성 근거: {advisor.twoStage.reason} · 권장 비중 {advisor?.twoStage?.allocationPct != null ? `${formatNumber(advisor.twoStage.allocationPct, 0)}%` : '—'}
                    </div>
                  )}
                  {advisor.summary && <div className="caption">{advisor.summary}</div>}
                </div>

                {/* 진입구간 / 손절 / 목표 */}
                <div className="cards-grid cols-2" style={{ marginBottom: 'var(--space-3)' }}>
                  <div style={{
                    background: 'var(--color-success-bg)',
                    border: '1px solid rgba(0,180,147,0.25)',
                    borderRadius: 'var(--radius-md)',
                    padding: 'var(--space-3)',
                  }}>
                    <div className="stat-label" style={{ color: 'var(--color-success)' }}>진입구간</div>
                    <div style={{ fontWeight: 'var(--font-weight-bold)', fontVariantNumeric: 'tabular-nums', fontSize: 'var(--font-size-base)' }}>
                      {advisor.entryLow != null && advisor.entryHigh != null
                        ? `${formatKrw(advisor.entryLow)} ~ ${formatKrw(advisor.entryHigh)}`
                        : '—'}
                    </div>
                  </div>
                  <div style={{
                    background: 'var(--color-error-bg)',
                    border: '1px solid rgba(240,68,82,0.25)',
                    borderRadius: 'var(--radius-md)',
                    padding: 'var(--space-3)',
                  }}>
                    <div className="stat-label" style={{ color: 'var(--color-error)' }}>손절기준</div>
                    <div style={{ fontWeight: 'var(--font-weight-bold)', fontVariantNumeric: 'tabular-nums', fontSize: 'var(--font-size-base)' }}>
                      {advisor.stopPrice != null
                        ? `${formatKrw(advisor.stopPrice)} (${advisor.stopPct != null ? `-${formatNumber(Math.abs(advisor.stopPct * 100), 2)}%` : '—'})`
                        : '—'}
                    </div>
                  </div>
                  <div style={{
                    background: 'var(--color-info-bg)',
                    border: '1px solid rgba(0,96,255,0.15)',
                    borderRadius: 'var(--radius-md)',
                    padding: 'var(--space-3)',
                  }}>
                    <div className="stat-label" style={{ color: 'var(--color-info)' }}>1차 목표</div>
                    <div style={{ fontWeight: 'var(--font-weight-bold)', fontVariantNumeric: 'tabular-nums', fontSize: 'var(--font-size-base)' }}>
                      {advisor.target1 != null
                        ? `${formatKrw(advisor.target1)} (${advisor.target1Pct != null ? `+${formatNumber(advisor.target1Pct * 100, 2)}%` : '—'})`
                        : '—'}
                    </div>
                  </div>
                  <div style={{
                    background: 'var(--color-info-bg)',
                    border: '1px solid rgba(0,96,255,0.15)',
                    borderRadius: 'var(--radius-md)',
                    padding: 'var(--space-3)',
                  }}>
                    <div className="stat-label" style={{ color: 'var(--color-info)' }}>2차 목표</div>
                    <div style={{ fontWeight: 'var(--font-weight-bold)', fontVariantNumeric: 'tabular-nums', fontSize: 'var(--font-size-base)' }}>
                      {advisor.target2 != null
                        ? `${formatKrw(advisor.target2)} (${advisor.target2Pct != null ? `+${formatNumber(advisor.target2Pct * 100, 2)}%` : '—'})`
                        : '—'}
                    </div>
                  </div>
                </div>

                {/* 트레일링 스탑 가이드 */}
                {advisor.entryLow != null && (
                  <div style={{
                    background: 'var(--color-warning-bg, rgba(255,170,0,0.08))',
                    border: '1px solid rgba(200,140,0,0.2)',
                    borderRadius: 'var(--radius-md)',
                    padding: 'var(--space-3)',
                    marginBottom: 'var(--space-2)',
                  }}>
                    <div className="stat-label" style={{ color: 'var(--color-warning-text, #a07000)', marginBottom: 'var(--space-1)' }}>
                      트레일링 스탑 기준 (참고용)
                    </div>
                    {(() => {
                      const baseEntry = advisor.entryLow ?? result.close ?? 0
                      const TRAILING_ARM_PCT = 5   // 활성화 수익률
                      const TRAILING_STOP_PCT = 10 // 고점 대비 이탈 %
                      const trailingArmPrice = baseEntry > 0 ? Math.round(baseEntry * (1 + TRAILING_ARM_PCT / 100)) : null
                      return (
                        <div className="caption" style={{ lineHeight: '1.7' }}>
                          <span>• 진입 후 <strong>+{TRAILING_ARM_PCT}%</strong> 도달 시 트레일링 활성화</span><br />
                          {trailingArmPrice && (
                            <><span style={{ paddingLeft: '1em' }}>→ 활성화 기준가 약 <strong>{formatKrw(trailingArmPrice)}</strong></span><br /></>
                          )}
                          <span>• 이후 고점 대비 <strong>-{TRAILING_STOP_PCT}%</strong> 이탈 시 익절</span><br />
                          <span>• 손절: 진입가(평단) 대비 <strong>-{advisor.stopPct != null ? `${Math.abs(advisor.stopPct * 100).toFixed(1)}%` : '10%'}</strong></span><br />
                          <span style={{ opacity: 0.7 }}>※ 상방은 무제한 — 고점 추적으로 수익 보호. 가상매매 자동사이클에 적용 중.</span>
                        </div>
                      )
                    })()}
                  </div>
                )}

                {/* 판단 근거 */}
                {Array.isArray(advisor.rationale) && advisor.rationale.length > 0 && (
                  <div style={{ marginBottom: 'var(--space-2)' }}>
                    <div className="stat-label">판단 근거</div>
                    {advisor.rationale.map((line: string, i: number) => (
                      <div key={`r-${i}`} className="caption">- {line}</div>
                    ))}
                  </div>
                )}

                {/* 주의 */}
                {Array.isArray(advisor.warnings) && advisor.warnings.length > 0 && (
                  <div style={{ marginBottom: 'var(--space-2)' }}>
                    <div className="stat-label">주의</div>
                    {advisor.warnings.map((line: string, i: number) => (
                      <div key={`w-${i}`} className="caption" style={{ color: 'var(--color-error)' }}>- {line}</div>
                    ))}
                  </div>
                )}

                {/* 내 상황 제안 */}
                {showPersonalized && Array.isArray(advisor.personalLines) && advisor.personalLines.length > 0 && (
                  <div>
                    <div className="stat-label">내 상황 제안</div>
                    {advisor.personalLines.map((line: string, i: number) => (
                      <div key={`p-${i}`} className="caption">- {line}</div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {result.sector && (
            <div className="caption" style={{ marginTop: 'var(--space-4)' }}>섹터: {result.sector}</div>
          )}
        </div>
      )}
      <ShareModal
        open={shareManager.open}
        onClose={shareManager.close}
        url={shareManager.info?.url}
        code={shareManager.info?.code}
        requiresCode={shareManager.requiresCode}
        expiresAt={shareManager.info?.expiresAt}
        shares={shareManager.list}
        loading={shareManager.loading}
        onRefresh={() => { void shareManager.loadList('analyze') }}
        includeAll={shareManager.includeAll}
        onChangeIncludeAll={shareManager.setIncludeAll}
        onRevoke={shareManager.revokeShare}
        revokingId={shareManager.revokingId}
      />
    </section>
  )
}
