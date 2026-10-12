/**
 * 경제 이벤트 영향도·거래 제약 문구 — 순수 함수만 둔다.
 * 웹(web/src/components/EconomicCalendar.tsx)도 import하므로 서버 의존성(supabase 등)을 넣지 않는다.
 */
import type { EconomicEvent, EventImportance } from '../types/economics'

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
