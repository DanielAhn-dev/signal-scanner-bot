import React, { useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api'
import Button from '../../components/ui/Button'
import Skeleton from '../../components/Skeleton'
import { ErrorState } from '../../components/StateViews'
import type { EconomicEvent } from '../../../src/types/economics'

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

function riskColor(score: number): string {
  if (score >= 70) return 'var(--color-error)'
  if (score >= 40) return 'var(--color-warning)'
  return 'var(--color-success)'
}

function SectionCard({
  title,
  expanded,
  onToggle,
  children,
}: {
  title: string
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="card" style={{ '--card-padding': 0 } as React.CSSProperties}>
      <div
        className="flex-between"
        style={{ padding: 'var(--space-4) var(--space-5)', cursor: 'pointer', userSelect: 'none' }}
        onClick={onToggle}
      >
        <span className="title-md">{title}</span>
        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
          {expanded ? '▲' : '▼'}
        </span>
      </div>
      {expanded && (
        <>
          <div style={{ height: 1, background: 'var(--color-border-default)' }} />
          {children}
        </>
      )}
    </div>
  )
}

function IndexGrid({ items }: { items: Array<{ label: string; index: MarketIndex | undefined; decimals?: number }> }) {
  const visible = items.filter(({ index }) => index)
  if (!visible.length) return null
  return (
    <div style={{
      padding: 'var(--space-4) var(--space-5)',
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
      gap: 'var(--space-4)',
    }}>
      {visible.map(({ label, index, decimals = 0 }) => (
        <div key={label}>
          <div className="stat-label">{label}</div>
          <div style={{ fontSize: 'var(--font-size-base)', fontWeight: 600, color: 'var(--color-text-primary)', fontVariantNumeric: 'tabular-nums' }}>
            {index!.price.toLocaleString(undefined, { maximumFractionDigits: decimals })}
          </div>
          <div className="stat-sub" style={{
            color: index!.changeRate >= 0 ? 'var(--color-stock-up)' : 'var(--color-stock-down)',
            fontWeight: 600,
          }}>
            {index!.changeRate >= 0 ? '▲' : '▼'} {Math.abs(index!.changeRate).toFixed(2)}%
          </div>
        </div>
      ))}
    </div>
  )
}

export default function MarketPage() {
  const [data, setData] = useState<MarketOverviewData | null>(null)
  const [upcomingEvents, setUpcomingEvents] = useState<EconomicEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [eventsLoading, setEventsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandSections, setExpandSections] = useState<Record<string, boolean>>({
    indices: false,
    commodities: false,
    sectors: false,
    risk: true,
    details: false,
  })

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const endpoints = [
        '/api/market-overview',
        '/api/ui/market-overview',
        '/api/ui?route=market-overview',
      ]

      let result: any = null
      let lastError: unknown = null

      for (const endpoint of endpoints) {
        try {
          result = await apiFetch(endpoint, { cacheMs: 30_000, timeoutMs: 20_000, retries: 0 })
          break
        } catch (e) {
          lastError = e
        }
      }

      if (!result) throw lastError || new Error('market overview fetch failed')
      setData(result?.data ?? null)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  const loadUpcomingEvents = async () => {
    setEventsLoading(true)
    try {
      const result = await apiFetch('/api/economic-calendar?type=upcoming-high-risk', {
        cacheMs: 3_600_000, // 1시간
        timeoutMs: 10_000,
        retries: 0,
      })

      if (result?.data?.events) {
        setUpcomingEvents(result.data.events.slice(0, 2)) // 향후 2개 이벤트만 표시
      }
    } catch (e) {
      // 경제 캘린더 로드 실패는 시장 페이지를 깨뜨리지 않음
      console.error('[market] failed to load economic calendar:', e)
    } finally {
      setEventsLoading(false)
    }
  }

  useEffect(() => {
    void load()
    void loadUpcomingEvents()
  }, [])

  const toggleSection = (key: string) =>
    setExpandSections(prev => ({ ...prev, [key]: !prev[key] }))

  if (error) {
    return (
      <section className="container-app">
        <div className="flex-between mb-4">
          <h1 className="title-xl" style={{ marginBottom: 0 }}>시장 진단</h1>
          <Button variant="secondary" onClick={load} disabled={loading}>새로고침</Button>
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
          <Button variant="secondary" onClick={load} disabled={loading}>새로고침</Button>
        </div>
        <div className="card">
          <Skeleton lines={12} height={14} />
        </div>
      </section>
    )
  }

  const { diagnosis, indices, topSectors, economicPhase, globalCorrelation, tradingSignal } = data
  const signalColor = tradingSignal.shouldTrade ? 'var(--color-success)' : 'var(--color-error)'
  const signalBg   = tradingSignal.shouldTrade ? 'var(--color-success-bg)' : 'var(--color-error-bg)'
  const hasCommodities = !!(indices.gold || indices.silver || indices.copper || indices.wtiOil || indices.bitcoin)

  // 주요 경제 이벤트 필터링
  const criticalEvents = upcomingEvents.filter(e => e.importance === 'critical')
  const highRiskEvents = upcomingEvents.filter(e => ['critical', 'high'].includes(e.importance))

  return (
    <section className="container-app">

      {/* 헤더 */}
      <div className="flex-between mb-6">
        <h1 className="title-xl" style={{ marginBottom: 0 }}>시장 진단</h1>
        <Button variant="secondary" onClick={() => { void load(); void loadUpcomingEvents() }} disabled={loading || eventsLoading}>새로고침</Button>
      </div>

      {/* 경제 이벤트 알림 배너 */}
      {criticalEvents.length > 0 && (
        <div
          className="card mb-4"
          style={{
            background: 'var(--color-stock-up-bg)',
            borderLeft: '4px solid var(--color-stock-up)',
            borderTop: '1px solid var(--color-stock-up)',
            borderRight: '1px solid var(--color-stock-up)',
            borderBottom: '1px solid var(--color-stock-up)',
          }}
        >
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '20px', flexShrink: 0 }}>⭐</span>
            <div style={{ flex: 1 }}>
              {criticalEvents.length === 1 ? (
                <>
                  <div className="title-sm" style={{ marginBottom: 'var(--space-1)' }}>
                    주요 경제 지표 발표 예정
                  </div>
                  <div className="caption" style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>
                    <strong>{criticalEvents[0].name}</strong> (
                    {new Date(criticalEvents[0].scheduledAt).toLocaleString('ko-KR', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    )
                  </div>
                </>
              ) : (
                <>
                  <div className="title-sm" style={{ marginBottom: 'var(--space-1)' }}>
                    {criticalEvents.length}개의 중요 경제 이벤트 발표 예정
                  </div>
                  <div style={{ marginTop: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                    {criticalEvents.map(e => (
                      <div key={e.id} className="caption" style={{ color: 'var(--color-text-primary)' }}>
                        • <strong>{e.name}</strong> ({e.country})
                      </div>
                    ))}
                  </div>
                </>
              )}
              <div className="caption" style={{ marginTop: 'var(--space-2)', color: 'var(--color-text-secondary)' }}>
                변동성 증가 가능, 포지션 관리 주의
              </div>
            </div>
          </div>
        </div>
      )}

      {highRiskEvents.length > 0 && criticalEvents.length === 0 && (
        <div
          className="card mb-4"
          style={{
            background: 'var(--color-warning-bg)',
            borderLeft: '4px solid var(--color-warning)',
            borderTop: '1px solid var(--color-warning)',
            borderRight: '1px solid var(--color-warning)',
            borderBottom: '1px solid var(--color-warning)',
          }}
        >
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
            <span style={{ fontSize: '20px', flexShrink: 0 }}>📌</span>
            <div style={{ flex: 1 }}>
              <div className="title-sm" style={{ marginBottom: 'var(--space-1)' }}>
                경제 지표 발표 예정
              </div>
              <div className="caption" style={{ color: 'var(--color-text-primary)', fontWeight: 500 }}>
                {highRiskEvents[0].name}
              </div>
              <div className="caption" style={{ marginTop: 'var(--space-1)', color: 'var(--color-text-secondary)' }}>
                변동성에 주의하세요
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── 메인 신호 카드 ── */}
      <div
        className="card mb-4"
        style={{
          '--card-border': signalColor,
          '--card-bg': signalBg,
          borderWidth: '2px',
        } as React.CSSProperties}
      >
        {/* 신뢰도 + 상태 */}
        <div style={{ display: 'flex', gap: 'var(--space-5)', alignItems: 'flex-start', marginBottom: 'var(--space-4)' }}>
          <div style={{ flexShrink: 0 }}>
            <div className="stat-label">신뢰도</div>
            <div style={{ fontSize: 'var(--font-size-4xl)', fontWeight: 700, color: signalColor, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
              {tradingSignal.confidence}
              <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-tertiary)', fontWeight: 400, marginLeft: 2 }}>%</span>
            </div>
          </div>
          <div style={{ flex: 1, paddingTop: 'var(--space-1)' }}>
            <div className="title-md" style={{ marginBottom: 'var(--space-1)' }}>
              {tradingSignal.shouldTrade ? '✅ 매매 진행 가능' : '⛔ 매매 제한'}
            </div>
            <div className="muted">
              {tradingSignal.shouldTrade && diagnosis.riskScore >= 60
                ? '시장이 열려있으나 주의사항 필수 확인'
                : tradingSignal.shouldTrade
                  ? '양호한 진입 환경입니다'
                  : '현금 비중을 먼저 확대하세요'}
            </div>
          </div>
        </div>

        <div style={{ height: 1, background: 'var(--color-border-default)', marginBottom: 'var(--space-4)' }} />

        {/* 핵심 지표 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div className="flex-between">
            <span className="muted">경제국면</span>
            <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text-primary)' }}>
              {economicPhase.phase === 'stagflation'   && '⚠️ 스태그플레이션'}
              {economicPhase.phase === 'high_inflation' && '📈 고인플레이션'}
              {economicPhase.phase === 'deflation'      && '📉 디플레이션'}
              {economicPhase.phase === 'normal'         && '✅ 정상'}
              {economicPhase.phase === 'unknown'        && '❓ 판단중'}
            </span>
          </div>
          <div className="flex-between">
            <span className="muted">미국 선물</span>
            <span style={{
              fontSize: 'var(--font-size-sm)', fontWeight: 600,
              color: globalCorrelation.americanFuturesSignal === 'bullish'
                ? 'var(--color-success)'
                : globalCorrelation.americanFuturesSignal === 'bearish'
                  ? 'var(--color-error)'
                  : 'var(--color-text-secondary)',
            }}>
              {globalCorrelation.americanFuturesSignal === 'bullish' && '🟢 강세'}
              {globalCorrelation.americanFuturesSignal === 'bearish' && '🔴 약세'}
              {globalCorrelation.americanFuturesSignal === 'neutral' && '🟡 중립'}
            </span>
          </div>
          <div className="flex-between">
            <span className="muted">리스크</span>
            <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: riskColor(diagnosis.riskScore) }}>
              {diagnosis.riskScore >= 80 && '🔴 매우 높음'}
              {diagnosis.riskScore >= 60 && diagnosis.riskScore < 80 && '🔴 높음'}
              {diagnosis.riskScore >= 40 && diagnosis.riskScore < 60 && '🟡 중간'}
              {diagnosis.riskScore < 40  && '🟢 낮음'}
            </span>
          </div>
          {indices.fearGreed && (
            <div className="flex-between">
              <span className="muted">공포/탐욕</span>
              <span style={{
                fontSize: 'var(--font-size-sm)', fontWeight: 600,
                color: indices.fearGreed.score >= 60
                  ? 'var(--color-success)'
                  : indices.fearGreed.score <= 40
                    ? 'var(--color-error)'
                    : 'var(--color-text-secondary)',
              }}>
                {indices.fearGreed.score} · {indices.fearGreed.rating}
              </span>
            </div>
          )}
        </div>

        {/* 주의사항 */}
        {tradingSignal.restrictions.length > 0 && (
          <>
            <div style={{ height: 1, background: 'var(--color-border-default)', margin: 'var(--space-4) 0' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {tradingSignal.restrictions.slice(0, 3).map((r, i) => (
                <div key={i} className="caption" style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  <span>⚠️</span><span>{r}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── 핵심 메트릭 3개 ── */}
      <div className="cards-grid cols-3 mb-4">
        <div className="card">
          <div className="stat-label">경제심각도</div>
          <div className="stat-value" style={{ color: riskColor(economicPhase.severity) }}>
            {economicPhase.severity}
          </div>
          <div className="stat-sub">
            {economicPhase.severity >= 80 ? '⚠️ 위험' : economicPhase.severity >= 60 ? '🟡 경계' : '✅ 양호'}
          </div>
        </div>

        <div className="card">
          <div className="stat-label">한미 동조도</div>
          <div className="stat-value">
            {globalCorrelation.kospiToSp500Correlation !== null
              ? `${(globalCorrelation.kospiToSp500Correlation * 100).toFixed(0)}%`
              : '—'}
          </div>
          <div className="stat-sub">
            {globalCorrelation.kospiToSp500Correlation !== null && globalCorrelation.kospiToSp500Correlation > 0.7
              ? '🔗 높은동조'
              : '📊 낮은동조'}
          </div>
        </div>

        <div className="card">
          <div className="stat-label">신흥시장압박</div>
          <div className="stat-value" style={{
            color: globalCorrelation.emergingMarketsPressure === 'high'
              ? 'var(--color-error)'
              : globalCorrelation.emergingMarketsPressure === 'moderate'
                ? 'var(--color-warning)'
                : 'var(--color-success)',
          }}>
            {globalCorrelation.emergingMarketsPressure === 'high' ? '높음' : globalCorrelation.emergingMarketsPressure === 'moderate' ? '중간' : '낮음'}
          </div>
          <div className="stat-sub">
            {globalCorrelation.emergingMarketsPressure === 'high' ? '🔴 이탈 주의' : globalCorrelation.emergingMarketsPressure === 'moderate' ? '🟡 모니터링' : '🟢 안정적'}
          </div>
        </div>
      </div>

      {/* ── 토글 섹션들 ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>

        {/* 글로벌 지수 */}
        <SectionCard title="글로벌 지수" expanded={expandSections.indices} onToggle={() => toggleSection('indices')}>
          <IndexGrid items={[
            { label: 'KOSPI',   index: indices.kospi },
            { label: 'KOSDAQ',  index: indices.kosdaq },
            { label: 'S&P 500', index: indices.sp500 },
            { label: 'NASDAQ',  index: indices.nasdaq },
            { label: 'VIX',     index: indices.vix, decimals: 2 },
            { label: 'USD/KRW', index: indices.usdkrw, decimals: 2 },
          ]} />
        </SectionCard>

        {/* 원자재 · 암호화폐 */}
        {hasCommodities && (
          <SectionCard title="원자재 · 암호화폐" expanded={expandSections.commodities} onToggle={() => toggleSection('commodities')}>
            <IndexGrid items={[
              { label: '금(Gold)',  index: indices.gold,    decimals: 2 },
              { label: '은(Silver)', index: indices.silver,  decimals: 2 },
              { label: '구리',      index: indices.copper,  decimals: 2 },
              { label: 'WTI 유가', index: indices.wtiOil,  decimals: 2 },
              { label: 'Bitcoin',   index: indices.bitcoin, decimals: 0 },
            ]} />
          </SectionCard>
        )}

        {/* 주도 섹터 */}
        {topSectors.length > 0 && (
          <SectionCard title="주도 섹터" expanded={expandSections.sectors} onToggle={() => toggleSection('sectors')}>
            <div style={{ padding: 'var(--space-4) var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {topSectors.slice(0, 5).map((s) => {
                const isStrong = s.score >= 75
                const isWeak   = s.score < 55
                const barColor = isStrong ? 'var(--color-success)' : isWeak ? 'var(--color-error)' : 'var(--color-brand)'
                const badgeBg  = isStrong ? 'var(--color-success-bg)' : isWeak ? 'var(--color-error-bg)' : 'var(--color-brand-subtle)'
                const badgeFg  = isStrong ? 'var(--color-success)' : isWeak ? 'var(--color-error)' : 'var(--color-brand)'
                return (
                  <div key={s.id}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-2)' }}>
                      <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                        {s.name}
                      </span>
                      <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                        {(s.flowF5 !== undefined || s.flowI5 !== undefined) && (
                          <span className="caption">
                            {s.flowF5 !== undefined && `외 ${fmtKorMoney(s.flowF5)}`}
                            {s.flowF5 !== undefined && s.flowI5 !== undefined && ' '}
                            {s.flowI5 !== undefined && `기 ${fmtKorMoney(s.flowI5)}`}
                          </span>
                        )}
                        <span style={{
                          fontSize: 'var(--font-size-xs)', fontWeight: 600,
                          color: badgeFg, background: badgeBg,
                          padding: '1px 8px', borderRadius: 999,
                        }}>
                          {Math.round(s.score)}점 · {isStrong ? '강함' : isWeak ? '약함' : '유지'}
                        </span>
                      </div>
                    </div>
                    <div style={{ height: 4, background: 'var(--color-bg-sunken)', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.min(100, s.score)}%`, height: '100%', background: barColor, transition: 'width 0.4s ease' }} />
                    </div>
                  </div>
                )
              })}
            </div>
          </SectionCard>
        )}

        {/* 리스크 프로필 */}
        <SectionCard title="리스크 프로필" expanded={expandSections.risk} onToggle={() => toggleSection('risk')}>
          <div style={{ padding: 'var(--space-4) var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>

            {/* 리스크 게이지 */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-2)' }}>
                <span className="stat-label" style={{ margin: 0 }}>현재 리스크 점수</span>
                <span style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700, color: riskColor(diagnosis.riskScore), fontVariantNumeric: 'tabular-nums' }}>
                  {diagnosis.riskScore}
                  <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', fontWeight: 400 }}>/100</span>
                </span>
              </div>
              <div style={{ height: 8, background: 'var(--color-bg-sunken)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{
                  width: `${diagnosis.riskScore}%`, height: '100%',
                  background: riskColor(diagnosis.riskScore),
                  transition: 'width 0.4s ease', borderRadius: 4,
                }} />
              </div>
            </div>

            {/* 권장 현금 비중 + 달러 강도 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
              <div style={{ padding: 'var(--space-3)', background: 'var(--color-bg-sunken)', borderRadius: 'var(--radius-md)' }}>
                <div className="stat-label">권장 현금 비중</div>
                <div style={{ fontSize: 'var(--font-size-xl)', fontWeight: 700, color: riskColor(diagnosis.riskScore), lineHeight: 1.2 }}>
                  {diagnosis.riskScore >= 80 ? '50%+' : diagnosis.riskScore >= 60 ? '30~50%' : diagnosis.riskScore >= 40 ? '20~30%' : '10~20%'}
                </div>
                <div className="stat-sub">리스크 기반 조정</div>
              </div>
              <div style={{ padding: 'var(--space-3)', background: 'var(--color-bg-sunken)', borderRadius: 'var(--radius-md)' }}>
                <div className="stat-label">달러 강도</div>
                <div style={{
                  fontSize: 'var(--font-size-xl)', fontWeight: 700, lineHeight: 1.2,
                  color: globalCorrelation.usdStrength === 'strengthening'
                    ? 'var(--color-error)'
                    : globalCorrelation.usdStrength === 'weakening'
                      ? 'var(--color-success)'
                      : 'var(--color-text-secondary)',
                }}>
                  {globalCorrelation.usdStrength === 'strengthening' ? '강세 📈' : globalCorrelation.usdStrength === 'weakening' ? '약세 📉' : '중립 🔁'}
                </div>
                <div className="stat-sub">외국인 수급 영향</div>
              </div>
            </div>

            {/* 투자 전략 */}
            {diagnosis.advice.length > 0 && (
              <div>
                <div className="stat-label" style={{ marginBottom: 'var(--space-3)' }}>투자 전략</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  {diagnosis.advice.slice(0, 4).map((adv, i) => (
                    <div key={i} style={{
                      padding: 'var(--space-3)',
                      background: 'var(--color-bg-surface)',
                      border: '1px solid var(--color-border-default)',
                      borderLeft: '3px solid var(--color-brand)',
                      borderRadius: 'var(--radius-sm)',
                    }}>
                      <span className="muted" style={{ lineHeight: 1.6 }}>{adv}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </SectionCard>

        {/* 상세 진단 */}
        <SectionCard title="상세 진단" expanded={expandSections.details} onToggle={() => toggleSection('details')}>
          <div style={{ padding: 'var(--space-4) var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>

            {/* 경제국면 설명 */}
            <div>
              <div className="stat-label" style={{ marginBottom: 'var(--space-2)' }}>경제 국면</div>
              <div className="muted" style={{ lineHeight: 1.6 }}>{economicPhase.description}</div>
            </div>

            {/* 경제지표 그리드 */}
            <div>
              <div className="stat-label" style={{ marginBottom: 'var(--space-3)' }}>경제 지표</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'var(--space-3)' }}>
                {economicPhase.indicators.us10y !== null && (
                  <div style={{ padding: 'var(--space-3)', background: 'var(--color-bg-sunken)', borderRadius: 'var(--radius-sm)' }}>
                    <div className="stat-label">미국 10Y 금리</div>
                    <div style={{ fontWeight: 600, fontSize: 'var(--font-size-base)', fontVariantNumeric: 'tabular-nums' }}>
                      {economicPhase.indicators.us10y.toFixed(2)}%
                    </div>
                  </div>
                )}
                {economicPhase.indicators.goldTrend && (
                  <div style={{ padding: 'var(--space-3)', background: 'var(--color-bg-sunken)', borderRadius: 'var(--radius-sm)' }}>
                    <div className="stat-label">금 트렌드</div>
                    <div style={{ fontWeight: 600, fontSize: 'var(--font-size-base)' }}>
                      {economicPhase.indicators.goldTrend === 'up' ? '📈 상승' : economicPhase.indicators.goldTrend === 'down' ? '📉 하락' : '→ 중립'}
                    </div>
                  </div>
                )}
                {economicPhase.indicators.oilTrend && (
                  <div style={{ padding: 'var(--space-3)', background: 'var(--color-bg-sunken)', borderRadius: 'var(--radius-sm)' }}>
                    <div className="stat-label">유가 트렌드</div>
                    <div style={{ fontWeight: 600, fontSize: 'var(--font-size-base)' }}>
                      {economicPhase.indicators.oilTrend === 'up' ? '📈 상승' : economicPhase.indicators.oilTrend === 'down' ? '📉 하락' : '→ 중립'}
                    </div>
                  </div>
                )}
                <div style={{ padding: 'var(--space-3)', background: 'var(--color-bg-sunken)', borderRadius: 'var(--radius-sm)' }}>
                  <div className="stat-label">리스크 심리</div>
                  <div style={{ fontWeight: 600, fontSize: 'var(--font-size-base)' }}>
                    {economicPhase.indicators.riskSentiment === 'risk_on'  && '🟢 위험선호'}
                    {economicPhase.indicators.riskSentiment === 'risk_off' && '🔴 위험회피'}
                    {economicPhase.indicators.riskSentiment === 'neutral'  && '🟡 중립'}
                  </div>
                </div>
              </div>
            </div>

            {/* 진단 신호 */}
            {diagnosis.signals.length > 0 && (
              <div>
                <div className="stat-label" style={{ marginBottom: 'var(--space-2)' }}>진단 신호</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  {diagnosis.signals.slice(0, 5).map((sig, i) => (
                    <div key={i} className="muted">• {sig}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </SectionCard>

      </div>
    </section>
  )
}
