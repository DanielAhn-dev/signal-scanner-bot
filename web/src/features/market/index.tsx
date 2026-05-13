import React, { useEffect, useState } from 'react'
import {
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Minus,
  ArrowUp,
  ArrowDown,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { apiFetch } from '../../lib/api'
import { formatNumber } from '../../lib/format'
import Skeleton from '../../components/Skeleton'
import { ErrorState } from '../../components/StateViews'
import EconomicCalendar from '../../components/EconomicCalendar'
import type { EconomicCalendarResponse } from '../../../../src/types/economics'

// ─── Types ──────────────────────────────────────────────────────────────────

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
    us10y?: MarketIndex
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

type Tab = 'diagnosis' | 'indicators' | 'calendar'

// ─── Helpers ────────────────────────────────────────────────────────────────

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

function riskColor(score: number) {
  if (score >= 70) return 'var(--color-error)'
  if (score >= 40) return 'var(--color-warning)'
  return 'var(--color-success)'
}

// ─── Small atoms ────────────────────────────────────────────────────────────

function StatusDot({ color }: { color: string }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: color,
        flexShrink: 0,
      }}
    />
  )
}

function Chip({
  label,
  color,
  bg,
}: {
  label: string
  color: string
  bg: string
}) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '2px 8px',
        borderRadius: 'var(--radius-full)',
        fontSize: 'var(--font-size-xs)',
        fontWeight: 'var(--font-weight-semibold)',
        color,
        background: bg,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  )
}

// 행 목록 아이템 (토스 스타일)
function ListRow({
  label,
  children,
  minHeight = 48,
}: {
  label: string
  children: React.ReactNode
  minHeight?: number
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-4)',
        minHeight,
        padding: '0 var(--space-5)',
      }}
    >
      <span
        style={{
          fontSize: 'var(--font-size-sm)',
          color: 'var(--color-text-secondary)',
          flexShrink: 0,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: 'var(--font-size-sm)',
          fontWeight: 'var(--font-weight-semibold)',
          color: 'var(--color-text-primary)',
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-1)',
          textAlign: 'right',
        }}
      >
        {children}
      </span>
    </div>
  )
}

function ListDivider() {
  return (
    <div
      style={{
        height: 1,
        background: 'var(--color-border-default)',
        margin: '0 var(--space-5)',
      }}
    />
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: 'var(--space-4) var(--space-5) var(--space-2)',
        fontSize: 'var(--font-size-xs)',
        fontWeight: 'var(--font-weight-semibold)',
        color: 'var(--color-text-tertiary)',
        letterSpacing: 'var(--letter-spacing-wider)',
        textTransform: 'uppercase',
      }}
    >
      {children}
    </div>
  )
}

// 지수 행 (지표 탭용)
function IndexRow({
  label,
  desc,
  index,
  decimals = 0,
  isPercent = false,
}: {
  label: string
  desc?: string
  index: MarketIndex | undefined
  decimals?: number
  isPercent?: boolean
}) {
  const up = (index?.changeRate ?? 0) >= 0
  const color = up ? 'var(--color-stock-up)' : 'var(--color-stock-down)'

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-4)',
        padding: 'var(--space-3) var(--space-5)',
        minHeight: 52,
      }}
    >
      <div>
        <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--color-text-primary)' }}>
          {label}
        </div>
        {desc && (
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginTop: 1 }}>
            {desc}
          </div>
        )}
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        {index ? (
          <>
            <div
              style={{
                fontSize: 'var(--font-size-base)',
                fontWeight: 'var(--font-weight-bold)',
                color: 'var(--color-text-primary)',
                fontVariantNumeric: 'tabular-nums',
                lineHeight: 1.2,
              }}
            >
              {isPercent
                ? `${formatNumber(index.price, 2)}%`
                : index.price.toLocaleString(undefined, { maximumFractionDigits: decimals })}
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                gap: 2,
                fontSize: 'var(--font-size-xs)',
                fontWeight: 'var(--font-weight-semibold)',
                color,
                fontVariantNumeric: 'tabular-nums',
                marginTop: 1,
              }}
            >
              {up ? <ArrowUp size={10} strokeWidth={2.5} /> : <ArrowDown size={10} strokeWidth={2.5} />}
              {Math.abs(index.changeRate).toFixed(2)}%
            </div>
          </>
        ) : (
          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-tertiary)' }}>—</span>
        )}
      </div>
    </div>
  )
}

