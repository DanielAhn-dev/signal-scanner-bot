import React, { useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, ArrowUp, ArrowDown, Minus, Clock, CheckCircle2 } from 'lucide-react'
import type { EconomicEvent, EventImportance } from '../../../src/types/economics'
import { calculateEventImpactScore, generateEventTradeRestriction } from '../../../src/utils/fetchEconomicCalendar'
import Skeleton from './Skeleton'

interface EconomicCalendarProps {
  events: EconomicEvent[]
  loading?: boolean
  onRefresh?: () => void
  fetchedAt?: string
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function isReleased(event: EconomicEvent): boolean {
  // actualValue가 있으면 이미 발표됨
  if (event.actualValue !== undefined) return true
  // 또는 예정 시각이 현재보다 과거
  return new Date(event.scheduledAt).getTime() < Date.now()
}

function formatScheduledAt(isoString: string): string {
  const date = new Date(isoString)
  const now = new Date()

  // 날짜 기준 비교 (시각 무시)
  const eventDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const today    = new Date(now.getFullYear(),  now.getMonth(),  now.getDate())
  const diffDays = Math.round((eventDay.getTime() - today.getTime()) / 86_400_000)

  if (diffDays < 0) {
    // 과거
    if (diffDays === -1) return '어제'
    if (diffDays >= -6) return `${Math.abs(diffDays)}일 전`
    return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
  }
  if (diffDays === 0) return '오늘 ' + date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
  if (diffDays === 1) return '내일'
  if (diffDays <= 7) return `${diffDays}일 후`
  if (diffDays <= 30) return `${Math.ceil(diffDays / 7)}주 후`
  return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
}

function importanceLabel(imp: EventImportance): string {
  switch (imp) {
    case 'critical': return '최중요'
    case 'high':     return '높음'
    case 'medium':   return '중간'
    case 'low':      return '낮음'
  }
}

function importanceColor(imp: EventImportance): string {
  switch (imp) {
    case 'critical': return 'var(--color-stock-up)'
    case 'high':     return 'var(--color-warning)'
    case 'medium':   return 'var(--color-yellow-500)'
    case 'low':      return 'var(--color-text-tertiary)'
  }
}

function importanceBg(imp: EventImportance): string {
  switch (imp) {
    case 'critical': return 'var(--color-stock-up-bg)'
    case 'high':     return 'var(--color-warning-bg)'
    case 'medium':   return '#FFFAEE'
    case 'low':      return 'var(--color-gray-100)'
  }
}

// ─── Group by date ───────────────────────────────────────────────────────────

type DateGroup = {
  key: string
  label: string
  events: EconomicEvent[]
}

function groupByDate(events: EconomicEvent[]): DateGroup[] {
  const now   = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  const released: EconomicEvent[] = []
  const todayEvts: EconomicEvent[] = []
  const thisWeek: EconomicEvent[] = []
  const later: EconomicEvent[] = []

  for (const e of events) {
    if (isReleased(e)) {
      released.push(e)
      continue
    }
    const d = new Date(e.scheduledAt)
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate())
    const diff = Math.round((day.getTime() - today.getTime()) / 86_400_000)
    if (diff <= 0) todayEvts.push(e)
    else if (diff <= 7) thisWeek.push(e)
    else later.push(e)
  }

  const groups: DateGroup[] = []
  if (released.length)  groups.push({ key: 'released', label: '발표됨',  events: released })
  if (todayEvts.length) groups.push({ key: 'today',    label: '오늘',    events: todayEvts })
  if (thisWeek.length)  groups.push({ key: 'week',     label: '이번 주', events: thisWeek })
  if (later.length)     groups.push({ key: 'later',    label: '이후',    events: later })
  return groups
}

// ─── Event item ──────────────────────────────────────────────────────────────

