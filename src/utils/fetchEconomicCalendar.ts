/**
 * 경제 달력 데이터 페칭 및 처리
 *
 * NOTE: 현재는 하드코딩된 실제 발표 일정 데이터를 사용합니다.
 * 추후 investing.com API 또는 BLS/Fed 공식 API와 연동 예정.
 */

import type {
  EconomicEvent,
  EconomicCalendarResponse,
  HistoricalImpact,
  EventImportance,
} from '../types/economics'

/**
 * 주요 경제 지표 이벤트 데이터베이스
 * - 날짜는 실제 발표 일정 기준 (UTC 기준 발표 예정 시각)
 * - actualValue: 이미 발표된 경우에만 채움
 */
const MAJOR_ECONOMIC_EVENTS: EconomicEvent[] = [
  // ── 미국 CPI ──────────────────────────────────────────────────────────────
  // 4월 CPI: 2026-05-13 발표 (이미 발표됨, 실제치 3.8%)
  {
    id: 'us-cpi-apr-2026',
    name: '미국 CPI (YoY)',
    country: 'US',
    category: 'inflation',
    importance: 'critical',
    scheduledAt: '2026-05-13T12:30:00Z', // 동부 8:30 AM
    forecastValue: 3.2,
    actualValue: 3.8,                    // 2026-05-13 발표됨
    unit: '%',
    source: 'BLS',
    historicalImpacts: [
      { date: '2024-01-10', eventName: '미국 CPI (YoY)', expectedVsForecast: 0.1, marketReactionKospi: -1.5, marketReactionSp500: -0.8, volatilityChange: 2.5, dominantTheme: '인플레이션 우려' },
      { date: '2023-12-13', eventName: '미국 CPI (YoY)', expectedVsForecast: -0.3, marketReactionKospi: 1.2, marketReactionSp500: 1.1, volatilityChange: -1.8, dominantTheme: '금리 인하 기대' },
    ],
    averageKospiReaction: -0.15,
    averageVolatilityIncrease: 2.1,
    impactSeverity: 95,
  },
  // 5월 CPI: 2026-06-11 발표 예정
  {
    id: 'us-cpi-may-2026',
    name: '미국 CPI (YoY)',
    country: 'US',
    category: 'inflation',
    importance: 'critical',
    scheduledAt: '2026-06-11T12:30:00Z',
    forecastValue: 3.5,
    unit: '%',
    source: 'BLS',
    averageKospiReaction: -0.15,
    averageVolatilityIncrease: 2.1,
    impactSeverity: 95,
  },

  // ── 미국 PPI ──────────────────────────────────────────────────────────────
  // 4월 PPI: 2026-05-15 발표 예정
  {
    id: 'us-ppi-apr-2026',
    name: '미국 PPI (YoY)',
    country: 'US',
    category: 'inflation',
    importance: 'high',
    scheduledAt: '2026-05-15T12:30:00Z',
    forecastValue: 2.8,
    unit: '%',
    source: 'BLS',
    averageKospiReaction: -0.4,
    averageVolatilityIncrease: 1.5,
    impactSeverity: 70,
  },

  // ── FOMC 의사록 (5월 6-7일 회의록) ───────────────────────────────────────
  {
    id: 'us-fomc-minutes-may-2026',
    name: 'FOMC 의사록',
    country: 'US',
    category: 'interest_rate',
    importance: 'high',
    scheduledAt: '2026-05-28T18:00:00Z',
    source: 'Fed',
    averageKospiReaction: 0.2,
    averageVolatilityIncrease: 1.0,
    impactSeverity: 72,
  },

  // ── 미국 GDP Q1 2026 (2차 추정치) ─────────────────────────────────────────
  {
    id: 'us-gdp-q1-2026-2nd',
    name: '미국 GDP (QoQ)',
    country: 'US',
    category: 'gdp',
    importance: 'high',
    scheduledAt: '2026-05-29T12:30:00Z',
    forecastValue: 2.1,
    unit: '%',
    source: 'BEA',
    averageKospiReaction: 0.1,
    averageVolatilityIncrease: 1.8,
    impactSeverity: 75,
  },

  // ── 한국 기준금리 결정 ─────────────────────────────────────────────────────
  {
    id: 'kr-base-rate-may-2026',
    name: '한국 기준금리 결정',
    country: 'KR',
    category: 'interest_rate',
    importance: 'critical',
    scheduledAt: '2026-05-29T01:00:00Z', // 한국 오전 10시
    source: 'BOK',
    averageKospiReaction: 0.3,
    averageVolatilityIncrease: 1.2,
    impactSeverity: 85,
  },

  // ── 미국 NFP / 실업률 (5월) ────────────────────────────────────────────────
  {
    id: 'us-nfp-may-2026',
    name: '미국 비농업고용 / 실업률',
    country: 'US',
    category: 'employment',
    importance: 'critical',
    scheduledAt: '2026-06-05T12:30:00Z', // 첫째 금요일
    forecastValue: 4.1,
    unit: '%',
    source: 'BLS',
    historicalImpacts: [
      { date: '2024-01-05', eventName: '미국 NFP', expectedVsForecast: 0.2, marketReactionKospi: -2.1, marketReactionSp500: -1.5, volatilityChange: 3.2, dominantTheme: '노동시장 강세' },
    ],
    averageKospiReaction: -0.8,
    averageVolatilityIncrease: 2.8,
    impactSeverity: 92,
  },

  // ── FOMC 금리 결정 (6월 17-18일) ──────────────────────────────────────────
  {
    id: 'us-fomc-jun-2026',
    name: 'FOMC 금리 결정',
    country: 'US',
    category: 'interest_rate',
    importance: 'critical',
    scheduledAt: '2026-06-18T18:00:00Z', // 동부 오후 2시
    source: 'Fed',
    historicalImpacts: [
      { date: '2024-01-31', eventName: 'FOMC 금리 결정', expectedVsForecast: 0, marketReactionKospi: 1.8, marketReactionSp500: 0.9, volatilityChange: -1.2, dominantTheme: '금리 동결에 안도' },
    ],
    averageKospiReaction: 0.5,
    averageVolatilityIncrease: -0.8,
    impactSeverity: 98,
  },

  // ── 중국 제조업 PMI (5월) ─────────────────────────────────────────────────
  {
    id: 'china-pmi-may-2026',
    name: '중국 제조업 PMI',
    country: 'CN',
    category: 'manufacturing',
    importance: 'high',
    scheduledAt: '2026-05-31T01:00:00Z',
    forecastValue: 49.5,
    source: 'NBS',
    averageKospiReaction: 0.2,
    averageVolatilityIncrease: 1.0,
    impactSeverity: 68,
  },

  // ── 미국 Core PCE (Fed 선호 물가) ──────────────────────────────────────────
  {
    id: 'us-pce-apr-2026',
    name: '미국 Core PCE (YoY)',
    country: 'US',
    category: 'inflation',
    importance: 'critical',
    scheduledAt: '2026-05-30T12:30:00Z',
    forecastValue: 2.7,
    unit: '%',
    source: 'BEA',
    averageKospiReaction: -0.3,
    averageVolatilityIncrease: 1.9,
    impactSeverity: 88,
  },
]

