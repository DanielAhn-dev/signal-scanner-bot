/**
 * 경제 캘린더 UI 컴포넌트 - 모바일 우선 설계
 */
import React, { useMemo } from 'react'
import type { EconomicEvent, EventImportance } from '../../../src/types/economics'
import { calculateEventImpactScore, generateEventTradeRestriction } from '../../../src/utils/fetchEconomicCalendar'

interface EconomicCalendarProps {
  events: EconomicEvent[]
  loading?: boolean
  onRefresh?: () => void
}

function getImportanceColor(importance: EventImportance): string {
  switch (importance) {
    case 'critical':
      return 'var(--color-stock-up)' // 빨강 (심각)
    case 'high':
      return '#FF6B35' // var(--color-orange-500)
    case 'medium':
      return '#F5B800' // var(--color-yellow-500)
    case 'low':
      return 'var(--color-text-secondary)' // 회색 (낮음)
  }
}

function getImportanceBg(importance: EventImportance): string {
  switch (importance) {
    case 'critical':
      return 'var(--color-stock-up-bg)' // 연한 빨강
    case 'high':
      return 'var(--color-warning-bg)' // 연한 주황
    case 'medium':
      return '#FFFAEE' // 연한 노랑
    case 'low':
      return 'var(--color-border-default)'
  }
}

function formatEventTime(isoString: string): string {
  const date = new Date(isoString)
  const now = new Date()
  const diffMs = date.getTime() - now.getTime()
  const diffDays = Math.ceil(diffMs / (24 * 60 * 60 * 1000))

  if (diffDays === 0) return '오늘'
  if (diffDays === 1) return '내일'
  if (diffDays <= 7) return `${diffDays}일 후`
  if (diffDays <= 30) return `${Math.ceil(diffDays / 7)}주 후`

  return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
}

function formatEventValue(value: number | undefined, unit?: string): string {
  if (value === undefined) return '—'
  const formatted = value.toFixed(1)
  return unit ? `${formatted}${unit}` : formatted
}

/**
 * 이벤트 카드 - 모바일 최적화 (세로 스택)
 */