function EventItem({ event }: { event: EconomicEvent }) {
  const [open, setOpen] = useState(false)
  const released = isReleased(event)
  const impactScore = calculateEventImpactScore(event)
  const restriction = generateEventTradeRestriction(event)
  const timeLabel = formatScheduledAt(event.scheduledAt)

  const hasActual   = event.actualValue  !== undefined
  const hasForecast = event.forecastValue !== undefined
  const hasPrevious = event.previousValue !== undefined
  const hasMarket   = event.averageKospiReaction !== undefined

  // 실제 vs 예측 방향
  const beat = hasActual && hasForecast
    ? event.actualValue! > event.forecastValue! ? 'up'
      : event.actualValue! < event.forecastValue! ? 'down'
      : 'flat'
    : null

  return (
    <div>
      {/* 메인 행 */}
      <button
        className={`market-calendar__event-row${released ? ' is-released' : ''}${open ? ' is-open' : ''}`}
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 'var(--space-3)',
          padding: 'var(--space-3) var(--space-4)',
          background: 'transparent',
          border: 'none',
          borderBottom: '1px solid var(--color-border-default)',
          cursor: 'pointer',
          textAlign: 'left',
          WebkitTapHighlightColor: 'transparent',
          minHeight: 50,
          transition: 'background var(--duration-fast) var(--ease-out)',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg-surface)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
      >
        <div className="market-calendar__event-main" style={{ flex: 1, minWidth: 0 }}>
          {/* 이벤트명 */}
          <div
            className="market-calendar__event-title"
            style={{
              fontSize: 'var(--font-size-sm)',
              fontWeight: 'var(--font-weight-semibold)',
              color: released ? 'var(--color-text-secondary)' : 'var(--color-text-primary)',
              lineHeight: 1.3,
              marginBottom: 4,
            }}
          >
            {event.name}
          </div>
          {/* 메타 */}
          <div
            className="market-calendar__event-meta"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              fontSize: 'var(--font-size-xs)',
              color: 'var(--color-text-tertiary)',
            }}
          >
            {released
              ? <CheckCircle2 size={11} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
              : <Clock size={11} style={{ flexShrink: 0 }} />}
            <span>{event.country}</span>
            <span>·</span>
            <span className="market-calendar__event-time" style={{ color: released ? 'var(--color-text-tertiary)' : importanceColor(event.importance) }}>
              {timeLabel}
            </span>
          </div>
        </div>

        {/* 우측: 값 + 중요도 chip */}
        <div className="market-calendar__event-side" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
          {/* 실제값 또는 예측값 */}
          {hasActual ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span
                className="market-calendar__event-value"
                style={{
                  fontSize: 'var(--font-size-base)',
                  fontWeight: 'var(--font-weight-bold)',
                  color: beat === 'up' ? 'var(--color-stock-up)' : beat === 'down' ? 'var(--color-stock-down)' : 'var(--color-text-primary)',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {event.actualValue!.toFixed(1)}{event.unit}
              </span>
              {beat === 'up'   && <ArrowUp   size={12} style={{ color: 'var(--color-stock-up)' }}   strokeWidth={2.5} />}
              {beat === 'down' && <ArrowDown size={12} style={{ color: 'var(--color-stock-down)' }} strokeWidth={2.5} />}
              {beat === 'flat' && <Minus     size={12} style={{ color: 'var(--color-text-tertiary)' }} />}
            </div>
          ) : hasForecast ? (
            <span className="market-calendar__event-forecast" style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--color-text-primary)', fontVariantNumeric: 'tabular-nums' }}>
              예측 {event.forecastValue!.toFixed(1)}{event.unit}
            </span>
          ) : null}
          {/* 중요도 chip */}
          <span
            className="market-calendar__importance-chip"
            style={{
              padding: '2px 7px',
              borderRadius: 'var(--radius-full)',
              fontSize: 'var(--font-size-xs)',
              fontWeight: 'var(--font-weight-semibold)',
              color: importanceColor(event.importance),
              background: importanceBg(event.importance),
              whiteSpace: 'nowrap',
            }}
          >
            {importanceLabel(event.importance)}
          </span>
        </div>

        {/* 접기/펼치기 */}
        <span className="market-calendar__event-chevron" style={{ color: 'var(--color-text-tertiary)', flexShrink: 0, alignSelf: 'center', display: 'flex' }}>
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </span>
      </button>

      {/* 상세 펼침 */}
      {open && (
        <div
          className="market-calendar__event-detail"
          style={{
            padding: '0 var(--space-5) var(--space-4)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)',
          }}
        >
          {/* 발표 수치 그리드 */}
          {(hasActual || hasForecast || hasPrevious) && (
            <div className="market-calendar__value-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-2)' }}>
              {hasActual && (
                <ValueTile
                  label="실제"
                  value={`${event.actualValue!.toFixed(1)}${event.unit ?? ''}`}
                  color={beat === 'up' ? 'var(--color-stock-up)' : beat === 'down' ? 'var(--color-stock-down)' : 'var(--color-text-primary)'}
                  highlight
                />
              )}
              {hasForecast && (
                <ValueTile label="예측" value={`${event.forecastValue!.toFixed(1)}${event.unit ?? ''}`} />
              )}
              {hasPrevious && (
                <ValueTile label="이전" value={`${event.previousValue!.toFixed(1)}${event.unit ?? ''}`} />
              )}
            </div>
          )}

          {/* 과거 시장 반응 */}
          {hasMarket && (
            <div>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', fontWeight: 'var(--font-weight-medium)', marginBottom: 8, letterSpacing: '0.04em' }}>
                과거 평균 시장 반응
              </div>
              <div className="market-calendar__market-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
                <div style={{ padding: 'var(--space-3)', background: 'var(--color-bg-sunken)', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginBottom: 4 }}>KOSPI</div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 3,
                      fontSize: 'var(--font-size-base)',
                      fontWeight: 'var(--font-weight-bold)',
                      color: event.averageKospiReaction! >= 0 ? 'var(--color-stock-up)' : 'var(--color-stock-down)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {event.averageKospiReaction! >= 0
                      ? <ArrowUp size={12} strokeWidth={2.5} />
                      : <ArrowDown size={12} strokeWidth={2.5} />}
                    {Math.abs(event.averageKospiReaction!).toFixed(2)}%
                  </div>
                </div>
                {event.averageVolatilityIncrease !== undefined && (
                  <div style={{ padding: 'var(--space-3)', background: 'var(--color-bg-sunken)', borderRadius: 'var(--radius-md)' }}>
                    <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginBottom: 4 }}>변동성</div>
                    <div style={{ fontSize: 'var(--font-size-base)', fontWeight: 'var(--font-weight-bold)', color: 'var(--color-warning)', fontVariantNumeric: 'tabular-nums' }}>
                      +{event.averageVolatilityIncrease.toFixed(1)}p
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 영향도 바 */}
          {impactScore > 0 && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', fontWeight: 'var(--font-weight-medium)' }}>예상 시장 영향도</span>
                <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-semibold)', color: importanceColor(event.importance) }}>{impactScore}%</span>
              </div>
              <div style={{ height: 4, background: 'var(--color-bg-sunken)', borderRadius: 'var(--radius-full)', overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${impactScore}%`,
                    height: '100%',
                    background: importanceColor(event.importance),
                    borderRadius: 'var(--radius-full)',
                    transition: 'width 0.4s ease',
                  }}
                />
              </div>
            </div>
          )}

          {/* 거래 제약 메시지 */}
          <div
            className="market-calendar__restriction"
            style={{
              padding: 'var(--space-3) var(--space-4)',
              background: 'var(--color-bg-sunken)',
              borderRadius: 'var(--radius-sm)',
              borderLeft: `2px solid ${importanceColor(event.importance)}`,
              fontSize: 'var(--font-size-xs)',
              color: 'var(--color-text-secondary)',
              lineHeight: 1.6,
            }}
          >
            {restriction}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Value tile ──────────────────────────────────────────────────────────────

function ValueTile({ label, value, color, highlight }: { label: string; value: string; color?: string; highlight?: boolean }) {
  return (
    <div
      className={`market-calendar__value-tile${highlight ? ' is-highlight' : ''}`}
      style={{
        padding: 'var(--space-3)',
        background: highlight ? 'var(--color-bg-surface)' : 'var(--color-bg-sunken)',
        border: highlight ? '1px solid var(--color-border-default)' : 'none',
        borderRadius: 'var(--radius-md)',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-tertiary)', marginBottom: 4 }}>{label}</div>
      <div
        style={{
          fontSize: 'var(--font-size-base)',
          fontWeight: 'var(--font-weight-bold)',
          color: color ?? 'var(--color-text-primary)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
    </div>
  )
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function EconomicCalendar({ events, loading, fetchedAt }: EconomicCalendarProps) {
  const groups = useMemo(() => groupByDate(events), [events])

  const upcomingImportant = useMemo(
    () => events.filter(e => !isReleased(e) && (e.importance === 'critical' || e.importance === 'high')),
    [events]
  )

  if (loading) {
    return <div style={{ marginTop: 'var(--space-2)' }}><Skeleton lines={8} height={14} /></div>
  }

  if (events.length === 0) {
    return (
      <div
        style={{
          textAlign: 'center',
          padding: 'var(--space-10)',
          color: 'var(--color-text-tertiary)',
          fontSize: 'var(--font-size-sm)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-2)',
        }}
      >
        <div style={{ color: 'var(--color-text-secondary)', fontWeight: 'var(--font-weight-semibold)' }}>
          현재 등록된 예정 경제 일정이 없습니다
        </div>
        <div>
          이 화면은 정상 응답이지만 일정이 0건인 상태입니다. API 호출 실패는 별도 오류 화면으로 표시됩니다.
        </div>
        {fetchedAt && (
          <div style={{ fontSize: 'var(--font-size-xs)' }}>
            데이터 기준 시각: {new Date(fetchedAt).toLocaleString('ko-KR')}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="market-calendar" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>

      {/* 요약 배너 */}
      {upcomingImportant.length > 0 && (
        <div
          className="market-calendar__summary"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            padding: 'var(--space-3) var(--space-4)',
            background: 'var(--color-warning-bg)',
            border: '1px solid var(--color-warning)',
            borderLeft: '3px solid var(--color-warning)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'var(--color-warning)',
              flexShrink: 0,
            }}
          />
          <div>
            <div style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--color-text-primary)' }}>
              다음 {upcomingImportant.length}개의 주요 이벤트 예정
            </div>
            <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginTop: 2 }}>
              변동성 주의, 포지션 관리 권고
            </div>
          </div>
        </div>
      )}

      {/* 날짜 그룹별 리스트 */}
      {groups.map(group => (
        <div key={group.key} className={`market-calendar__group market-calendar__group--${group.key}`}>
          {/* 섹션 레이블 */}
          <div
            className="market-calendar__group-head"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              padding: 'var(--space-1) 0 var(--space-2)',
            }}
          >
            {group.key === 'released' && (
              <CheckCircle2 size={12} style={{ color: 'var(--color-success)' }} />
            )}
            <span
              className="market-calendar__group-label"
              style={{
                fontSize: 'var(--font-size-xs)',
                fontWeight: 'var(--font-weight-semibold)',
                color: group.key === 'released' ? 'var(--color-success)' : 'var(--color-text-tertiary)',
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
              }}
            >
              {group.label}
            </span>
            <span
              className="market-calendar__group-count"
              style={{
                fontSize: 'var(--font-size-xs)',
                color: 'var(--color-text-tertiary)',
                background: 'var(--color-bg-sunken)',
                padding: '1px 6px',
                borderRadius: 'var(--radius-full)',
              }}
            >
              {group.events.length}
            </span>
          </div>

          {/* 이벤트 카드 */}
          <div
            className="card market-calendar__group-card"
            style={{
              '--card-padding': '0',
              overflow: 'hidden',
            } as React.CSSProperties}
          >
            {group.events.map((event, idx) => (
              <React.Fragment key={event.id}>
                {idx > 0 && (
                  <div className="market-calendar__event-divider" style={{ height: 1, background: 'var(--color-border-default)', margin: '0 var(--space-5)' }} />
                )}
                <EventItem event={event} />
              </React.Fragment>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
