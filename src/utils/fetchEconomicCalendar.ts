/**
 * 경제 달력 데이터 페칭 및 처리
 */

import type {
  EconomicEvent,
  EconomicCalendarResponse,
  HistoricalImpact,
  EventImportance,
} from '../types/economics'

/**
 * 주요 경제 지표 이벤트 데이터베이스 (고정 데이터)
 * 실제로는 investing.com API 또는 다른 소스와 연동 가능
 */
const MAJOR_ECONOMIC_EVENTS: EconomicEvent[] = [
  // 미국 CPI (월간, 중요도: 높음)
  {
    id: 'us-cpi-monthly',
    name: '미국 CPI (YoY)',
    country: 'US',
    category: 'inflation',
    importance: 'critical',
    scheduledAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    forecastValue: 3.2,
    unit: '%',
    source: 'investing.com',
    historicalImpacts: [
      {
        date: '2024-01-10',
        eventName: '미국 CPI (YoY)',
        expectedVsForecast: 0.1,
        marketReactionKospi: -1.5,
        marketReactionSp500: -0.8,
        volatilityChange: 2.5,
        dominantTheme: '인플레이션 우려',
      },
      {
        date: '2023-12-13',
        eventName: '미국 CPI (YoY)',
        expectedVsForecast: -0.3,
        marketReactionKospi: 1.2,
        marketReactionSp500: 1.1,
        volatilityChange: -1.8,
        dominantTheme: '금리 인하 기대',
      },
    ],
    averageKospiReaction: -0.15,
    averageVolatilityIncrease: 2.1,
    impactSeverity: 95,
  },

  // 미국 실업률
  {
    id: 'us-unemployment',
    name: '미국 실업률 (NFP)',
    country: 'US',
    category: 'employment',
    importance: 'critical',
    scheduledAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    forecastValue: 4.1,
    unit: '%',
    source: 'investing.com',
    historicalImpacts: [
      {
        date: '2024-01-05',
        eventName: '미국 실업률 (NFP)',
        expectedVsForecast: 0.2,
        marketReactionKospi: -2.1,
        marketReactionSp500: -1.5,
        volatilityChange: 3.2,
        dominantTheme: '노동시장 강세',
      },
    ],
    averageKospiReaction: -0.8,
    averageVolatilityIncrease: 2.8,
    impactSeverity: 92,
  },

  // 미국 PPI
  {
    id: 'us-ppi',
    name: '미국 PPI (YoY)',
    country: 'US',
    category: 'inflation',
    importance: 'high',
    scheduledAt: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString(),
    forecastValue: 2.8,
    unit: '%',
    source: 'investing.com',
    averageKospiReaction: -0.4,
    averageVolatilityIncrease: 1.5,
    impactSeverity: 70,
  },

  // FOMC 금리 결정
  {
    id: 'us-fomc',
    name: 'FOMC 금리 결정',
    country: 'US',
    category: 'interest_rate',
    importance: 'critical',
    scheduledAt: new Date(Date.now() + 28 * 24 * 60 * 60 * 1000).toISOString(),
    source: 'investing.com',
    historicalImpacts: [
      {
        date: '2024-01-31',
        eventName: 'FOMC 금리 결정',
        expectedVsForecast: 0,
        marketReactionKospi: 1.8,
        marketReactionSp500: 0.9,
        volatilityChange: -1.2,
        dominantTheme: '금리 동결에 안도',
      },
    ],
    averageKospiReaction: 0.5,
    averageVolatilityIncrease: -0.8,
    impactSeverity: 98,
  },

  // 한국 기준금리
  {
    id: 'kr-base-rate',
    name: '한국 기준금리 결정',
    country: 'KR',
    category: 'interest_rate',
    importance: 'critical',
    scheduledAt: new Date(Date.now() + 35 * 24 * 60 * 60 * 1000).toISOString(),
    source: 'investing.com',
    averageKospiReaction: 0.3,
    averageVolatilityIncrease: 1.2,
    impactSeverity: 85,
  },

  // 미국 GDP
  {
    id: 'us-gdp',
    name: '미국 GDP (QoQ)',
    country: 'US',
    category: 'gdp',
    importance: 'high',
    scheduledAt: new Date(Date.now() + 42 * 24 * 60 * 60 * 1000).toISOString(),
    forecastValue: 2.1,
    unit: '%',
    source: 'investing.com',
    averageKospiReaction: 0.1,
    averageVolatilityIncrease: 1.8,
    impactSeverity: 75,
  },

  // 중국 제조업 PMI
  {
    id: 'china-manufacturing-pmi',
    name: '중국 제조업 PMI',
    country: 'CN',
    category: 'manufacturing',
    importance: 'high',
    scheduledAt: new Date(Date.now() + 49 * 24 * 60 * 60 * 1000).toISOString(),
    forecastValue: 49.5,
    source: 'investing.com',
    averageKospiReaction: 0.2,
    averageVolatilityIncrease: 1.0,
    impactSeverity: 68,
  },
]