function EventCard({ event }: { event: EconomicEvent }) {
  const impactScore = calculateEventImpactScore(event)
  const restriction = generateEventTradeRestriction(event)
  const timeDisplay = formatEventTime(event.scheduledAt)

  return (
    <div
      className="card"
      style={{
        borderLeft: `4px solid ${getImportanceColor(event.importance)}`,
        background: getImportanceBg(event.importance),
        marginBottom: 'var(--space-3)',
      }}
    >
      {/* 헤더: 이벤트명 + 시간 */}
      <div style={{ marginBottom: 'var(--space-3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 'var(--space-2)' }}>
          <div style={{ flex: 1 }}>
            <div className="title-sm" style={{ marginBottom: 'var(--space-1)' }}>
              {event.name}
            </div>
            <div className="caption" style={{ color: 'var(--color-text-secondary)' }}>
              {event.country}
            </div>
          </div>
          <div
            style={{
              background: getImportanceColor(event.importance),
              color: 'white',
              padding: 'var(--space-1) var(--space-2)',
              borderRadius: 'var(--radius-xs)',
              fontSize: 'var(--font-size-xs)',
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            {event.importance === 'critical' && '⭐ 중요'}
            {event.importance === 'high' && '📌 높음'}
            {event.importance === 'medium' && '📊 중간'}
            {event.importance === 'low' && '📈 낮음'}
          </div>
        </div>
        <div className="stat-label" style={{ marginTop: 'var(--space-2)', color: getImportanceColor(event.importance), fontWeight: 600 }}>
          🕒 {timeDisplay}
        </div>
      </div>

      {/* 구분선 */}
      <div style={{ height: 1, background: 'var(--color-border-default)', marginBottom: 'var(--space-3)' }} />

      {/* 지표값 */}
      <div style={{ marginBottom: 'var(--space-3)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
          {event.forecastValue !== undefined && (
            <div>
              <div className="stat-label">사전 예측</div>
              <div className="stat-value">{formatEventValue(event.forecastValue, event.unit)}</div>
            </div>
          )}
          {event.previousValue !== undefined && (
            <div>
              <div className="stat-label">이전 발표</div>
              <div className="stat-value">{formatEventValue(event.previousValue, event.unit)}</div>
            </div>
          )}
        </div>
      </div>

      {/* 과거 시장 반응 */}
      {event.averageKospiReaction !== undefined && (
        <>
          <div style={{ height: 1, background: 'var(--color-border-default)', marginBottom: 'var(--space-3)' }} />
          <div style={{ marginBottom: 'var(--space-3)' }}>
            <div className="stat-label" style={{ marginBottom: 'var(--space-2)' }}>
              과거 평균 시장 반응
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
              <div style={{ padding: 'var(--space-2)', background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-sm)' }}>
                <div className="caption">KOSPI</div>
                <div
                  style={{
                    fontSize: 'var(--font-size-lg)',
                    fontWeight: 600,
                    color: event.averageKospiReaction >= 0 ? 'var(--color-stock-up)' : 'var(--color-stock-down)',
                  }}
                >
                  {event.averageKospiReaction >= 0 ? '▲' : '▼'} {Math.abs(event.averageKospiReaction).toFixed(2)}%
                </div>
              </div>
              {event.averageVolatilityIncrease !== undefined && (
                <div style={{ padding: 'var(--space-2)', background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-sm)' }}>
                  <div className="caption">변동성</div>
                  <div style={{ fontSize: 'var(--font-size-lg)', fontWeight: 600, color: 'var(--color-warning-strong)' }}>
                    +{event.averageVolatilityIncrease.toFixed(1)}p
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* 영향도 점수 */}
      {impactScore > 0 && (
        <>
          <div style={{ height: 1, background: 'var(--color-border-default)', marginBottom: 'var(--space-3)' }} />
          <div style={{ marginBottom: 'var(--space-3)' }}>
            <div className="stat-label" style={{ marginBottom: 'var(--space-2)' }}>
              예상 시장 영향도
            </div>
            <div style={{ position: 'relative', height: 24, background: 'var(--color-border-default)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  height: '100%',
                  width: `${impactScore}%`,
                  background: getImportanceColor(event.importance),
                  transition: 'width 0.3s ease',
                }}
              />
              <div
                style={{
                  position: 'relative',
                  zIndex: 1,
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 'var(--font-size-xs)',
                  fontWeight: 600,
                  color: impactScore > 50 ? 'white' : 'var(--color-text-primary)',
                }}
              >
                {impactScore}%
              </div>
            </div>
          </div>
        </>
      )}

      {/* 거래 제약사항 */}
      <div
        style={{
          padding: 'var(--space-2) var(--space-3)',
          background: 'var(--color-bg-surface)',
          borderRadius: 'var(--radius-sm)',
          borderLeft: `3px solid ${getImportanceColor(event.importance)}`,
        }}
      >
        <div className="caption" style={{ lineHeight: 1.6, color: 'var(--color-text-primary)' }}>
          {restriction}
        </div>
      </div>
    </div>
  )
}

/**
 * 경제 캘린더 - 메인 컴포넌트
 */
export default function EconomicCalendar({ events, loading, onRefresh }: EconomicCalendarProps) {
  // 중요도별 분류
  const eventsByImportance = useMemo(() => {
    const critical = events.filter(e => e.importance === 'critical')
    const high = events.filter(e => e.importance === 'high')
    const medium = events.filter(e => e.importance === 'medium')
    const low = events.filter(e => e.importance === 'low')
    return { critical, high, medium, low }
  }, [events])

  const totalImportantEvents = eventsByImportance.critical.length + eventsByImportance.high.length

  if (loading) {
    return (
      <div style={{ marginTop: 'var(--space-4)' }}>
        <div className="card">
          <div style={{ height: 200, background: 'var(--color-border-default)', borderRadius: 'var(--radius-sm)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="muted">데이터 로딩 중...</div>
          </div>
        </div>
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <div style={{ marginTop: 'var(--space-4)' }}>
        <div className="card">
          <div style={{ textAlign: 'center', padding: 'var(--space-6)' }}>
            <div className="muted">예정된 경제 이벤트가 없습니다.</div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 'var(--space-4)' }}>
      {/* 요약 카드 */}
      {totalImportantEvents > 0 && (
        <div
          className="card mb-4"
          style={{
            background: 'var(--color-stock-up-bg)',
            borderLeft: '4px solid var(--color-stock-up)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div className="title-md" style={{ marginBottom: 'var(--space-1)' }}>
                ⭐ {totalImportantEvents}개의 주요 경제 이벤트 예정
              </div>
              <div className="muted">변동성 주의, 포지션 관리 필수</div>
            </div>
          </div>
        </div>
      )}

      {/* Critical 이벤트 */}
      {eventsByImportance.critical.length > 0 && (
        <div style={{ marginBottom: 'var(--space-5)' }}>
          <div className="title-sm" style={{ marginBottom: 'var(--space-2)', color: 'var(--color-stock-up)', fontWeight: 700 }}>
            🔴 최우선 주의 ({eventsByImportance.critical.length})
          </div>
          {eventsByImportance.critical.map(event => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}

      {/* High 이벤트 */}
      {eventsByImportance.high.length > 0 && (
        <div style={{ marginBottom: 'var(--space-5)' }}>
          <div className="title-sm" style={{ marginBottom: 'var(--space-2)', color: '#FF6B35', fontWeight: 700 }}>
            🟠 높음 ({eventsByImportance.high.length})
          </div>
          {eventsByImportance.high.map(event => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}

      {/* Medium 이벤트 */}
      {eventsByImportance.medium.length > 0 && (
        <div style={{ marginBottom: 'var(--space-5)' }}>
          <div className="title-sm" style={{ marginBottom: 'var(--space-2)', color: 'var(--color-warning)', fontWeight: 600 }}>
            🟡 중간 ({eventsByImportance.medium.length})
          </div>
          {eventsByImportance.medium.map(event => (
            <EventCard key={event.id} event={event} />
          ))}
        </div>
      )}

      {/* Low 이벤트 */}
      {eventsByImportance.low.length > 0 && (
        <details style={{ marginTop: 'var(--space-4)' }}>
          <summary
            style={{
              cursor: 'pointer',
              padding: 'var(--space-2) var(--space-3)',
              background: 'var(--color-border-default)',
              borderRadius: 'var(--radius-sm)',
              fontWeight: 600,
              fontSize: 'var(--font-size-sm)',
              color: 'var(--color-text-secondary)',
            }}
          >
            🟢 낮음 ({eventsByImportance.low.length})
          </summary>
          <div style={{ marginTop: 'var(--space-3)' }}>
            {eventsByImportance.low.map(event => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