// 섹션 접기/펼치기 카드
function Collapsible({
  label,
  expanded,
  onToggle,
  children,
}: {
  label: string
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div className="card" style={{ '--card-padding': '0', overflow: 'hidden' } as React.CSSProperties}>
      <button
        onClick={onToggle}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--space-4) var(--space-5)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          minHeight: 52,
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <span style={{ fontSize: 'var(--font-size-base)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--color-text-primary)' }}>
          {label}
        </span>
        <span style={{ color: 'var(--color-text-tertiary)', display: 'flex' }}>
          {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </span>
      </button>
      {expanded && (
        <>
          <div style={{ height: 1, background: 'var(--color-border-default)' }} />
          {children}
        </>
      )}
    </div>
  )
}

// 세그먼트 컨트롤 (토스 스타일)
function SegmentControl<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { key: T; label: string }[]
  active: T
  onChange: (key: T) => void
}) {
  return (
    <div
      style={{
        display: 'flex',
        background: 'var(--color-bg-sunken)',
        borderRadius: 'var(--radius-full)',
        padding: 3,
        gap: 2,
        marginBottom: 'var(--space-4)',
      }}
    >
      {tabs.map(tab => {
        const isActive = tab.key === active
        return (
          <button
            key={tab.key}
            onClick={() => onChange(tab.key)}
            style={{
              flex: 1,
              padding: '7px 0',
              borderRadius: 'var(--radius-full)',
              border: 'none',
              cursor: 'pointer',
              fontSize: 'var(--font-size-sm)',
              fontWeight: isActive ? 'var(--font-weight-semibold)' : 'var(--font-weight-medium)',
              color: isActive ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
              background: isActive ? 'var(--color-bg-surface)' : 'transparent',
              boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.10), 0 1px 1px rgba(0,0,0,0.06)' : 'none',
              transition: 'all var(--duration-fast) var(--ease-out)',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}

// ─── Page header ────────────────────────────────────────────────────────────

function PageHeader({ loading, onRefresh }: { loading: boolean; onRefresh: () => void }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 'var(--space-4)',
        gap: 'var(--space-3)',
      }}
    >
      <h1
        style={{
          fontSize: 'var(--font-size-xl)',
          fontWeight: 'var(--font-weight-bold)',
          color: 'var(--color-text-primary)',
          letterSpacing: 'var(--letter-spacing-tight)',
          margin: 0,
        }}
      >
        시장 진단
      </h1>
      <button
        onClick={onRefresh}
        disabled={loading}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          padding: '0 var(--space-4)',
          height: 36,
          background: 'none',
          color: loading ? 'var(--color-text-tertiary)' : 'var(--color-brand)',
          border: 'none',
          borderRadius: 'var(--radius-sm)',
          fontSize: 'var(--font-size-sm)',
          fontWeight: 'var(--font-weight-semibold)',
          cursor: loading ? 'not-allowed' : 'pointer',
          flexShrink: 0,
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        <RefreshCw
          size={14}
          strokeWidth={2.5}
          style={loading ? { animation: 'spin 1s linear infinite' } : undefined}
        />
        새로고침
      </button>
    </div>
  )
}

// ─── 진단 탭 ──────────────────────────────────────────────────────────────

function DiagnosisTab({ data }: { data: MarketOverviewData }) {
  const { diagnosis, indices, topSectors, economicPhase, globalCorrelation, tradingSignal } = data
  const canTrade = tradingSignal.shouldTrade
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ sectors: false, risk: true })
  const toggle = (k: string) => setExpanded(p => ({ ...p, [k]: !p[k] }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>

      {/* 매매 신호 카드 */}
      <div
        className="card"
        style={{
          background: canTrade ? 'var(--color-success-bg)' : 'var(--color-error-bg)',
          borderColor: canTrade ? 'var(--color-success)' : 'var(--color-error)',
          '--card-padding': '0',
        } as React.CSSProperties}
      >
        {/* 상단: 상태 + 신뢰도 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: 'var(--space-4) var(--space-5)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <StatusDot color={canTrade ? 'var(--color-success)' : 'var(--color-error)'} />
            <div>
              <div
                style={{
                  fontSize: 'var(--font-size-base)',
                  fontWeight: 'var(--font-weight-bold)',
                  color: canTrade ? 'var(--color-success)' : 'var(--color-error)',
                  lineHeight: 1.2,
                }}
              >
                {canTrade ? '매매 가능' : '매매 제한'}
              </div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginTop: 2 }}>
                {canTrade && diagnosis.riskScore >= 60
                  ? '주의사항 확인 후 진입'
                  : canTrade
                    ? '양호한 진입 환경'
                    : '현금 비중 먼저 확대'}
              </div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div
              style={{
                fontSize: 'var(--font-size-3xl)',
                fontWeight: 'var(--font-weight-bold)',
                color: canTrade ? 'var(--color-success)' : 'var(--color-error)',
                lineHeight: 1,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {tradingSignal.confidence}
              <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 400, color: 'var(--color-text-tertiary)' }}>%</span>
            </div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginTop: 2 }}>신뢰도</div>
          </div>
        </div>

        {/* 핵심 지표 행 목록 */}
        <div style={{ height: 1, background: 'var(--color-border-default)' }} />

        <ListRow label="경제국면">
          <EconomicPhaseChip phase={economicPhase.phase} />
        </ListRow>
        <ListDivider />
        <ListRow label="미국 선물">
          <FuturesValue signal={globalCorrelation.americanFuturesSignal} />
        </ListRow>
        <ListDivider />
        <ListRow label="리스크">
          <RiskValue score={diagnosis.riskScore} />
        </ListRow>
        {indices.fearGreed && (
          <>
            <ListDivider />
            <ListRow label="공포/탐욕">
              <FearGreedValue score={indices.fearGreed.score} rating={indices.fearGreed.rating} />
            </ListRow>
          </>
        )}

        {/* 주의사항 */}
        {tradingSignal.restrictions.length > 0 && (
          <>
            <div style={{ height: 1, background: 'var(--color-border-default)', margin: 'var(--space-1) 0' }} />
            <div style={{ padding: 'var(--space-3) var(--space-5) var(--space-4)' }}>
              {tradingSignal.restrictions.slice(0, 3).map((r, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    gap: 'var(--space-2)',
                    alignItems: 'flex-start',
                    fontSize: 'var(--font-size-xs)',
                    color: 'var(--color-text-secondary)',
                    lineHeight: 1.6,
                    marginTop: i > 0 ? 'var(--space-1)' : 0,
                  }}
                >
                  <AlertTriangle size={12} strokeWidth={2} style={{ color: 'var(--color-warning)', flexShrink: 0, marginTop: 2 }} />
                  {r}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* 핵심 메트릭 타일 3개 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-2)' }}>
        <MetricTile
          label="경제심각도"
          value={String(economicPhase.severity)}
          valueColor={riskColor(economicPhase.severity)}
          sub={economicPhase.severity >= 80 ? '위험' : economicPhase.severity >= 60 ? '경계' : '양호'}
          subColor={riskColor(economicPhase.severity)}
        />
        <MetricTile
          label="한미 동조도"
          value={
            globalCorrelation.kospiToSp500Correlation !== null
              ? `${(globalCorrelation.kospiToSp500Correlation * 100).toFixed(0)}%`
              : '—'
          }
          sub={
            globalCorrelation.kospiToSp500Correlation !== null && globalCorrelation.kospiToSp500Correlation > 0.7
              ? '높은동조'
              : '낮은동조'
          }
        />
        <MetricTile
          label="신흥압박"
          value={
            globalCorrelation.emergingMarketsPressure === 'high' ? '높음'
              : globalCorrelation.emergingMarketsPressure === 'moderate' ? '중간' : '낮음'
          }
          valueColor={
            globalCorrelation.emergingMarketsPressure === 'high' ? 'var(--color-error)'
              : globalCorrelation.emergingMarketsPressure === 'moderate' ? 'var(--color-warning)'
                : 'var(--color-success)'
          }
          sub={
            globalCorrelation.emergingMarketsPressure === 'high' ? '이탈주의'
              : globalCorrelation.emergingMarketsPressure === 'moderate' ? '모니터링' : '안정'
          }
        />
      </div>

      {/* 주도 섹터 */}
      {topSectors.length > 0 && (
        <Collapsible label="주도 섹터" expanded={expanded.sectors} onToggle={() => toggle('sectors')}>
          <div style={{ padding: 'var(--space-3) var(--space-5) var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {topSectors.slice(0, 5).map(s => {
              const strong = s.score >= 75
              const weak = s.score < 55
              const barColor = strong ? 'var(--color-success)' : weak ? 'var(--color-error)' : 'var(--color-brand)'
              const chipColor = strong ? 'var(--color-success)' : weak ? 'var(--color-error)' : 'var(--color-brand)'
              const chipBg = strong ? 'var(--color-success-bg)' : weak ? 'var(--color-error-bg)' : 'var(--color-brand-subtle)'
              return (
                <div key={s.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 'var(--space-2)' }}>
                    <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--color-text-primary)', minWidth: 0 }}>
                      {s.name}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
                      {(s.flowF5 !== undefined || s.flowI5 !== undefined) && (
                        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)' }}>
                          {s.flowF5 !== undefined && `외${fmtKorMoney(s.flowF5)}`}
                          {s.flowF5 !== undefined && s.flowI5 !== undefined && ' '}
                          {s.flowI5 !== undefined && `기${fmtKorMoney(s.flowI5)}`}
                        </span>
                      )}
                      <Chip label={`${Math.round(s.score)} · ${strong ? '강함' : weak ? '약함' : '유지'}`} color={chipColor} bg={chipBg} />
                    </div>
                  </div>
                  <div style={{ height: 4, background: 'var(--color-bg-sunken)', borderRadius: 'var(--radius-full)', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, s.score)}%`, height: '100%', background: barColor, borderRadius: 'var(--radius-full)', transition: 'width 0.4s ease' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </Collapsible>
      )}

      {/* 리스크 프로필 */}
      <Collapsible label="리스크 프로필" expanded={expanded.risk} onToggle={() => toggle('risk')}>
        <div style={{ padding: 'var(--space-4) var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>

          {/* 게이지 */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 'var(--space-2)' }}>
              <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', fontWeight: 'var(--font-weight-medium)' }}>현재 리스크</span>
              <span style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)', color: riskColor(diagnosis.riskScore), fontVariantNumeric: 'tabular-nums' }}>
                {diagnosis.riskScore}<span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 400, color: 'var(--color-text-tertiary)' }}>/100</span>
              </span>
            </div>
            <div style={{ height: 8, background: 'var(--color-bg-sunken)', borderRadius: 'var(--radius-full)', overflow: 'hidden' }}>
              <div style={{ width: `${diagnosis.riskScore}%`, height: '100%', background: riskColor(diagnosis.riskScore), borderRadius: 'var(--radius-full)', transition: 'width 0.4s ease' }} />
            </div>
          </div>

          {/* 2-col: 현금비중 + 달러강도 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
            <div style={{ padding: 'var(--space-3)', background: 'var(--color-bg-sunken)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginBottom: 6 }}>권장 현금 비중</div>
              <div style={{ fontSize: 'var(--font-size-lg)', fontWeight: 'var(--font-weight-bold)', color: riskColor(diagnosis.riskScore), lineHeight: 1.1 }}>
                {diagnosis.riskScore >= 80 ? '50%+' : diagnosis.riskScore >= 60 ? '30~50%' : diagnosis.riskScore >= 40 ? '20~30%' : '10~20%'}
              </div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginTop: 4 }}>리스크 기반 조정</div>
            </div>
            <div style={{ padding: 'var(--space-3)', background: 'var(--color-bg-sunken)', borderRadius: 'var(--radius-md)' }}>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginBottom: 6 }}>달러 강도</div>
              <div style={{ fontSize: 'var(--font-size-base)', fontWeight: 'var(--font-weight-bold)', display: 'flex', alignItems: 'center', gap: 4, lineHeight: 1.2,
                color: globalCorrelation.usdStrength === 'strengthening' ? 'var(--color-error)' : globalCorrelation.usdStrength === 'weakening' ? 'var(--color-success)' : 'var(--color-text-secondary)',
              }}>
                {globalCorrelation.usdStrength === 'strengthening' && <><TrendingUp size={14} />강세</>}
                {globalCorrelation.usdStrength === 'weakening' && <><TrendingDown size={14} />약세</>}
                {globalCorrelation.usdStrength === 'neutral' && <><Minus size={14} />중립</>}
              </div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginTop: 4 }}>외국인 수급 영향</div>
            </div>
          </div>

          {/* 투자 전략 */}
          {diagnosis.advice.length > 0 && (
            <div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', fontWeight: 'var(--font-weight-medium)', marginBottom: 'var(--space-2)' }}>투자 전략</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {diagnosis.advice.slice(0, 4).map((adv, i) => (
                  <div
                    key={i}
                    style={{
                      padding: 'var(--space-3) var(--space-4)',
                      background: 'var(--color-bg-surface)',
                      border: '1px solid var(--color-border-default)',
                      borderLeft: '2px solid var(--color-brand)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--color-text-secondary)',
                      lineHeight: 1.65,
                    }}
                  >
                    {adv}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 경제국면 설명 */}
          <div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', fontWeight: 'var(--font-weight-medium)', marginBottom: 'var(--space-2)' }}>경제 국면</div>
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.7 }}>{economicPhase.description}</div>
          </div>

          {/* 진단 신호 */}
          {diagnosis.signals.length > 0 && (
            <div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', fontWeight: 'var(--font-weight-medium)', marginBottom: 'var(--space-2)' }}>진단 신호</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {diagnosis.signals.slice(0, 5).map((sig, i) => (
                  <div key={i} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-start', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--color-error)', flexShrink: 0, marginTop: 7 }} />
                    {sig}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Collapsible>

    </div>
  )
}

// ─── 지표 탭 ──────────────────────────────────────────────────────────────

function IndicatorsTab({ data }: { data: MarketOverviewData }) {
  const { indices, economicPhase } = data

  const groups: Array<{
    label: string
    items: Array<{ label: string; desc: string; index: MarketIndex | undefined; decimals?: number; isPercent?: boolean }>
  }> = [
    {
      label: '국내',
      items: [
        { label: 'KOSPI', desc: '국내 대형주 지수', index: indices.kospi },
        { label: 'KOSDAQ', desc: '중소형/기술주 지수', index: indices.kosdaq },
      ],
    },
    {
      label: '미국',
      items: [
        { label: 'S&P 500', desc: '미국 대형주 500', index: indices.sp500 },
        { label: 'NASDAQ', desc: '미국 기술주 지수', index: indices.nasdaq },
        { label: 'VIX', desc: '공포지수 — 20↑ 주의', index: indices.vix, decimals: 2 },
      ],
    },
    {
      label: '환율/금리',
      items: [
        { label: '원/달러', desc: '달러 강세 시 외인 수급 약화', index: indices.usdkrw, decimals: 2 },
        ...(indices.us10y
          ? [{ label: '미국 10Y', desc: '금리 상승 시 밸류에이션 압박', index: indices.us10y, decimals: 2, isPercent: false }]
          : economicPhase.indicators.us10y !== null
            ? [{ label: '미국 10Y', desc: '금리 상승 시 밸류에이션 압박', index: { name: 'us10y', price: economicPhase.indicators.us10y!, change: 0, changeRate: 0 }, decimals: 2, isPercent: true }]
            : []),
      ],
    },
    {
      label: '원자재',
      items: [
        { label: '금(Gold)', desc: '안전자산 / 불확실성 지표', index: indices.gold, decimals: 2 },
        { label: '은(Silver)', desc: '산업용 금속', index: indices.silver, decimals: 2 },
        { label: '구리', desc: '글로벌 경기 선행지표', index: indices.copper, decimals: 2 },
        { label: 'WTI 유가', desc: '국제 유가', index: indices.wtiOil, decimals: 2 },
      ].filter(i => i.index),
    },
    {
      label: '암호화폐',
      items: [
        { label: 'Bitcoin', desc: 'BTC/USD', index: indices.bitcoin },
      ].filter(i => i.index),
    },
  ].filter(g => g.items.some(i => i.index))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {indices.fearGreed && (
        <div
          className="card"
          style={{ '--card-padding': '0' } as React.CSSProperties}
        >
          <ListRow label="공포/탐욕 지수">
            <span style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-bold)', fontVariantNumeric: 'tabular-nums',
              color: indices.fearGreed.score >= 60 ? 'var(--color-success)' : indices.fearGreed.score <= 40 ? 'var(--color-error)' : 'var(--color-text-secondary)',
            }}>
              {indices.fearGreed.score}
            </span>
            <Chip
              label={indices.fearGreed.rating}
              color={indices.fearGreed.score >= 60 ? 'var(--color-success)' : indices.fearGreed.score <= 40 ? 'var(--color-error)' : 'var(--color-text-secondary)'}
              bg={indices.fearGreed.score >= 60 ? 'var(--color-success-bg)' : indices.fearGreed.score <= 40 ? 'var(--color-error-bg)' : 'var(--color-gray-100)'}
            />
          </ListRow>
        </div>
      )}

      {groups.map(group => (
        <div key={group.label} className="card" style={{ '--card-padding': '0', overflow: 'hidden' } as React.CSSProperties}>
          <SectionLabel>{group.label}</SectionLabel>
          {group.items.map((item, idx) => (
            <React.Fragment key={item.label}>
              {idx > 0 && <ListDivider />}
              <IndexRow
                label={item.label}
                desc={item.desc}
                index={item.index}
                decimals={item.decimals}
                isPercent={item.isPercent}
              />
            </React.Fragment>
          ))}
        </div>
      ))}
    </div>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function MarketPage() {
  const [data, setData] = useState<MarketOverviewData | null>(null)
  const [calendar, setCalendar] = useState<EconomicCalendarResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [calendarLoading, setCalendarLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [calendarError, setCalendarError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('diagnosis')

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const endpoints = ['/api/market-overview', '/api/ui/market-overview', '/api/ui?route=market-overview']
      let result: any = null
      let lastError: unknown = null
      for (const ep of endpoints) {
        try { result = await apiFetch(ep, { cacheMs: 30_000, timeoutMs: 20_000, retries: 0 }); break }
        catch (e) { lastError = e }
      }
      if (!result) throw lastError || new Error('fetch failed')
      setData(result?.data ?? null)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  const loadCalendar = async () => {
    setCalendarLoading(true)
    setCalendarError(null)
    try {
      const endpoints = [
        '/api/economic-calendar',
        '/api/ui/economic-calendar',
        '/api/ui?route=economic-calendar',
      ]
      let result: any = null
      let lastError: unknown = null
      for (const ep of endpoints) {
        try {
          result = await apiFetch(ep, { cacheMs: 3_600_000, timeoutMs: 10_000, retries: 1 })
          break
        } catch (e) {
          lastError = e
        }
      }
      if (!result?.data) throw lastError || new Error('calendar fetch failed')
      setCalendar(result.data)
    } catch (e: any) {
      const detail = e?.message || String(e)
      setCalendarError(`경제 캘린더를 불러오지 못했습니다. 잠시 후 다시 시도해주세요. (${detail})`)
      setCalendar(null)
    }
    finally { setCalendarLoading(false) }
  }

  useEffect(() => { void load(); void loadCalendar() }, [])

  const isRefreshing = loading || calendarLoading
  const handleRefresh = () => { void load(); void loadCalendar() }

  if (error) {
    return (
      <section className="container-app">
        <PageHeader loading={isRefreshing} onRefresh={handleRefresh} />
        <ErrorState message={error} onRetry={load} />
      </section>
    )
  }

  if (loading || !data) {
    return (
      <section className="container-app">
        <PageHeader loading={isRefreshing} onRefresh={handleRefresh} />
        <div className="card"><Skeleton lines={12} height={14} /></div>
      </section>
    )
  }

  return (
    <section className="container-app">
      <PageHeader loading={isRefreshing} onRefresh={handleRefresh} />

      <SegmentControl
        tabs={[
          { key: 'diagnosis' as Tab, label: '진단' },
          { key: 'indicators' as Tab, label: '지표' },
          { key: 'calendar' as Tab, label: '캘린더' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'diagnosis' && <DiagnosisTab data={data} />}
      {tab === 'indicators' && <IndicatorsTab data={data} />}
      {tab === 'calendar' && (
        calendarError ? (
          <ErrorState message={calendarError} onRetry={loadCalendar} />
        ) : (
          <EconomicCalendar
            events={calendar?.events || []}
            loading={calendarLoading}
            onRefresh={loadCalendar}
            fetchedAt={calendar?.fetchedAt}
          />
        )
      )}
    </section>
  )
}

// ─── Value label components ──────────────────────────────────────────────────

function EconomicPhaseChip({ phase }: { phase: string }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    stagflation:    { label: '스태그플레이션', color: 'var(--color-error)',          bg: 'var(--color-error-bg)' },
    high_inflation: { label: '고인플레이션',   color: 'var(--color-warning)',        bg: 'var(--color-warning-bg)' },
    deflation:      { label: '디플레이션',     color: 'var(--color-stock-down)',     bg: 'var(--color-stock-down-bg)' },
    normal:         { label: '정상',           color: 'var(--color-success)',        bg: 'var(--color-success-bg)' },
    unknown:        { label: '판단중',         color: 'var(--color-text-tertiary)',  bg: 'var(--color-gray-100)' },
  }
  const m = map[phase] ?? map.unknown
  return <Chip label={m.label} color={m.color} bg={m.bg} />
}

function FuturesValue({ signal }: { signal: 'bullish' | 'bearish' | 'neutral' }) {
  if (signal === 'bullish') return <span style={{ color: 'var(--color-success)', display: 'flex', alignItems: 'center', gap: 3 }}><TrendingUp size={13} />강세</span>
  if (signal === 'bearish') return <span style={{ color: 'var(--color-error)', display: 'flex', alignItems: 'center', gap: 3 }}><TrendingDown size={13} />약세</span>
  return <span style={{ color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: 3 }}><Minus size={13} />중립</span>
}

function RiskValue({ score }: { score: number }) {
  const color = riskColor(score)
  const label = score >= 80 ? '매우 높음' : score >= 60 ? '높음' : score >= 40 ? '중간' : '낮음'
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <StatusDot color={color} />
      <span style={{ color }}>{label}</span>
    </span>
  )
}

function FearGreedValue({ score, rating }: { score: number; rating: string }) {
  const color = score >= 60 ? 'var(--color-success)' : score <= 40 ? 'var(--color-error)' : 'var(--color-text-secondary)'
  return <span style={{ color }}>{score} · {rating}</span>
}

function MetricTile({
  label,
  value,
  valueColor,
  sub,
  subColor,
}: {
  label: string
  value: string
  valueColor?: string
  sub: string
  subColor?: string
}) {
  return (
    <div
      style={{
        background: 'var(--color-bg-sunken)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-3)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-1)',
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', fontWeight: 'var(--font-weight-medium)' }}>
        {label}
      </div>
      <div
        style={{
          fontSize: 'var(--font-size-xl)',
          fontWeight: 'var(--font-weight-bold)',
          color: valueColor ?? 'var(--color-text-primary)',
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: 'var(--letter-spacing-tight)',
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 'var(--font-size-xs)', color: subColor ?? 'var(--color-text-secondary)' }}>
        {sub}
      </div>
    </div>
  )
}
