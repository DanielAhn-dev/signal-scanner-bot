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

const regimeColors: Record<MarketRegime, { bg: string; text: string; badge: string }> = {
  strong_bull: { bg: 'var(--color-stock-up)', text: '#fff', badge: '🟢' },
  bull: { bg: 'var(--color-stock-up)', text: '#fff', badge: '🟢' },
  neutral: { bg: 'var(--color-border-default)', text: 'var(--color-text-primary)', badge: '🟡' },
  bear: { bg: 'var(--color-stock-down)', text: '#fff', badge: '🔴' },
  strong_bear: { bg: 'var(--color-stock-down)', text: '#fff', badge: '🔴' },
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
          <Skeleton lines={8} height={14} />
        </div>
      </section>
    )
  }

  const { diagnosis, indices, topSectors, nextSectors, regimeLabel } = data
  const colors = regimeColors[diagnosis.regime]

  return (
    <section className="container-app">
      <div className="flex-between mb-4">
        <h1 className="title-xl" style={{ marginBottom: 0 }}>시장 진단</h1>
        <Button variant="secondary" onClick={load} disabled={loading}>
          새로고침
        </Button>
      </div>

      {/* 시장 국면 & 리스크 지수 */}
      <div className="card mb-4" style={{ padding: 'var(--space-5)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>현재 국면</div>
            <div
              style={{
                display: 'inline-block',
                padding: 'var(--space-2) var(--space-3)',
                borderRadius: 'var(--radius-md)',
                background: colors.bg,
                color: colors.text,
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              {colors.badge} {regimeLabel}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>리스크 지수</div>
            <div
              style={{
                fontSize: 28,
                fontWeight: 700,
                color: diagnosis.riskScore >= 70 ? 'var(--color-stock-down)' : diagnosis.riskScore >= 40 ? 'var(--color-text-secondary)' : 'var(--color-stock-up)',
              }}
            >
              {diagnosis.riskScore}
              <span style={{ fontSize: 16, marginLeft: 4 }}>/100</span>
            </div>
          </div>
        </div>
      </div>

      {/* 경제 국면 진단 */}
      <div
        className="card mb-4"
        style={{
          borderColor: data.economicPhase.phase === 'stagflation' ? 'var(--color-stock-down)' : 
                       data.economicPhase.phase === 'high_inflation' ? '#f97316' :
                       data.economicPhase.phase === 'deflation' ? 'var(--color-stock-down)' :
                       'var(--color-border-default)',
          borderWidth: data.economicPhase.phase !== 'normal' && data.economicPhase.phase !== 'unknown' ? 2 : 1,
          background: data.economicPhase.phase === 'stagflation' ? 'rgba(239, 68, 68, 0.05)' :
                     data.economicPhase.phase === 'high_inflation' ? 'rgba(249, 115, 22, 0.05)' :
                     data.economicPhase.phase === 'deflation' ? 'rgba(239, 68, 68, 0.05)' :
                     undefined,
        }}
      >
        <div className="section-title mb-3">경제 국면 진단</div>
        <div style={{ marginBottom: 'var(--space-3)' }}>
          <div style={{
            display: 'inline-block',
            padding: 'var(--space-2) var(--space-3)',
            borderRadius: 'var(--radius-md)',
            background: data.economicPhase.phase === 'stagflation' ? 'rgba(239, 68, 68, 0.2)' :
                       data.economicPhase.phase === 'high_inflation' ? 'rgba(249, 115, 22, 0.2)' :
                       data.economicPhase.phase === 'deflation' ? 'rgba(239, 68, 68, 0.2)' :
                       'var(--color-bg-muted)',
            fontSize: 14,
            fontWeight: 600,
          }}>
            {data.economicPhase.phase === 'stagflation' && '⚠️ 스태그플레이션'}
            {data.economicPhase.phase === 'high_inflation' && '📈 고인플레이션'}
            {data.economicPhase.phase === 'deflation' && '📉 디플레이션 우려'}
            {data.economicPhase.phase === 'normal' && '✅ 정상 국면'}
            {data.economicPhase.phase === 'unknown' && '❓ 판단 어려움'}
          </div>
        </div>
        
        <div style={{ marginBottom: 'var(--space-3)', lineHeight: 1.8 }}>
          <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: 0 }}>
            {data.economicPhase.description}
          </p>
        </div>

        {/* 경제 지표 */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
          gap: 'var(--space-2)',
          paddingTop: 'var(--space-3)',
          borderTop: '1px solid var(--color-border-default)',
        }}>
          <div>
            <div className="caption" style={{ marginBottom: 4 }}>US 10Y</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              {data.economicPhase.indicators.us10y ? data.economicPhase.indicators.us10y.toFixed(2) + '%' : '—'}
            </div>
            <div className="caption" style={{ marginTop: 2, color: 'var(--color-text-tertiary)' }}>
              {data.economicPhase.indicators.us10y ? (data.economicPhase.indicators.us10y >= 4.5 ? '고금리' : '적정') : '—'}
            </div>
          </div>
          <div>
            <div className="caption" style={{ marginBottom: 4 }}>금 추세</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              {data.economicPhase.indicators.goldTrend === 'up' ? '📈 상승' :
               data.economicPhase.indicators.goldTrend === 'down' ? '📉 하락' :
               '➡️ 중립'}
            </div>
          </div>
          <div>
            <div className="caption" style={{ marginBottom: 4 }}>유가 추세</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              {data.economicPhase.indicators.oilTrend === 'up' ? '📈 상승' :
               data.economicPhase.indicators.oilTrend === 'down' ? '📉 하락' :
               '➡️ 중립'}
            </div>
          </div>
          <div>
            <div className="caption" style={{ marginBottom: 4 }}>위험심리</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>
              {data.economicPhase.indicators.riskSentiment === 'risk_on' ? '🟢 On' :
               data.economicPhase.indicators.riskSentiment === 'risk_off' ? '🔴 Off' :
               '🟡 중립'}
            </div>
          </div>
        </div>
      </div>

      {/* 글로벌 영향도 분석 */}
      <div className="card mb-4">
        <div className="section-title mb-3">글로벌 영향도 분석 (한국 vs 미국)</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 'var(--space-3)' }}>
          <div style={{
            padding: 'var(--space-3)',
            background: 'var(--color-bg-muted)',
            borderRadius: 'var(--radius-sm)',
          }}>
            <div className="caption">KOSPI ↔️ S&P500</div>
            <div style={{ fontSize: 18, fontWeight: 700, marginTop: 4, color: 'var(--color-brand)' }}>
              {data.globalCorrelation.kospiToSp500Correlation !== null 
                ? (data.globalCorrelation.kospiToSp500Correlation * 100).toFixed(0) + '%'
                : '—'}
            </div>
            <div className="caption" style={{ marginTop: 6, color: 'var(--color-text-secondary)' }}>
              {data.globalCorrelation.kospiToSp500Correlation !== null
                ? data.globalCorrelation.kospiToSp500Correlation > 0.7
                  ? '높은 동조도'
                  : '낮은 동조도'
                : '분석 불가'}
            </div>
          </div>

          <div style={{
            padding: 'var(--space-3)',
            background: 'var(--color-bg-muted)',
            borderRadius: 'var(--radius-sm)',
          }}>
            <div className="caption">미국 선물 신호</div>
            <div style={{
              fontSize: 16,
              fontWeight: 600,
              marginTop: 4,
              color: data.globalCorrelation.americanFuturesSignal === 'bullish' ? 'var(--color-stock-up)' :
                     data.globalCorrelation.americanFuturesSignal === 'bearish' ? 'var(--color-stock-down)' :
                     'var(--color-text-secondary)',
            }}>
              {data.globalCorrelation.americanFuturesSignal === 'bullish' ? '🟢 강세' :
               data.globalCorrelation.americanFuturesSignal === 'bearish' ? '🔴 약세' :
               '🟡 중립'}
            </div>
            <div className="caption" style={{ marginTop: 6, color: 'var(--color-text-secondary)' }}>
              한국 증시 영향도
            </div>
          </div>

          <div style={{
            padding: 'var(--space-3)',
            background: 'var(--color-bg-muted)',
            borderRadius: 'var(--radius-sm)',
          }}>
            <div className="caption">달러 강도</div>
            <div style={{
              fontSize: 16,
              fontWeight: 600,
              marginTop: 4,
              color: data.globalCorrelation.usdStrength === 'strengthening' ? 'var(--color-stock-up)' :
                     data.globalCorrelation.usdStrength === 'weakening' ? 'var(--color-stock-down)' :
                     'var(--color-text-secondary)',
            }}>
              {data.globalCorrelation.usdStrength === 'strengthening' ? '📈 강달러' :
               data.globalCorrelation.usdStrength === 'weakening' ? '📉 약달러' :
               '➡️ 중립'}
            </div>
            <div className="caption" style={{ marginTop: 6, color: 'var(--color-text-secondary)' }}>
              신흥시장 압박
            </div>
          </div>

          <div style={{
            padding: 'var(--space-3)',
            background: 'var(--color-bg-muted)',
            borderRadius: 'var(--radius-sm)',
          }}>
            <div className="caption">신흥시장 압박</div>
            <div style={{
              fontSize: 16,
              fontWeight: 600,
              marginTop: 4,
              color: data.globalCorrelation.emergingMarketsPressure === 'high' ? 'var(--color-stock-down)' :
                     data.globalCorrelation.emergingMarketsPressure === 'moderate' ? 'var(--color-text-secondary)' :
                     'var(--color-stock-up)',
            }}>
              {data.globalCorrelation.emergingMarketsPressure === 'high' ? '🔴 높음' :
               data.globalCorrelation.emergingMarketsPressure === 'moderate' ? '🟡 중간' :
               '🟢 낮음'}
            </div>
            <div className="caption" style={{ marginTop: 6, color: 'var(--color-text-secondary)' }}>
              외국인 이탈 가능성
            </div>
          </div>
        </div>
      </div>

      {/* 거래 신호 & 매매 판단 */}
      <div
        className="card mb-4"
        style={{
          borderColor: data.tradingSignal.shouldTrade ? 'var(--color-stock-up)' : 'var(--color-stock-down)',
          borderWidth: 2,
          background: data.tradingSignal.shouldTrade ? 'rgba(34, 197, 94, 0.05)' : 'rgba(239, 68, 68, 0.05)',
        }}
      >
        <div className="section-title mb-3" style={{
          color: data.tradingSignal.shouldTrade ? 'var(--color-stock-up)' : 'var(--color-stock-down)',
        }}>
          {data.tradingSignal.shouldTrade ? '✅ 거래 신호' : '⛔ 거래 신호'}
        </div>
        
        <div style={{
          padding: 'var(--space-3)',
          background: data.tradingSignal.shouldTrade ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
          borderRadius: 'var(--radius-md)',
          marginBottom: 'var(--space-3)',
          borderLeft: '4px solid ' + (data.tradingSignal.shouldTrade ? 'var(--color-stock-up)' : 'var(--color-stock-down)'),
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>
            신뢰도: {data.tradingSignal.confidence}%
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--color-text-secondary)' }}>
            {data.tradingSignal.recommendation}
          </div>
        </div>

        {/* 제약사항 */}
        {data.tradingSignal.restrictions.length > 0 && (
          <div>
            <div className="caption" style={{ marginBottom: 'var(--space-2)' }}>주의사항:</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {data.tradingSignal.restrictions.map((restriction, i) => (
                <div
                  key={i}
                  style={{
                    padding: 'var(--space-2)',
                    background: 'var(--color-bg-muted)',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: 12,
                    borderLeft: '3px solid var(--color-stock-down)',
                  }}
                >
                  {restriction}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 글로벌 지표 */}
      <div className="card mb-4">
        <div className="section-title mb-3">글로벌 지표</div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 'var(--space-3)',
          }}
        >
          {[
            { label: 'KOSPI', index: indices.kospi },
            { label: 'KOSDAQ', index: indices.kosdaq },
            { label: 'S&P500', index: indices.sp500 },
            { label: 'NASDAQ', index: indices.nasdaq },
            { label: 'DOW', index: indices.dow },
            { label: 'VIX', index: indices.vix },
            { label: 'USD/KRW', index: indices.usdkrw },
          ]
            .filter(({ index }) => index)
            .map(({ label, index }) => (
              <div key={label}>
                <div className="caption" style={{ marginBottom: 4 }}>
                  {label}
                </div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{index!.price.toLocaleString()}</div>
                <div
                  style={{
                    fontSize: 12,
                    color: index!.changeRate >= 0 ? 'var(--color-stock-up)' : 'var(--color-stock-down)',
                    marginTop: 2,
                  }}
                >
                  {index!.changeRate >= 0 ? '+' : ''}{index!.changeRate.toFixed(1)}%
                </div>
              </div>
            ))}
        </div>
        {indices.meta && (
          <div style={{ marginTop: 'var(--space-3)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--color-border-default)' }}>
            <div className="caption">
              {indices.meta.isPartial ? '⚠️ 부분 수집' : '✅ 정상'}
              {indices.meta.fetchedAt && ` (${new Date(indices.meta.fetchedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}) KST`}
            </div>
            {indices.meta.missing && indices.meta.missing.length > 0 && (
              <div className="caption" style={{ marginTop: 4 }}>
                누락 지표: {indices.meta.missing.join(', ')}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Fear & Greed 인덱스 */}
      {indices.fearGreed && (
        <div className="card mb-4">
          <div className="section-title mb-3">공포 vs 탐욕 지수</div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-4)' }}>
            <div>
              <div className="caption" style={{ marginBottom: 6 }}>Fear & Greed Score</div>
              <div
                style={{
                  fontSize: 32,
                  fontWeight: 700,
                  color: indices.fearGreed.score <= 25 ? 'var(--color-stock-down)' : indices.fearGreed.score <= 50 ? 'var(--color-text-secondary)' : 'var(--color-stock-up)',
                }}
              >
                {indices.fearGreed.score}
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div className="caption" style={{ marginBottom: 6 }}>평가</div>
              <div style={{
                padding: 'var(--space-2) var(--space-3)',
                borderRadius: 'var(--radius-md)',
                background: indices.fearGreed.score <= 25 ? 'rgba(239, 68, 68, 0.1)' : indices.fearGreed.score <= 50 ? 'rgba(0,0,0,0.05)' : 'rgba(34, 197, 94, 0.1)',
                fontSize: 12,
                fontWeight: 600,
              }}>
                {indices.fearGreed.score <= 20 ? '🔴 극단 공포 (역발상 기회)' : 
                 indices.fearGreed.score <= 30 ? '🔴 공포' :
                 indices.fearGreed.score <= 40 ? '🟡 약간 공포' :
                 indices.fearGreed.score <= 60 ? '🟡 중립' :
                 indices.fearGreed.score <= 70 ? '🟢 약간 탐욕' :
                 indices.fearGreed.score <= 80 ? '🟢 탐욕' :
                 '🔴 극단 탐욕 (차익 고려)'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 상품/원자재 시장 */}
      {[indices.gold, indices.silver, indices.copper, indices.wtiOil, indices.bitcoin].some(i => i) && (
        <div className="card mb-4">
          <div className="section-title mb-3">상품/원자재/암호화폐</div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
              gap: 'var(--space-3)',
            }}
          >
            {[
              { label: '금', index: indices.gold },
              { label: '은', index: indices.silver },
              { label: '구리', index: indices.copper },
              { label: '유가(WTI)', index: indices.wtiOil },
              { label: '비트코인', index: indices.bitcoin },
            ]
              .filter(({ index }) => index)
              .map(({ label, index }) => (
                <div key={label}>
                  <div className="caption" style={{ marginBottom: 4 }}>
                    {label}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {index!.name.includes('Bitcoin') ? `$${index!.price.toLocaleString()}` : `$${index!.price.toFixed(2)}`}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: index!.changeRate >= 0 ? 'var(--color-stock-up)' : 'var(--color-stock-down)',
                      marginTop: 2,
                    }}
                  >
                    {index!.changeRate >= 0 ? '+' : ''}{index!.changeRate.toFixed(1)}%
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* 진단 시그널 */}
      {diagnosis.signals.length > 0 && (
        <div className="card mb-4">
          <div className="section-title mb-3">진단 시그널</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {diagnosis.signals.map((signal, i) => (
              <div key={i} style={{ fontSize: 13, lineHeight: 1.6 }}>
                • {signal}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 주도 섹터 */}
      {topSectors.length > 0 && (
        <div className="card mb-4">
          <div className="section-title mb-3">주도 섹터 (수급 유입 중)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {topSectors.slice(0, 5).map((s, idx) => {
              const scorePercent = Math.min(100, Math.max(0, (s.score / 100) * 100))
              const strength = s.score >= 75 ? '강함' : s.score >= 55 ? '유지' : '약함'
              const color = s.score >= 75 ? 'var(--color-stock-up)' : s.score >= 55 ? 'var(--color-text-secondary)' : 'var(--color-stock-down)'
              return (
                <div
                  key={s.id}
                  style={{
                    padding: 'var(--space-3)',
                    background: 'var(--color-bg-muted)',
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-border-default)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-2)' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 4 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{s.name}</div>
                        <div
                          style={{
                            fontSize: 10,
                            padding: '2px 6px',
                            borderRadius: 'var(--radius-sm)',
                            background: color + '20',
                            color,
                            fontWeight: 600,
                          }}
                        >
                          {strength}
                        </div>
                      </div>
                      {/* 강도 바 */}
                      <div style={{ height: 6, background: 'var(--color-border-default)', borderRadius: 3, overflow: 'hidden', marginBottom: 4 }}>
                        <div
                          style={{
                            width: `${scorePercent}%`,
                            height: '100%',
                            background: color,
                            transition: 'width 0.4s ease',
                          }}
                        />
                      </div>
                      <div className="caption">강도 {Math.round(s.score)}/100</div>
                    </div>
                    {(s.flowF5 || s.flowI5) && (
                      <div style={{ textAlign: 'right', fontSize: 12, minWidth: 100 }}>
                        {s.flowF5 && <div style={{ color: 'var(--color-text-secondary)' }}>외 {fmtKorMoney(s.flowF5)}</div>}
                        {s.flowI5 && <div style={{ color: 'var(--color-text-secondary)', marginTop: 2 }}>기 {fmtKorMoney(s.flowI5)}</div>}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 순환매 후보 */}
      {nextSectors.length > 0 && (
        <div className="card mb-4">
          <div className="section-title mb-3">순환매 후보 (수급 유입 시작)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {nextSectors.slice(0, 5).map((s) => {
              const scorePercent = Math.min(100, Math.max(0, (s.score / 100) * 100))
              return (
                <div
                  key={s.id}
                  style={{
                    padding: 'var(--space-2) var(--space-3)',
                    background: 'var(--color-bg-muted)',
                    borderRadius: 'var(--radius-sm)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>{s.name}</div>
                    <div style={{ height: 4, background: 'var(--color-border-default)', borderRadius: 2, overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${scorePercent}%`,
                          height: '100%',
                          background: 'var(--color-stock-up)',
                          transition: 'width 0.4s ease',
                        }}
                      />
                    </div>
                  </div>
                  {(s.flowF5 || s.flowI5) && (
                    <div style={{ textAlign: 'right', fontSize: 11, minWidth: 90, marginLeft: 'var(--space-3)' }}>
                      {s.flowF5 && <div style={{ color: 'var(--color-text-secondary)' }}>외 {fmtKorMoney(s.flowF5)}</div>}
                      {s.flowI5 && <div style={{ color: 'var(--color-text-secondary)', marginTop: 2 }}>기 {fmtKorMoney(s.flowI5)}</div>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 투자 전략 */}
      <div className="card mb-4">
        <div className="section-title mb-3">투자 전략 및 액션 플랜</div>
        {diagnosis.advice.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {diagnosis.advice.map((advice, i) => (
              <div
                key={i}
                style={{
                  padding: 'var(--space-2)',
                  borderLeft: '3px solid var(--color-brand)',
                  background: 'var(--color-bg-muted)',
                  borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
                  fontSize: 13,
                  lineHeight: 1.6,
                }}
              >
                {advice}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.8 }}>
            <div style={{ marginBottom: 'var(--space-2)' }}>• 현재 시장 특이사항 없음</div>
            <div>• 평소 전략 유지 (분할 매수/매도, 손절 -7%)</div>
          </div>
        )}
      </div>

      {/* 리스크 요약 */}
      <div
        className="card mb-4"
        style={{
          background: diagnosis.riskScore >= 70 ? 'rgba(239, 68, 68, 0.05)' : diagnosis.riskScore >= 40 ? 'rgba(0,0,0,0.02)' : 'rgba(34, 197, 94, 0.05)',
          borderColor: diagnosis.riskScore >= 70 ? 'var(--color-stock-down)' : diagnosis.riskScore >= 40 ? 'var(--color-border-default)' : 'var(--color-stock-up)',
          borderWidth: 1,
        }}
      >
        <div className="section-title mb-3" style={{
          color: diagnosis.riskScore >= 70 ? 'var(--color-stock-down)' : diagnosis.riskScore >= 40 ? 'var(--color-text-primary)' : 'var(--color-stock-up)',
        }}>
          📊 리스크 프로필
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 'var(--space-3)' }}>
          <div>
            <div className="caption" style={{ marginBottom: 4 }}>리스크 수준</div>
            <div style={{
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius-sm)',
              background: diagnosis.riskScore >= 70 ? 'rgba(239, 68, 68, 0.1)' : diagnosis.riskScore >= 40 ? 'rgba(0,0,0,0.05)' : 'rgba(34, 197, 94, 0.1)',
              fontSize: 13,
              fontWeight: 600,
              textAlign: 'center',
            }}>
              {diagnosis.riskScore >= 80 ? '🔴 매우 높음' :
               diagnosis.riskScore >= 60 ? '🔴 높음' :
               diagnosis.riskScore >= 40 ? '🟡 중간' :
               '🟢 낮음'}
            </div>
          </div>
          <div>
            <div className="caption" style={{ marginBottom: 4 }}>권장 현금 비중</div>
            <div style={{
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--color-bg-muted)',
              fontSize: 13,
              fontWeight: 600,
              textAlign: 'center',
            }}>
              {diagnosis.riskScore >= 80 ? '50% 이상' :
               diagnosis.riskScore >= 60 ? '40% 이상' :
               diagnosis.riskScore >= 40 ? '20~30%' :
               '10~20%'}
            </div>
          </div>
        </div>
      </div>

      {/* 하락장 대응 가이드 */}
      {(diagnosis.regime === 'bear' || diagnosis.regime === 'strong_bear') && (
        <div
          className="card mb-4"
          style={{
            borderColor: 'var(--color-stock-down)',
            borderWidth: 2,
            background: 'rgba(239, 68, 68, 0.05)',
          }}
        >
          <div className="section-title mb-3" style={{ color: 'var(--color-stock-down)' }}>
            🔴 하락장 대응 가이드
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <div style={{ fontSize: 13 }}>1) 보유 종목 손절선 재점검 (-7%)</div>
            <div style={{ fontSize: 13 }}>2) 현금 비중 최소 40% 유지</div>
            <div style={{ fontSize: 13 }}>3) 방어주(배당/필수소비) 비중 확대</div>
            <div style={{ fontSize: 13 }}>4) 신규 매수는 분할 (1/3씩)</div>
            <div style={{ fontSize: 13 }}>5) 외국인 순매도 종목 우선 정리</div>
          </div>
        </div>
      )}
    </section>
  )
}
