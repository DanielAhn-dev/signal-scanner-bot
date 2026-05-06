import React, { useState, useRef, useEffect } from 'react'
import { apiFetch } from '../../lib/api'
import { formatKrw, formatNumber } from '../../lib/format'
import { getStocks, type StockItem } from '../../lib/stockCache'
import { getCurrentUserChatId } from '../../lib/userContext'
import Button from '../../components/ui/Button'
import Skeleton from '../../components/Skeleton'
import StockSearchInput from '../../components/StockSearchInput'
import ShareButtons from '../../components/ShareButtons'

export default function AnalyzePage() {
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<any | null>(null)
  const [flow, setFlow] = useState<any | null>(null)
  const [advisor, setAdvisor] = useState<any | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [quickStocks, setQuickStocks] = useState<Array<{ code: string; name: string }>>([])
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // 인기 종목 정보 로드
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
        // 로드 실패 시 코드만 표시
        setQuickStocks([])
      }
    }
    void load()
  }, [])

  const analyze = async (code?: string) => {
    const q = code ?? query.trim()
    if (!q) return
    
    setLoading(true)
    setError(null)
    setResult(null)
    setFlow(null)
    setAdvisor(null)
    
    try {
      const chatId = getCurrentUserChatId()
      const chatQs = chatId ? `&chat_id=${encodeURIComponent(chatId)}` : ''
      const res = await apiFetch(`/api/ui/stock-latest?code=${encodeURIComponent(q)}${chatQs}`, { cacheMs: 10_000 })
      if (res?.profile || res?.latest) {
        // profile과 latest 병합
        setResult({
          ...res.profile,
          ...res.latest,
        })
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

  return (
    <section className="container-app">
      <h1 className="title-xl">종목 분석</h1>

      <div className="card mb-4">
        <div className="muted mb-4" style={{ marginBottom: 'var(--space-3)' }}>
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
            // 로드 실패 시 코드만 표시
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
          <div className="flex-between mb-4">
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

          {result.close != null && (
            <div style={{ marginBottom: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
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

          <div className="cards-grid cols-2">
            {[
              ['날짜', formatDate(result.date)],
              ['시가', result.open != null ? formatKrw(result.open) : '—'],
              ['고가', result.high != null ? formatKrw(result.high) : '—'],
              ['저가', result.low != null ? formatKrw(result.low) : '—'],
              ['거래량', result.volume != null ? formatNumber(result.volume, 0) : '—'],
              ['시가총액', result.market_cap != null ? formatKrw(result.market_cap) : '—'],
            ].map(([label, val]) => (
              <div key={label as string}>
                <div className="stat-label">{label}</div>
                <div className="stat-value" style={{ fontSize: 'var(--font-size-lg)' }}>{val}</div>
              </div>
            ))}
          </div>

          <>
            <div className="title-md" style={{ marginTop: 'var(--space-4)', marginBottom: 'var(--space-2)' }}>투자지표</div>
            <div className="cards-grid cols-3">
              {[
                ['PER', result.per != null ? formatNumber(result.per, 2) : '—'],
                ['PBR', result.pbr != null ? formatNumber(result.pbr, 2) : '—'],
                ['EPS', result.eps != null ? formatKrw(result.eps) : '—'],
                ['BPS', result.bps != null ? formatKrw(result.bps) : '—'],
                ['ROE', result.roe != null ? formatNumber(result.roe, 2) + '%' : '—'],
                ['부채비율', result.debt_ratio != null ? formatNumber(result.debt_ratio, 2) + '%' : '—'],
              ].map(([label, val]) => (
                <div key={label as string}>
                  <div className="stat-label">{label}</div>
                  <div className="stat-value" style={{ fontSize: 'var(--font-size-base)' }}>{val}</div>
                </div>
              ))}
            </div>
          </>

          <>
            <div className="title-md" style={{ marginTop: 'var(--space-4)', marginBottom: 'var(--space-2)' }}>수급/기술</div>
            <div className="cards-grid cols-3">
              {[
                ['외국인 보유비율', result.foreign_ratio != null ? formatNumber(result.foreign_ratio, 2) + '%' : '—'],
                ['외국인 순매수', flow?.foreign != null ? formatNumber(flow.foreign, 0) : '—'],
                ['기관 순매수', flow?.institution != null ? formatNumber(flow.institution, 0) : '—'],
                ['SMA 20', result.sma20 != null ? formatKrw(result.sma20) : '—'],
                ['SMA 50', result.sma50 != null ? formatKrw(result.sma50) : '—'],
                ['RSI 14', result.rsi14 != null ? formatNumber(result.rsi14, 2) : '—'],
              ].map(([label, val]) => (
                <div key={label as string}>
                  <div className="stat-label">{label}</div>
                  <div className="stat-value" style={{ fontSize: 'var(--font-size-base)' }}>{val}</div>
                </div>
              ))}
            </div>
          </>

          {advisor && (
            <>
              <div className="title-md" style={{ marginTop: 'var(--space-4)', marginBottom: 'var(--space-2)' }}>Signal Scanner 어드바이저</div>
              <div className="card" style={{ background: 'var(--color-bg-sunken)' }}>
                <div className="cards-grid cols-3" style={{ marginBottom: 'var(--space-3)' }}>
                  {[
                    ['종합 점수', advisor.finalScore != null ? `${formatNumber(advisor.finalScore, 1)}점` : '—'],
                    ['기술 점수', advisor.technicalScore != null ? `${formatNumber(advisor.technicalScore, 1)}점` : '—'],
                    ['재무 점수', advisor.fundamentalScore != null ? `${formatNumber(advisor.fundamentalScore, 1)}점` : '—'],
                  ].map(([label, val]) => (
                    <div key={label as string}>
                      <div className="stat-label">{label}</div>
                      <div className="stat-value" style={{ fontSize: 'var(--font-size-base)' }}>{val}</div>
                    </div>
                  ))}
                </div>

                <div className="stat-label">판정</div>
                <div className="title-md" style={{ marginBottom: 'var(--space-1)' }}>{advisor.statusLabel ?? '—'}</div>
                <div className="caption" style={{ marginBottom: 'var(--space-3)' }}>{advisor.summary ?? '—'}</div>

                <div className="cards-grid cols-2" style={{ marginBottom: 'var(--space-3)' }}>
                  {[
                    ['진입구간', advisor.entryLow != null && advisor.entryHigh != null ? `${formatKrw(advisor.entryLow)} ~ ${formatKrw(advisor.entryHigh)}` : '—'],
                    ['손절기준', advisor.stopPrice != null ? `${formatKrw(advisor.stopPrice)} (${advisor.stopPct != null ? `-${formatNumber(Math.abs(advisor.stopPct * 100), 2)}%` : '—'})` : '—'],
                    ['1차 목표', advisor.target1 != null ? `${formatKrw(advisor.target1)} (${advisor.target1Pct != null ? `+${formatNumber(advisor.target1Pct * 100, 2)}%` : '—'})` : '—'],
                    ['2차 목표', advisor.target2 != null ? `${formatKrw(advisor.target2)} (${advisor.target2Pct != null ? `+${formatNumber(advisor.target2Pct * 100, 2)}%` : '—'})` : '—'],
                  ].map(([label, val]) => (
                    <div key={label as string}>
                      <div className="stat-label">{label}</div>
                      <div className="stat-value" style={{ fontSize: 'var(--font-size-base)' }}>{val}</div>
                    </div>
                  ))}
                </div>

                {Array.isArray(advisor.rationale) && advisor.rationale.length > 0 && (
                  <div style={{ marginBottom: 'var(--space-2)' }}>
                    <div className="stat-label">판단 근거</div>
                    {advisor.rationale.map((line: string, i: number) => (
                      <div key={`r-${i}`} className="caption">- {line}</div>
                    ))}
                  </div>
                )}

                {Array.isArray(advisor.warnings) && advisor.warnings.length > 0 && (
                  <div style={{ marginBottom: 'var(--space-2)' }}>
                    <div className="stat-label">주의</div>
                    {advisor.warnings.map((line: string, i: number) => (
                      <div key={`w-${i}`} className="caption" style={{ color: 'var(--color-error)' }}>- {line}</div>
                    ))}
                  </div>
                )}

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
            <div className="mt-4 caption">섹터: {result.sector}</div>
          )}
        </div>
      )}
    </section>
  )
}
