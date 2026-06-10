/**
 * 거시경제 이벤트 사전 경고 서비스
 *
 * D-5: "주의" — 이벤트 예보, 포지션 점검 권고
 * D-3: "경계" — 신규 진입 자제 권고
 * D-1: "위험" — 신규 매수 차단, 수익 포지션 정리 권고
 * D-0: "당일" — 장중 변동성 최고, 매매 자제
 */

import { getUpcomingMarketEvents, daysUntil, type MarketEvent } from '../utils/marketEventCalendar'
import { fetchUpcomingHighRiskEvents } from '../utils/fetchEconomicCalendar'
import type { EconomicEvent } from '../types/economics'

export type WarningUrgency = 'watch' | 'caution' | 'danger' | 'today'

export type EventWarning = {
  daysUntil: number
  urgency: WarningUrgency
  label: string
  date: string
  importance: 'critical' | 'high'
  action: string
  blockBuy: boolean
}

export type MacroWarningResult = {
  warnings: EventWarning[]
  hasBlockBuy: boolean
  highestUrgency: WarningUrgency | null
  telegramMessage: string | null
  autotradeNote: string | null
}

function resolveUrgency(days: number, importance: 'critical' | 'high'): WarningUrgency | null {
  if (days < 0) return null
  if (days === 0) return 'today'
  if (importance === 'critical') {
    if (days === 1) return 'danger'
    if (days <= 3) return 'caution'
    if (days <= 5) return 'watch'
    return null
  }
  // high importance
  if (days === 1) return 'caution'
  if (days <= 3) return 'watch'
  return null
}

function shouldBlockBuy(urgency: WarningUrgency, importance: 'critical' | 'high'): boolean {
  if (urgency === 'today') return true
  if (urgency === 'danger' && importance === 'critical') return true
  return false
}

function urgencyRank(u: WarningUrgency): number {
  return { today: 4, danger: 3, caution: 2, watch: 1 }[u]
}

function resolveAction(urgency: WarningUrgency, importance: 'critical' | 'high'): string {
  switch (urgency) {
    case 'today':
      return importance === 'critical'
        ? '매매 자제 · 수익 포지션 익절 우선'
        : '장중 변동성 주의'
    case 'danger':
      return importance === 'critical'
        ? '신규 매수 차단 · 수익 포지션 일부 정리 권고'
        : '신규 진입 자제'
    case 'caution':
      return '포지션 규모 축소 · 손절선 재확인'
    case 'watch':
      return '포지션 점검 · 이벤트 결과 모니터링 준비'
  }
}

function urgencyEmoji(urgency: WarningUrgency): string {
  return { today: '🚨', danger: '⚠️', caution: '🔶', watch: '🔔' }[urgency]
}

/** 경제 이벤트와 시장 만기 이벤트를 합쳐 D-N 경고 목록 반환 */
export async function getMacroWarnings(now?: Date): Promise<MacroWarningResult> {
  const base = now ?? new Date()

  const [economicEvents, marketEvents] = await Promise.all([
    fetchUpcomingHighRiskEvents().catch(() => [] as EconomicEvent[]),
    Promise.resolve(getUpcomingMarketEvents(7, base)),
  ])

  const warnings: EventWarning[] = []

  for (const event of economicEvents) {
    const eventDate = event.scheduledAt.slice(0, 10)
    const days = daysUntil(eventDate, base)
    const importance = event.importance === 'critical' ? 'critical' : 'high'
    const urgency = resolveUrgency(days, importance)
    if (!urgency) continue

    warnings.push({
      daysUntil: days,
      urgency,
      label: event.name,
      date: eventDate,
      importance,
      action: resolveAction(urgency, importance),
      blockBuy: shouldBlockBuy(urgency, importance),
    })
  }

  for (const event of marketEvents) {
    const days = daysUntil(event.date, base)
    const urgency = resolveUrgency(days, event.importance)
    if (!urgency) continue

    warnings.push({
      daysUntil: days,
      urgency,
      label: event.label,
      date: event.date,
      importance: event.importance,
      action: resolveAction(urgency, event.importance),
      blockBuy: shouldBlockBuy(urgency, event.importance),
    })
  }

  // 중복 날짜+이름 제거 후 긴급도 순 정렬
  const seen = new Set<string>()
  const deduped = warnings
    .filter((w) => {
      const key = `${w.date}|${w.label}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => urgencyRank(b.urgency) - urgencyRank(a.urgency) || a.daysUntil - b.daysUntil)

  const hasBlockBuy = deduped.some((w) => w.blockBuy)
  const highestUrgency = deduped.length > 0 ? deduped[0].urgency : null

  return {
    warnings: deduped,
    hasBlockBuy,
    highestUrgency,
    telegramMessage: buildTelegramWarningMessage(deduped),
    autotradeNote: buildAutotradeNote(deduped, hasBlockBuy),
  }
}

/** 브리핑에 포함할 텔레그램 HTML 경고 블록 생성 */
export function buildTelegramWarningMessage(warnings: EventWarning[]): string | null {
  if (warnings.length === 0) return null

  const lines: string[] = []
  lines.push('<b>📅 거시경제 이벤트 경보</b>')

  for (const w of warnings) {
    const emoji = urgencyEmoji(w.urgency)
    const dayLabel =
      w.daysUntil === 0 ? '오늘' :
      w.daysUntil === 1 ? '내일' :
      `D-${w.daysUntil}`
    lines.push(`${emoji} <b>${w.label}</b> (${dayLabel}, ${w.date})`)
    lines.push(`   → ${w.action}`)
  }

  return lines.join('\n')
}

/** 가상매매 로그용 짧은 노트 생성 */
function buildAutotradeNote(warnings: EventWarning[], hasBlockBuy: boolean): string | null {
  if (warnings.length === 0) return null
  const top = warnings[0]
  const prefix = hasBlockBuy ? '[매수차단]' : '[주의]'
  return `${prefix} ${top.label} D-${top.daysUntil} (${top.urgency})`
}

/**
 * 가상매매에서 신규 매수 차단 여부 판단
 * blockBuyDays 이내 critical 이벤트 존재 시 차단
 */
export async function checkAutotradeBuyBlock(now?: Date): Promise<{
  blocked: boolean
  reason: string | null
}> {
  try {
    const result = await getMacroWarnings(now)
    if (result.hasBlockBuy) {
      const blocking = result.warnings.find((w) => w.blockBuy)
      return {
        blocked: true,
        reason: blocking
          ? `매크로 이벤트 경계: ${blocking.label} D-${blocking.daysUntil} (${blocking.urgency})`
          : '매크로 이벤트 경계 구간',
      }
    }
    return { blocked: false, reason: null }
  } catch {
    return { blocked: false, reason: null }
  }
}
