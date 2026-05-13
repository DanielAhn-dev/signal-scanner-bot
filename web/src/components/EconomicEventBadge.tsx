/**
 * 경제 이벤트 미니 배너 - 각 페이지 상단에 표시
 * 모바일 우선, 컴팩트 디자인
 */
import React, { useEffect, useState } from 'react'
import { AlertTriangle, CalendarDays, MapPin } from 'lucide-react'
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
    <div className={`economic-event-badge${isCritical ? ' is-critical' : ''}`}>
      <div className="economic-event-badge-main">
        <div className="economic-event-badge-title">
          {isCritical ? <AlertTriangle size={14} aria-hidden /> : <MapPin size={14} aria-hidden />}
          <span>{event.name}</span>
        </div>
        <div className="economic-event-badge-meta">
          {timeUntil}
          {event.averageKospiReaction && (
            <span className="economic-event-badge-reaction">
              과거 반응: {event.averageKospiReaction >= 0 ? '+' : ''}
              {event.averageKospiReaction.toFixed(2)}%
            </span>
          )}
        </div>
      </div>
      <button
        className="ui-button ui-btn-primary ui-btn-sm"
        onClick={onNavigateToCalendar}
      >
        <CalendarDays size={14} aria-hidden />
        캘린더
      </button>
    </div>
  )
}
