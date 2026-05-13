/**
 * 경제 이벤트 미니 배너 - 각 페이지 상단에 표시
 * 모바일 우선, 컴팩트 디자인
 */
import React, { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'
import type { EconomicEvent } from '../../../src/types/economics'

interface EconomicEventBadgeProps {
  onNavigateToCalendar?: () => void
}

function formatTimeUntilEvent(isoString: string): string {
  const date = new Date(isoString)
  const now = new Date()
  const diffMs = date.getTime() - now.getTime()
  const diffHours = Math.round(diffMs / (60 * 60 * 1000))

  if (diffHours < 0) return '발표됨'
  if (diffHours === 0) return '지금'
  if (diffHours < 24) return `${diffHours}시간 후`
  const diffDays = Math.ceil(diffHours / 24)
  if (diffDays <= 7) return `${diffDays}일 후`
  return `${Math.ceil(diffDays / 7)}주 후`
}

export default function EconomicEventBadge({ onNavigateToCalendar }: EconomicEventBadgeProps) {
  const [events, setEvents] = useState<EconomicEvent[]>([])
  const [loading, setLoading] = useState(false)

  const loadEvents = async () => {
    setLoading(true)
    try {
      const result = await apiFetch('/api/economic-calendar?type=upcoming-high-risk', {
        cacheMs: 3_600_000,
        timeoutMs: 5_000,
        retries: 0,
      })

      if (result?.data?.events) {
        setEvents(result.data.events.slice(0, 1)) // 다음 1개만
      }
    } catch (e) {
      // 조용히 실패
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadEvents()
    // 1시간마다 갱신
    const interval = setInterval(() => void loadEvents(), 3_600_000)
    return () => clearInterval(interval)
  }, [])

  if (!events.length) return null

  const event = events[0]
  const isCritical = event.importance === 'critical'
  const timeUntil = formatTimeUntilEvent(event.scheduledAt)

  return (
    <div
      style={{
        background: isCritical ? 'var(--color-stock-up-bg)' : 'var(--color-warning-bg)',
        borderLeft: `3px solid ${isCritical ? 'var(--color-stock-up)' : 'var(--color-warning)'}`,
        padding: 'var(--space-2) var(--space-3)',
        borderRadius: 'var(--radius-sm)',
        marginBottom: 'var(--space-3)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 'var(--space-2)',
        fontSize: 'var(--font-size-xs)',
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: '2px' }}>
          {isCritical ? '⭐' : '📌'} {event.name}
        </div>
        <div style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--font-size-xs)' }}>
          {timeUntil}
          {event.averageKospiReaction && (
            <span style={{ marginLeft: 'var(--space-2)' }}>
              과거 반응: {event.averageKospiReaction >= 0 ? '+' : ''}
              {event.averageKospiReaction.toFixed(2)}%
            </span>
          )}
        </div>
      </div>
      <button
        onClick={onNavigateToCalendar}
        style={{
          padding: '4px 10px',
          background: 'var(--color-brand)',
          color: 'white',
          border: 'none',
          borderRadius: 'var(--radius-xs)',
          cursor: 'pointer',
          fontSize: 'var(--font-size-xs)',
          fontWeight: 600,
          whiteSpace: 'nowrap',
          transition: 'opacity 0.2s',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.8')}
        onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
      >
        캘린더
      </button>
    </div>
  )
}
