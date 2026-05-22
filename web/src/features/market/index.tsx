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
  minHeight = 34,
}: {
  label: string
  children: React.ReactNode
  minHeight?: number
}) {
  return (
    <div
      className="market-sheet__list-row"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-4)',
        minHeight,
        padding: '0 10px',
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
      className="market-sheet__divider"
      style={{
        height: 1,
        background: 'var(--color-border-default)',
        margin: '0 10px',
      }}
    />
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="market-sheet__section-label"
      style={{
        padding: '8px 10px 4px',
        fontSize: '10px',
        fontWeight: 'var(--font-weight-semibold)',
        color: 'var(--color-text-tertiary)',
        letterSpacing: '0.02em',
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
      className="market-sheet__index-row"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-4)',
        padding: '6px 10px',
        minHeight: 38,
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
    <div className="card market-sheet__block" style={{ '--card-padding': '0', overflow: 'hidden' } as React.CSSProperties}>
      <button
        className="market-sheet__collapse-btn"
        onClick={onToggle}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 10px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          minHeight: 34,
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
      className="market-sheet__segment"
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
    <div className="market-sheet__header-row">
      <div className="market-sheet__header">
        <h1>시장 진단</h1>
        <button
          onClick={onRefresh}
          disabled={loading}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            color: loading ? 'var(--color-text-tertiary)' : 'var(--color-brand)',
            border: 'none',
            borderRadius: 0,
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
    <table className="xls-table market-sheet__table" style={{ width: '100%', tableLayout: 'fixed' }}>
      <colgroup>
        <col style={{ width: 120 }} />
        <col />
        <col style={{ width: 104 }} />
        <col style={{ width: 110 }} />
        <col style={{ width: 88 }} />
        <col style={{ width: 104 }} />
      </colgroup>
      <tbody>
        <tr className="xls-row xls-row--even market-sheet__signal-head">
          <td className="xls-cell" colSpan={4}>
            <div className="market-sheet__signal-head-inner">
              <StatusDot color={canTrade ? 'var(--color-success)' : 'var(--color-error)'} />
              <div>
                <div className="market-sheet__signal-title" style={{ color: canTrade ? 'var(--color-success)' : 'var(--color-error)' }}>
                  {canTrade ? '매매 가능' : '매매 제한'}
                </div>
                <div className="market-sheet__signal-sub">
                  {canTrade && diagnosis.riskScore >= 60 ? '주의사항 확인 후 진입' : canTrade ? '양호한 진입 환경' : '현금 비중 먼저 확대'}
                </div>
              </div>
            </div>
          </td>
          <td className="xls-cell market-sheet__signal-confidence" colSpan={2}>
            <div className="market-sheet__signal-confidence-value" style={{ color: canTrade ? 'var(--color-success)' : 'var(--color-error)' }}>
              {tradingSignal.confidence}<span>%</span>
            </div>
            <div className="market-sheet__signal-confidence-label">신뢰도</div>
          </td>
        </tr>

        <SheetSectionHeader label="핵심 진단" value={<span className="caption">경제국면 · 미국선물 · 리스크 · 공포탐욕</span>} />
        <tr className="xls-row">
          <td className="xls-cell">경제국면</td>
          <td className="xls-cell" colSpan={2}><EconomicPhaseChip phase={economicPhase.phase} /></td>
          <td className="xls-cell">미국 선물</td>
          <td className="xls-cell" colSpan={2}><FuturesValue signal={globalCorrelation.americanFuturesSignal} /></td>
        </tr>
        <tr className="xls-row xls-row--even">
          <td className="xls-cell">리스크</td>
          <td className="xls-cell" colSpan={2}><RiskValue score={diagnosis.riskScore} /></td>
          <td className="xls-cell">공포/탐욕</td>
          <td className="xls-cell" colSpan={2}>
            {indices.fearGreed ? <FearGreedValue score={indices.fearGreed.score} rating={indices.fearGreed.rating} /> : '—'}
          </td>
        </tr>

        <SheetSectionHeader label="핵심 메트릭" />
        <tr className="xls-row">
          <td className="xls-cell">경제심각도</td>
          <td className="xls-cell"><span style={{ color: riskColor(economicPhase.severity), fontWeight: 700 }}>{economicPhase.severity}</span></td>
          <td className="xls-cell">한미 동조도</td>
          <td className="xls-cell">{globalCorrelation.kospiToSp500Correlation !== null ? `${(globalCorrelation.kospiToSp500Correlation * 100).toFixed(0)}%` : '—'}</td>
          <td className="xls-cell">신흥압박</td>
          <td className="xls-cell">{globalCorrelation.emergingMarketsPressure === 'high' ? '높음' : globalCorrelation.emergingMarketsPressure === 'moderate' ? '중간' : '낮음'}</td>
        </tr>

        {topSectors.length > 0 && (
          <>
            <SheetSectionHeader
              label="주도 섹터"
              value={expanded.sectors ? '접기' : '펼치기'}
              onClick={() => toggle('sectors')}
            />
            {expanded.sectors && topSectors.slice(0, 5).map((s, idx) => {
              const strong = s.score >= 75
              const weak = s.score < 55
              const chipColor = strong ? 'var(--color-success)' : weak ? 'var(--color-error)' : 'var(--color-brand)'
              const chipBg = strong ? 'var(--color-success-bg)' : weak ? 'var(--color-error-bg)' : 'var(--color-brand-subtle)'
              return (
                <tr className={`xls-row${idx % 2 === 1 ? ' xls-row--even' : ''}`} key={s.id}>
                  <td className="xls-cell">#{idx + 1}</td>
                  <td className="xls-cell" colSpan={3}>
                    <div className="market-sheet__sector-name">{s.name}</div>
                    <div className="market-sheet__sector-flow">
                      {(s.flowF5 !== undefined || s.flowI5 !== undefined) && (
                        <span>{s.flowF5 !== undefined && `외${fmtKorMoney(s.flowF5)}`}{s.flowF5 !== undefined && s.flowI5 !== undefined && ' '}{s.flowI5 !== undefined && `기${fmtKorMoney(s.flowI5)}`}</span>
                      )}
                    </div>
                  </td>
                  <td className="xls-cell"><Chip label={`${Math.round(s.score)} · ${strong ? '강함' : weak ? '약함' : '유지'}`} color={chipColor} bg={chipBg} /></td>
                  <td className="xls-cell"><div style={{ height: 4, background: 'var(--color-bg-sunken)', borderRadius: 0, overflow: 'hidden' }}><div style={{ width: `${Math.min(100, s.score)}%`, height: '100%', background: chipColor }} /></div></td>
                </tr>
              )
            })}
          </>
        )}

        <SheetSectionHeader
          label="리스크 프로필"
          value={expanded.risk ? '접기' : '펼치기'}
          onClick={() => toggle('risk')}
        />
        {expanded.risk && (
          <>
            <tr className="xls-row">
              <td className="xls-cell">현재 리스크</td>
              <td className="xls-cell" colSpan={5}>
                <div className="market-sheet__risk-gauge">
                  <div className="market-sheet__risk-gauge-value" style={{ color: riskColor(diagnosis.riskScore) }}>{diagnosis.riskScore}<span>/100</span></div>
                  <div className="market-sheet__risk-gauge-bar"><div style={{ width: `${diagnosis.riskScore}%`, background: riskColor(diagnosis.riskScore) }} /></div>
                </div>
              </td>
            </tr>
            <tr className="xls-row xls-row--even">
              <td className="xls-cell">권장 현금</td>
              <td className="xls-cell" colSpan={2}>{diagnosis.riskScore >= 80 ? '50%+' : diagnosis.riskScore >= 60 ? '30~50%' : diagnosis.riskScore >= 40 ? '20~30%' : '10~20%'}</td>
              <td className="xls-cell">달러 강도</td>
              <td className="xls-cell" colSpan={2}>{globalCorrelation.usdStrength === 'strengthening' ? '강세' : globalCorrelation.usdStrength === 'weakening' ? '약세' : '중립'}</td>
            </tr>
            {diagnosis.advice.slice(0, 3).map((adv, i) => (
              <tr className={`xls-row${i % 2 === 1 ? ' xls-row--even' : ''}`} key={i}>
                <td className="xls-cell">전략 {i + 1}</td>
                <td className="xls-cell" colSpan={5}>{adv}</td>
              </tr>
            ))}
            <tr className="xls-row xls-row--even">
              <td className="xls-cell">경제 국면</td>
              <td className="xls-cell" colSpan={5}>{economicPhase.description}</td>
            </tr>
            {diagnosis.signals.slice(0, 5).map((sig, i) => (
              <tr className={`xls-row${i % 2 === 1 ? ' xls-row--even' : ''}`} key={sig}>
                <td className="xls-cell">신호 {i + 1}</td>
                <td className="xls-cell" colSpan={5}>{sig}</td>
              </tr>
            ))}
          </>
        )}
      </tbody>
    </table>
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
    <table className="xls-table market-sheet__table" style={{ width: '100%', tableLayout: 'fixed' }}>
      <colgroup>
        <col style={{ width: 116 }} />
        <col />
        <col style={{ width: 84 }} />
        <col style={{ width: 152 }} />
      </colgroup>
      <tbody>
        {indices.fearGreed && (
          <>
            <SheetSectionHeader label="공포/탐욕 지수" colSpan={4} />
            <tr className="xls-row">
              <td className="xls-cell">지수</td>
              <td className="xls-cell"><span style={{ fontSize: 'var(--font-size-xl)', fontWeight: 'var(--font-weight-bold)', fontVariantNumeric: 'tabular-nums', color: indices.fearGreed.score >= 60 ? 'var(--color-success)' : indices.fearGreed.score <= 40 ? 'var(--color-error)' : 'var(--color-text-secondary)' }}>{indices.fearGreed.score}</span></td>
              <td className="xls-cell">등급</td>
              <td className="xls-cell"><Chip label={indices.fearGreed.rating} color={indices.fearGreed.score >= 60 ? 'var(--color-success)' : indices.fearGreed.score <= 40 ? 'var(--color-error)' : 'var(--color-text-secondary)'} bg={indices.fearGreed.score >= 60 ? 'var(--color-success-bg)' : indices.fearGreed.score <= 40 ? 'var(--color-error-bg)' : 'var(--color-gray-100)'} /></td>
            </tr>
          </>
        )}

        {groups.map(group => (
          <React.Fragment key={group.label}>
            <SheetSectionHeader label={group.label} colSpan={4} />
            {group.items.map((item, idx) => (
              (() => {
                const up = (item.index?.changeRate ?? 0) >= 0
                const color = up ? 'var(--color-stock-up)' : 'var(--color-stock-down)'
                const value = item.index
                  ? item.isPercent
                    ? `${formatNumber(item.index.price, 2)}%`
                    : item.index.price.toLocaleString(undefined, { maximumFractionDigits: item.decimals ?? 0 })
                  : '—'
                return (
              <tr className={`xls-row${idx % 2 === 1 ? ' xls-row--even' : ''}`} key={item.label}>
                <td className="xls-cell">{item.label}</td>
                <td className="xls-cell" colSpan={2}>
                  <div className="market-sheet__indicator-desc">{item.desc}</div>
                </td>
                <td className="xls-cell market-sheet__indicator-value" style={{ color }}>
                  <div className="market-sheet__indicator-value-main">{value}</div>
                  <div className="market-sheet__indicator-value-sub">
                    {item.index ? `${up ? '+' : ''}${Math.abs(item.index.changeRate).toFixed(2)}%` : '—'}
                  </div>
                </td>
              </tr>
                )
              })()
            ))}
          </React.Fragment>
        ))}
      </tbody>
    </table>
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
      <section className="container-app market-sheet market-sheet--excel xls-page-inset">
        <PageHeader loading={isRefreshing} onRefresh={handleRefresh} />
        <ErrorState message={error} onRetry={load} />
      </section>
    )
  }

  if (loading || !data) {
    return (
      <section className="container-app market-sheet market-sheet--excel xls-page-inset">
        <PageHeader loading={isRefreshing} onRefresh={handleRefresh} />
        <div className="card"><Skeleton lines={12} height={14} /></div>
      </section>
    )
  }

  return (
    <section className="container-app market-sheet market-sheet--excel xls-page-inset">
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
      className="market-sheet__metric"
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

function SheetSectionHeader({
  label,
  value,
  colSpan = 6,
  onClick,
}: {
  label: string
  value?: React.ReactNode
  colSpan?: number
  onClick?: () => void
}) {
  const clickable = typeof onClick === 'function'
  return (
    <tr className={`xls-row xls-row--even market-sheet__section-row${clickable ? ' market-sheet__section-row--clickable' : ''}`} onClick={onClick}>
      <td className="xls-cell" colSpan={colSpan}>
        <div className="market-sheet__section-row-inner">
          <span className="market-sheet__section-label-inline">{label}</span>
          {value ? <span className="market-sheet__section-action">{value}</span> : null}
        </div>
      </td>
    </tr>
  )
}
