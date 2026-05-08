import React, { useState, useRef, useEffect, useMemo } from 'react'
import { apiFetch } from '../../lib/api'
import { formatKrw, formatNumber } from '../../lib/format'
import { getStocks, type StockItem } from '../../lib/stockCache'
import { getCurrentUserChatId } from '../../lib/userContext'
import Button from '../../components/ui/Button'
import Skeleton from '../../components/Skeleton'
import StockSearchInput from '../../components/StockSearchInput'
import ShareButtons from '../../components/ShareButtons'

function computeSMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null
  return closes.slice(0, period).reduce((a, b) => a + b, 0) / period
}

function computeRSI(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null
  const changes: number[] = []
  for (let i = 0; i < period; i++) changes.push(closes[i] - closes[i + 1])
  const avgGain = changes.reduce((s, c) => s + (c > 0 ? c : 0), 0) / period
  const avgLoss = changes.reduce((s, c) => s + (c < 0 ? -c : 0), 0) / period
  if (avgLoss === 0) return 100
  return 100 - 100 / (1 + avgGain / avgLoss)
}

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

const DIVIDER = (
  <div style={{ borderTop: '1px solid var(--color-border-default)', margin: 'var(--space-4) 0' }} />
)

export default function AnalyzePage() {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<any | null>(null)
  const [series, setSeries] = useState<any[]>([])
  const [flow, setFlow] = useState<any | null>(null)
  const [advisor, setAdvisor] = useState<any | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [quickStocks, setQuickStocks] = useState<Array<{ code: string; name: string }>>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const all = await getStocks()
        const codes = ['005930', '000660', '035420', '051910', '207940']
        const stocks = codes
          .map(code => all.find(s => s.code === code))
          .filter(Boolean)
          .map(s => ({ code: s!.code, name: s!.name }))
        setQuickStocks(stocks)
      } catch {
        setQuickStocks([])
      }
    }
    void load()
  }, [])

  const closes = useMemo(
    () => series.map((r: any) => r.close).filter((v: any) => typeof v === 'number') as number[],
    [series],
  )

  const computedSma20 = useMemo(
    () => (result?.sma20 != null ? result.sma20 : computeSMA(closes, 20)),
    [result, closes],
  )
  const computedSma50 = useMemo(
    () => (result?.sma50 != null ? result.sma50 : computeSMA(closes, 50)),
    [result, closes],
  )
  const computedRsi14 = useMemo(
    () => (result?.rsi14 != null ? result.rsi14 : computeRSI(closes, 14)),
    [result, closes],
  )

  const analyze = async (code?: string) => {
    const q = code ?? query.trim()
    if (!q) return

    setLoading(true)
    setError(null)
    setResult(null)
    setFlow(null)
    setAdvisor(null)
    setSeries([])

    try {
      const chatId = getCurrentUserChatId()
      const chatQs = chatId ? `&chat_id=${encodeURIComponent(chatId)}` : ''
      const res = await apiFetch(`/api/ui/stock-latest?code=${encodeURIComponent(q)}${chatQs}`, { cacheMs: 10_000 })
      if (res?.profile || res?.latest) {
        setResult({ ...res.profile, ...res.latest })
        setSeries(res?.data ?? [])
        setFlow(res?.flow ?? null)
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

  const handleStockSelect = (stock: StockItem) => {
    analyze(stock.code)
  }

  useEffect(() => {
    try {
      const pending = sessionStorage.getItem('analyze_pending_code')
      if (pending) {
        sessionStorage.removeItem('analyze_pending_code')
        setQuery(pending)
        void analyze(pending)
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

  const priceBarPct =
    result?.high != null && result?.low != null && result?.high !== result?.low
      ? ((result.close - result.low) / (result.high - result.low)) * 100
      : null

  return (
    <section className="container-app">
      <h1 className="title-xl">종목 분석</h1>

      <div className="card mb-4">
        <div className="muted" style={{ marginBottom: 'var(--space-3)' }}>
          종목 코드(6자리) 또는 종목명으로 검색합니다. 텔레그램 <code>/analyze</code> 에 대응합니다.
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <StockSearchInput
            value={query}
            onChange={setQuery}
            onSelect={handleStockSelect}
            placeholder="종목 코드(예: 005930) 또는 한글명(예: 삼성전자)"
            disabled={loading}
          />
          <Button variant="primary" onClick={() => analyze()} disabled={loading || !query.trim()}>
            {loading ? '조회 중…' : '분석'}
          </Button>
        </div>
        <div className="tag-list" style={{ marginTop: 'var(--space-3)' }}>
          {quickStocks.length > 0 ? (
            quickStocks.map(s => (
              <button key={s.code} className="tag" onClick={() => { setQuery(s.code); analyze(s.code) }} title={s.code}>
                {s.name}
              </button>
            ))
          ) : (
            ['005930', '000660', '035420', '051910', '207940'].map(c => (
              <button key={c} className="tag" onClick={() => { setQuery(c); analyze(c) }}>{c}</button>
            ))
          )}
        </div>
      </div>

      {loading && <div className="card"><Skeleton lines={5} height={14} /></div>}

      {error && (
        <div className="state-error">
          <div className="state-error-title">{error}</div>
        </div>
      )}

      {result && !loading && (
        <div className="card card-lg">

          {/* ── 헤더: 종목명 + 현재가 ── */}
          <div className="flex-between" style={{ marginBottom: 'var(--space-3)' }}>
            <div>
              <div className="title-lg">{result.name ?? result.code}</div>
              <div className="caption">{result.code}</div>
            </div>
            {result.close != null && (
              <div className="text-right">
                <div style={{ fontSize: 'var(--font-size-2xl)', fontWeight: 'var(--font-weight-bold)', fontVariantNumeric: 'tabular-nums' }}>
                  {formatKrw(result.close)}
                </div>
                {result.change_pct != null && (
                  <div className={result.change_pct > 0 ? 'positive' : result.change_pct < 0 ? 'negative' : 'neutral'}>
                    {result.change_pct > 0 ? '+' : ''}{formatNumber(result.change_pct, 2)}%
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 공유 버튼 */}
          {result.close != null && (
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <ShareButtons
                data={{
                  title: result.name || result.code,
                  code: result.code,
                  price: result.close,
                  changePct: result.change_pct,
                  url: typeof window !== 'undefined' ? window.location.href : '',
                }}
                variant="button"
                showLabel
              />
            </div>
          )}

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
                    background: result.change_pct > 0
                      ? 'var(--color-stock-up)'
                      : result.change_pct < 0
                        ? 'var(--color-stock-down)'
                        : 'var(--color-stock-flat)',
                    border: '2px solid var(--color-bg-surface)',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
                  }} />
                )}
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
              ['PER', result.per != null ? formatNumber(result.per, 2) : '—'],
              ['PBR', result.pbr != null ? formatNumber(result.pbr, 2) : '—'],
              ['EPS', result.eps != null ? formatKrw(result.eps) : '—'],
              ['BPS', result.bps != null ? formatKrw(result.bps) : '—'],
              ['ROE', result.roe != null ? formatNumber(result.roe, 2) + '%' : '—'],
              ['부채비율', result.debt_ratio != null ? formatNumber(result.debt_ratio, 2) + '%' : '—'],
            ] as [string, string][]).map(([label, val]) => (
              <div key={label}>
                <div className="stat-label">{label}</div>
                <div className="stat-value" style={{ fontSize: 'var(--font-size-base)', color: val === '—' ? 'var(--color-text-disabled)' : undefined }}>{val}</div>
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
          <div className="title-md" style={{ marginBottom: 'var(--space-2)' }}>수급/기술</div>
          <div className="cards-grid cols-3">
            {([
              ['외국인 보유비율', result.foreign_ratio != null ? formatNumber(result.foreign_ratio, 2) + '%' : '—'],
              ['외국인 순매수', flow?.foreign != null ? formatNumber(flow.foreign, 0) : '—'],
              ['기관 순매수', flow?.institution != null ? formatNumber(flow.institution, 0) : '—'],
              ['SMA 20', computedSma20 != null ? formatKrw(computedSma20) : '—'],
              ['SMA 50', computedSma50 != null ? formatKrw(computedSma50) : '—'],
              ['RSI 14', computedRsi14 != null ? formatNumber(computedRsi14, 1) : '—'],
            ] as [string, string][]).map(([label, val]) => (
              <div key={label}>
                <div className="stat-label">{label}</div>
                <div className="stat-value" style={{ fontSize: 'var(--font-size-base)', color: val === '—' ? 'var(--color-text-disabled)' : undefined }}>{val}</div>
              </div>
            ))}
          </div>

          {/* ── 어드바이저 ── */}
          {advisor && (
            <>
              {DIVIDER}
              <div className="title-md" style={{ marginBottom: 'var(--space-3)' }}>Signal Scanner 어드바이저</div>
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
                  </div>
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
                {Array.isArray(advisor.personalLines) && advisor.personalLines.length > 0 && (
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
    </section>
  )
}