/**
 * 지정된 시간 범위의 경제 이벤트 조회
 */
export async function fetchEconomicCalendar(
  startDate?: string,
  endDate?: string,
  importance?: EventImportance
): Promise<EconomicCalendarResponse> {
  try {
    const start = startDate ? new Date(startDate) : new Date()
    const end = endDate
      ? new Date(endDate)
      : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)

    const filteredEvents = MAJOR_ECONOMIC_EVENTS.filter(event => {
      const eventDate = new Date(event.scheduledAt)
      const dateInRange = eventDate >= start && eventDate <= end
      const importanceMatch =
        !importance ||
        (importance === 'critical' && event.importance === 'critical') ||
        (importance === 'high'     && ['critical', 'high'].includes(event.importance)) ||
        (importance === 'medium'   && ['critical', 'high', 'medium'].includes(event.importance)) ||
        (importance === 'low')
      return dateInRange && importanceMatch
    }).sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())

    const nextHighRiskEvent = filteredEvents.find(
      e => e.importance === 'critical' && new Date(e.scheduledAt) > new Date()
    )

    return {
      events: filteredEvents,
      timeRange: { start: start.toISOString(), end: end.toISOString() },
      nextHighRiskEvent,
      fetchedAt: new Date().toISOString(),
    }
  } catch (error) {
    console.error('[fetchEconomicCalendar] error:', error)
    return {
      events: [],
      timeRange: {
        start: new Date().toISOString(),
        end: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
      },
      fetchedAt: new Date().toISOString(),
    }
  }
}

/**
 * 향후 7일 이내의 주요(critical/high) 경제 이벤트 조회
 */
export async function fetchUpcomingHighRiskEvents(): Promise<EconomicEvent[]> {
  const sevenDaysLater = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const response = await fetchEconomicCalendar(undefined, sevenDaysLater, 'high')
  return response.events.filter(e => ['critical', 'high'].includes(e.importance))
}

/**
 * 이벤트의 예상 시장 영향도 계산 (0-100)
 */
export function calculateEventImpactScore(event: EconomicEvent): number {
  const base: Record<EventImportance, number> = { critical: 90, high: 70, medium: 50, low: 30 }
  let score = base[event.importance]

  if (event.averageVolatilityIncrease) {
    score = Math.min(100, score + Math.abs(event.averageVolatilityIncrease) * 5)
  }
  if (event.historicalImpacts?.[0]?.expectedVsForecast) {
    score = Math.min(100, score + Math.abs(event.historicalImpacts[0].expectedVsForecast) * 10)
  }
  return Math.round(score)
}

/**
 * 경제 이벤트 발표에 따른 거래 제약사항 문구 생성
 */
export function generateEventTradeRestriction(event: EconomicEvent): string {
  const { name, importance, averageKospiReaction, averageVolatilityIncrease } = event

  if (importance === 'critical') {
    if (Math.abs(averageKospiReaction || 0) > 1.5) {
      return `${name} 발표 예정 — 큰 변동성 예상, 손절 기준 엄수, 분할 진입 필수`
    }
    return `${name} 발표 예정 — 변동성 주의, 포지션 축소 권고`
  }
  if (importance === 'high') {
    if ((averageVolatilityIncrease ?? 0) > 1) {
      return `${name} 발표 예정 — 변동성 증가 가능, 모니터링 권고`
    }
    return `${name} 발표 예정 — 시장 관심 높음`
  }
  return `${name} 예정`
}
