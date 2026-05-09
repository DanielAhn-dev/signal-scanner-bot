import React, { useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { formatKrw, formatNumber } from '../../lib/format'
import Button from '../../components/ui/Button'
import Skeleton from '../../components/Skeleton'
import { ErrorState } from '../../components/StateViews'

type MarketRegime = 'strong_bull' | 'bull' | 'neutral' | 'bear' | 'strong_bear'

interface MarketIndex {
  name: string
  price: number
  change: number
  changeRate: number
  source?: string
  fetchedAt?: string
}

interface SectorScore {
  id: string
  name: string
  score: number
  flowF5?: number
  flowI5?: number
}

interface MarketDiagnosis {
  regime: MarketRegime
  riskScore: number
  signals: string[]
  advice: string[]
}

interface MarketOverviewData {
  diagnosis: MarketDiagnosis
  indices: {
    kospi?: MarketIndex
    kosdaq?: MarketIndex
    sp500?: MarketIndex
    nasdaq?: MarketIndex
    dow?: MarketIndex
    vix?: MarketIndex
    usdkrw?: MarketIndex & { code?: string }
    gold?: MarketIndex
    silver?: MarketIndex
    copper?: MarketIndex
    wtiOil?: MarketIndex
    bitcoin?: MarketIndex
    fearGreed?: { score: number; rating: string }
    meta?: { isPartial?: boolean; fetchedAt?: string; missing?: string[] }
  }
  topSectors: SectorScore[]
  nextSectors: SectorScore[]
  regimeLabel: string
  economicPhase: {
    phase: 'normal' | 'high_inflation' | 'deflation' | 'stagflation' | 'unknown'
    label: string
    description: string
    severity: number
    indicators: {
      us10y: number | null
      goldTrend: 'up' | 'down' | 'neutral' | null
      oilTrend: 'up' | 'down' | 'neutral' | null
      usdkrwTrend: 'up' | 'down' | 'neutral' | null
      riskSentiment: 'risk_on' | 'risk_off' | 'neutral'
    }
  }
  globalCorrelation: {
    kospiToSp500Correlation: number | null
    kospiSp500Spread: number | null
    americanFuturesSignal: 'bullish' | 'bearish' | 'neutral'
    usdStrength: 'strengthening' | 'weakening' | 'neutral'
    emergingMarketsPressure: 'high' | 'moderate' | 'low'
  }
  tradingSignal: {
    shouldTrade: boolean
    confidence: number
    recommendation: string
    restrictions: string[]
  }
  fetchedAt: string
}

function fmtKorMoney(n: number): string {
  const eok = Math.round(n / 100_000_000)
  const jo = Math.floor(Math.abs(eok) / 10_000)
  const restEok = Math.abs(eok) % 10_000
  const sign = eok < 0 ? '-' : '+'
  if (jo > 0) {
    if (restEok > 0) return `${sign}${jo}조 ${restEok.toLocaleString('ko-KR')}억`
    return `${sign}${jo}조`
  }
  return `${sign}${Math.abs(eok).toLocaleString('ko-KR')}억`
}

export default function MarketPage() {
  const [data, setData] = useState<MarketOverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandSections, setExpandSections] = useState<Record<string, boolean>>({
    indices: false,
    sectors: false,
    details: false,
  })

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await apiFetch('/api/ui/market-overview', {
        cacheMs: 30_000,
        timeoutMs: 20_000,
        retries: 1,
      })
      setData(result?.data ?? null)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const toggleSection = (key: string) => {
    setExpandSections(prev => ({ ...prev, [key]: !prev[key] }))
  }

  if (error) {
    return (
      <section className="container-app">
        <div className="flex-between mb-4">
          <h1 className="title-xl" style={{ marginBottom: 0 }}>시장 진단</h1>
          <Button variant="secondary" onClick={load} disabled={loading}>
            새로고침
          </Button>
        </div>
        <ErrorState message={error} onRetry={load} />
      </section>
    )
  }

  if (loading || !data) {
    return (
      <section className="container-app">
        <div className="flex-between mb-4">
          <h1 className="title-xl" style={{ marginBottom: 0 }}>시장 진단</h1>
          <Button variant="secondary" onClick={load} disabled={loading}>
            새로고침
          </Button>
        </div>
        <div className="card">
          <Skeleton lines={12} height={14} />
        </div>
      </section>
    )
  }

  const { diagnosis, indices, topSectors, economicPhase, globalCorrelation, tradingSignal } = data
  const signalColor = tradingSignal.shouldTrade ? 'var(--color-stock-up)' : 'var(--color-stock-down)'
  const signalBg = tradingSignal.shouldTrade ? 'rgba(34, 197, 94, 0.08)' : 'rgba(239, 68, 68, 0.08)'

  return (
    <section className="container-app">
      {/* 헤더 */}
      <div className="flex-between mb-6" style={{ gap: 'var(--space-3)' }}>
        <h1 className="title-xl" style={{ marginBottom: 0 }}>시장 진단</h1>
        <Button variant="secondary" onClick={load} disabled={loading} size="sm">
          새로고침
        </Button>
      </div>

      {/* ===== 메인 신호 카드 (토스 스타일) ===== */}
      <div
        style={{
          background: signalBg,
          border: `2px solid ${signalColor}`,
          borderRadius: 'var(--radius-lg)',
          padding: 'var(--space-5)',
          marginBottom: 'var(--space-6)',
        }}
      >
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-2)', letterSpacing: '0.03em' }}>
            현재 매매 신호
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-5)' }}>
            <div style={{ flex: 0 }}>
              <div style={{ fontSize: 48, fontWeight: 700, color: signalColor, lineHeight: 1 }}>
                {tradingSignal.confidence}
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 'var(--space-1)' }}>
                신뢰도 %
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{
                fontSize: 18,
                fontWeight: 600,
                color: 'var(--color-text-primary)',
                lineHeight: 1.4,
                marginBottom: 'var(--space-2)',
              }}>
                {tradingSignal.shouldTrade ? '✅ 매매 진행 가능' : '⛔ 매매 제한'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                {tradingSignal.shouldTrade && diagnosis.riskScore >= 60
                  ? '시장이 열려있으나 주의사항 필수 확인'
                  : tradingSignal.shouldTrade
                    ? '양호한 진입 환경입니다'
                    : '현금 비중을 먼저 확대하세요'}
              </div>
            </div>
          </div>
        </div>

        {/* 구분선 */}
        <div style={{ height: 1, background: 'var(--color-border-default)', marginBottom: 'var(--space-4)' }} />

        {/* 3줄 핵심 지표 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>경제국면</span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-text-primary)' }}>
              {economicPhase.phase === 'stagflation' && '⚠️ 스태그플레이션'}
              {economicPhase.phase === 'high_inflation' && '📈 고인플레이션'}
              {economicPhase.phase === 'deflation' && '📉 디플레이션'}
              {economicPhase.phase === 'normal' && '✅ 정상'}
              {economicPhase.phase === 'unknown' && '❓ 판단중'}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>미국 신호</span>
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color:
                  globalCorrelation.americanFuturesSignal === 'bullish'
                    ? 'var(--color-stock-up)'
                    : globalCorrelation.americanFuturesSignal === 'bearish'
                      ? 'var(--color-stock-down)'
                      : 'var(--color-text-secondary)',
              }}
            >
              {globalCorrelation.americanFuturesSignal === 'bullish' && '🟢 강세'}
              {globalCorrelation.americanFuturesSignal === 'bearish' && '🔴 약세'}
              {globalCorrelation.americanFuturesSignal === 'neutral' && '🟡 중립'}
            </span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>리스크</span>
            <span
              style={{
                fontSize: 13,
                fontWeight: 600,
                color:
                  diagnosis.riskScore >= 70
                    ? 'var(--color-stock-down)'
                    : diagnosis.riskScore >= 40
                      ? 'var(--color-text-secondary)'
                      : 'var(--color-stock-up)',
              }}
            >
              {diagnosis.riskScore >= 80 && '🔴 매우 높음'}
              {diagnosis.riskScore >= 60 && diagnosis.riskScore < 80 && '🔴 높음'}
              {diagnosis.riskScore >= 40 && diagnosis.riskScore < 60 && '🟡 중간'}
              {diagnosis.riskScore < 40 && '🟢 낮음'}
            </span>
          </div>
        </div>

        {/* 주의사항 */}
        {tradingSignal.restrictions.length > 0 && (
          <>
            <div style={{ height: 1, background: 'var(--color-border-default)', margin: 'var(--space-4) 0' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {tradingSignal.restrictions.slice(0, 2).map((r, i) => (
                <div key={i} style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                  ⚠️ {r}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ===== 3개 핵심 메트릭 ===== */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-3)', marginBottom: 'var(--space-6)' }}>
        {/* 경제심각도 */}
        <div style={{
          background: 'var(--color-bg-muted)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-4)',
          border: '1px solid var(--color-border-default)',
        }}>
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-2)', letterSpacing: '0.03em' }}>
            경제심각도
          </div>
          <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 'var(--space-1)' }}>
            {economicPhase.severity}
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
            {economicPhase.severity >= 80 ? '⚠️ 주의' : economicPhase.severity >= 60 ? '🟡 경계' : '✅ 양호'}
          </div>
        </div>

        {/* 한미상관 */}
        <div style={{
          background: 'var(--color-bg-muted)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-4)',
          border: '1px solid var(--color-border-default)',
        }}>
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-2)', letterSpacing: '0.03em' }}>
            KOSPI↔S&P500
          </div>
          <div style={{ fontSize: 32, fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 'var(--space-1)' }}>
            {globalCorrelation.kospiToSp500Correlation !== null
              ? (globalCorrelation.kospiToSp500Correlation * 100).toFixed(0)
              : '—'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
            {globalCorrelation.kospiToSp500Correlation !== null && globalCorrelation.kospiToSp500Correlation > 0.7
              ? '🔗 높은동조'
              : '📊 낮은동조'}
          </div>
        </div>

        {/* 신흥시장압박 */}
        <div style={{
          background: 'var(--color-bg-muted)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-4)',
          border: '1px solid var(--color-border-default)',
        }}>
          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-2)', letterSpacing: '0.03em' }}>
            신흥시장압박
          </div>
          <div style={{
            fontSize: 32,
            fontWeight: 700,
            marginBottom: 'var(--space-1)',
            color:
              globalCorrelation.emergingMarketsPressure === 'high'
                ? 'var(--color-stock-down)'
                : globalCorrelation.emergingMarketsPressure === 'moderate'
                  ? 'var(--color-text-secondary)'
                  : 'var(--color-stock-up)',
          }}>
            {globalCorrelation.emergingMarketsPressure === 'high' && '🔴'}
            {globalCorrelation.emergingMarketsPressure === 'moderate' && '🟡'}
            {globalCorrelation.emergingMarketsPressure === 'low' && '🟢'}
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
            {globalCorrelation.emergingMarketsPressure === 'high' ? '높음' : globalCorrelation.emergingMarketsPressure === 'moderate' ? '중간' : '낮음'}
          </div>
        </div>
      </div>

      {/* ===== 토글 섹션 ===== */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {/* 시장지표 */}
        <div
          className="card"
          style={{ cursor: 'pointer', userSelect: 'none' }}
          onClick={() => toggleSection('indices')}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-3)' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>시장 지표</div>
            <span style={{ fontSize: 14, color: 'var(--color-text-tertiary)' }}>
              {expandSections.indices ? '▼' : '▶'}
            </span>
          </div>

          {expandSections.indices && (
            <>
              <div style={{ height: 1, background: 'var(--color-border-default)' }} />
              <div style={{ padding: 'var(--space-3)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 'var(--space-3)' }}>
                  {[
                    { label: 'KOSPI', index: indices.kospi },
                    { label: 'S&P500', index: indices.sp500 },
                    { label: 'NASDAQ', index: indices.nasdaq },
                    { label: 'VIX', index: indices.vix },
                    { label: 'USD/KRW', index: indices.usdkrw },
                    { label: '금', index: indices.gold },
                  ]
                    .filter(({ index }) => index)
                    .map(({ label, index }) => (
                      <div key={label} style={{ fontSize: 12 }}>
                        <div style={{ color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-1)' }}>{label}</div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>
                          {index!.price.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </div>
                        <div
                          style={{
                            color: index!.changeRate >= 0 ? 'var(--color-stock-up)' : 'var(--color-stock-down)',
                            fontSize: 11,
                            marginTop: 'var(--space-1)',
                            fontWeight: 500,
                          }}
                        >
                          {index!.changeRate >= 0 ? '▲' : '▼'} {Math.abs(index!.changeRate).toFixed(1)}%
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* 섹터분석 */}
        {topSectors.length > 0 && (
          <div
            className="card"
            style={{ cursor: 'pointer', userSelect: 'none' }}
            onClick={() => toggleSection('sectors')}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-3)' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>주도 섹터</div>
              <span style={{ fontSize: 14, color: 'var(--color-text-tertiary)' }}>
                {expandSections.sectors ? '▼' : '▶'}
              </span>
            </div>

            {expandSections.sectors && (
              <>
                <div style={{ height: 1, background: 'var(--color-border-default)' }} />
                <div style={{ padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  {topSectors.slice(0, 3).map((s) => {
                    const scorePercent = Math.min(100, (s.score / 100) * 100)
                    return (
                      <div key={s.id}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'var(--space-1)' }}>
                          <div style={{ fontSize: 12, fontWeight: 600 }}>{s.name}</div>
                          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-text-secondary)' }}>{Math.round(s.score)}점</div>
                        </div>
                        <div style={{ height: 4, background: 'var(--color-border-default)', borderRadius: 2, overflow: 'hidden' }}>
                          <div
                            style={{
                              width: `${scorePercent}%`,
                              height: '100%',
                              background: 'var(--color-brand)',
                            }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* 상세정보 */}
        <div
          className="card"
          style={{ cursor: 'pointer', userSelect: 'none' }}
          onClick={() => toggleSection('details')}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-3)' }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>상세 정보</div>
            <span style={{ fontSize: 14, color: 'var(--color-text-tertiary)' }}>
              {expandSections.details ? '▼' : '▶'}
            </span>
          </div>

          {expandSections.details && (
            <>
              <div style={{ height: 1, background: 'var(--color-border-default)' }} />
              <div style={{ padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', fontSize: 12 }}>
                {/* 경제국면 설명 */}
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 'var(--space-2)', color: 'var(--color-text-primary)' }}>
                    경제 국면
                  </div>
                  <div style={{ color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
                    {economicPhase.description}
                  </div>
                </div>

                {/* 진단신호 */}
                {diagnosis.signals.length > 0 && (
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 'var(--space-2)', color: 'var(--color-text-primary)' }}>
                      진단 신호
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                      {diagnosis.signals.slice(0, 3).map((sig, i) => (
                        <div key={i} style={{ color: 'var(--color-text-secondary)' }}>
                          • {sig}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 투자전략 */}
                {diagnosis.advice.length > 0 && (
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 'var(--space-2)', color: 'var(--color-text-primary)' }}>
                      투자 전략
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                      {diagnosis.advice.slice(0, 3).map((adv, i) => (
                        <div key={i} style={{ color: 'var(--color-text-secondary)' }}>
                          • {adv}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
