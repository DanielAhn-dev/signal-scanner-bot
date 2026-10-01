/**
 * 거시경제 이벤트 사전 경고 서비스 — 일정을 알려 주기만 하고 매수를 막지 않는다.
 *
 * 예전엔 D-1·당일에 신규 매수를 차단하고 "매매 자제·익절 우선"을 권했다. 코스피로 검증한 결과(2026-09-29):
 *   - FOMC(1997~, 232회)·CPI(1999~, 325회) 차단일은 전체 거래일의 14.4%인데, 그날 매수한 1·5·20일 수익이
 *     평소와 차이 없음(t=+0.6/-0.3/+0.5). 구간별로 보이던 차이는 방향이 뒤집혀(FOMC 전체 1일 t=+2.6, 2010~ 5일 t=-2.0) 우연.
 *   - 만기일(옵션·네마녀·미국 쿼드위칭)도 차이 없음 (marketEventCalendar.ts blockBuyDays 주석).
 *   - CPI 다음 날은 변동폭이 조금 크다(1.21% vs 1.04%) — 알려 줄 가치는 있지만 매수를 피할 근거는 아니다.
 * 검증 스크립트·발표일 출처: 연준 FOMC 연도별 기록, BLS CPI 발표 아카이브.
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


function urgencyRank(u: WarningUrgency): number {
  return { today: 4, danger: 3, caution: 2, watch: 1 }[u]
}

/**
 * 행동 지시 대신 사실만 — 매매 규칙은 이벤트와 무관하게 그대로 간다.
 * "영향 없음"은 검증한 이벤트(FOMC 금리 결정·CPI·NFP)에만 쓴다. 나머지는 검증 전이라 일정만 알린다.
 * NFP 검증(2026-10-01, scripts/research/validate_nfp_event.py, 코스피 1996~2026 357건):
 * 발표 다음 거래일 1·5·20일 수익이 평소와 차이 없음(t=-0.04/0.02/0.06) — FOMC·CPI와 같은 결론.
 */
function resolveAction(urgency: WarningUrgency, name: string): string {
  const verified = /FOMC 금리|CPI|비농업고용/.test(name)
  const near = urgency === 'today' || urgency === 'danger'
  if (verified) {
    return near
      ? '발표 뒤 등락이 평소보다 조금 클 수 있음 · 과거 매수 타이밍 영향 없음(규칙대로 진행)'
      : '일정 참고 · 과거 매수 타이밍 영향 없음'
  }
  return '일정 참고 (매수 차단 안 함 · 시장 영향 미검증)'
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
    // 경제 일정 API는 만기일 이벤트(id "market-…")도 섞어 준다 — 만기일은 아래 루프에서만 다룬다
    // (여기서 받으면 critical로 매수 차단되고, 같은 이름이라 중복 제거에서도 차단 쪽이 남았다)
    if (String(event.id ?? '').startsWith('market-')) continue
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
      action: resolveAction(urgency, event.name),
      blockBuy: false,
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
      action: '참고 — 과거 30년 코스피 영향 없음',
      blockBuy: false,
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
 * 가상매매 신규 매수 차단 여부 — 검증 결과 차단할 이벤트가 없어 지금은 항상 통과한다.
 * 새 이벤트 차단을 넣으려면 먼저 같은 방식(차단일 매수 vs 평소)으로 검증하고 blockBuy를 켠다.
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