/**
 * 지정된 시간 범위의 경제 이벤트 조회
 * @param startDate ISO 8601 형식의 시작 날짜
 * @param endDate ISO 8601 형식의 종료 날짜
 * @param importance 필터: 특정 중요도 이상만 반환
 */
export async function fetchEconomicCalendar(
  startDate?: string,
  endDate?: string,
  importance?: EventImportance
): Promise<EconomicCalendarResponse> {
  try {
    const start = startDate ? new Date(startDate) : new Date()
    const end = endDate ? new Date(endDate) : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)

    // 고정 데이터에서 필터링
    const filteredEvents = MAJOR_ECONOMIC_EVENTS.filter(event => {
      const eventDate = new Date(event.scheduledAt)
      const dateInRange = eventDate >= start && eventDate <= end
      const importanceMatch =
        !importance ||
        (importance === 'critical' && ['critical'].includes(event.importance)) ||
        (importance === 'high' && ['critical', 'high'].includes(event.importance)) ||
        (importance === 'medium' && ['critical', 'high', 'medium'].includes(event.importance)) ||
        (importance === 'low' && ['critical', 'high', 'medium', 'low'].includes(event.importance))

      return dateInRange && importanceMatch
    }).sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())

    const nextHighRiskEvent = MAJOR_ECONOMIC_EVENTS.find(
      e => e.importance === 'critical' && new Date(e.scheduledAt) > new Date()
    )

    return {
      events: filteredEvents,
      timeRange: {
        start: start.toISOString(),
        end: end.toISOString(),
      },
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
 * 이벤트의 예상 시장 영향도 계산
 */
export function calculateEventImpactScore(event: EconomicEvent): number {
  let score = 0

  // 중요도 기본값
  const importanceScore: Record<EventImportance, number> = {
    critical: 90,
    high: 70,
    medium: 50,
    low: 30,
  }
  score += importanceScore[event.importance]

  // 역사적 변동성이 있으면 추가
  if (event.averageVolatilityIncrease) {
    const volatilityBonus = Math.abs(event.averageVolatilityIncrease) * 5
    score = Math.min(100, score + volatilityBonus)
  }

  // 사전예측과의 차이가 있는 역사적 이벤트가 있으면 변동성 증가 예상
  if (event.historicalImpacts?.[0]?.expectedVsForecast) {
    const expectancyScore = Math.abs(event.historicalImpacts[0].expectedVsForecast) * 10
    score = Math.min(100, score + expectancyScore)
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
      return `⚠️ ${name} 발표 예정: 큰 변동성 예상, 손절 기준 -3% 이상 엄수, 분할 진입 필수`
    }
    return `📢 ${name} 발표 예정: 변동성 주의, 포지션 축소 권고`
  }

  if (importance === 'high') {
    if (averageVolatilityIncrease && averageVolatilityIncrease > 1) {
      return `📊 ${name} 발표 예정: 변동성 증가 가능, 주의깊게 모니터링`
    }
    return `ℹ️ ${name} 발표 예정: 시장 관심 높음`
  }

  return `ℹ️ ${name} 예정`
}
