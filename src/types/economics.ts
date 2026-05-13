/**
 * 경제 이벤트 및 경제 달력 관련 타입 정의
 */

/** 경제 이벤트 중요도 레벨 */
export type EventImportance = 'low' | 'medium' | 'high' | 'critical'

/** 경제 이벤트 영향 방향 */
export type EventImpactDirection = 'positive' | 'negative' | 'neutral'

/** 경제 지표 카테고리 */
export type EconomicCategory =
  | 'employment'      // 고용지표 (실업률, 초청청구 등)
  | 'inflation'       // 인플레이션 (CPI, PPI 등)
  | 'interest_rate'   // 금리 결정
  | 'gdp'             // GDP
  | 'housing'         // 주택 시장
  | 'consumer'        // 소비자 지표
  | 'manufacturing'   // 제조업
  | 'sentiment'       // 심리지수
  | 'trade'           // 무역
  | 'other'           // 기타

/** 과거 이벤트의 시장 임팩트 기록 */
export type HistoricalImpact = {
  date: string                      // YYYY-MM-DD
  eventName: string
  expectedVsForecast?: number        // 예상 vs 사전 예측 차이 (%)
  marketReactionKospi?: number       // KOSPI 일일 변동율 (%)
  marketReactionKosdaq?: number      // KOSDAQ 일일 변동율 (%)
  marketReactionSp500?: number       // S&P500 일일 변동율 (%)
  volatilityChange?: number          // VIX 변동 (포인트)
  dominantTheme?: string             // 주요 반응 테마
}

/** 경제 이벤트 (예정) */
export type EconomicEvent = {
  id: string                         // Unique identifier
  name: string                       // 이벤트명 (e.g., "미국 CPI (YoY)")
  country: string                    // 국가 코드 (US, KR, JP 등)
  category: EconomicCategory
  importance: EventImportance
  scheduledAt: string                // ISO 8601 형식 예정 시각
  previousValue?: number
  forecastValue?: number
  actualValue?: number               // 발표 후 채워짐
  unit?: string                      // 단위 (%, pp 등)
  source?: string                    // 데이터 소스 (investing.com 등)
  
  // 역사적 영향 데이터
  historicalImpacts?: HistoricalImpact[]
  averageKospiReaction?: number      // 과거 평균 KOSPI 반응 (%)
  averageVolatilityIncrease?: number // 과거 평균 변동성 증가 (포인트)
  impactSeverity?: number            // 0-100 (시장 영향도 점수)
}

/** 경제 캘린더 조회 응답 */
export type EconomicCalendarResponse = {
  events: EconomicEvent[]
  timeRange: {
    start: string                    // ISO 8601
    end: string                      // ISO 8601
  }
  nextHighRiskEvent?: EconomicEvent  // 다음 주요 이벤트
  fetchedAt: string                  // ISO 8601
}

/** 경제 이벤트 필터 옵션 */
export type EconomicEventFilter = {
  importance?: EventImportance[]
  countries?: string[]
  categories?: EconomicCategory[]
  startDate?: string                 // YYYY-MM-DD
  endDate?: string                   // YYYY-MM-DD
}

/** 이벤트 영향으로 인한 거래 제약사항 */
export type EventTradeRestriction = {
  eventId: string
  eventName: string
  restriction: string
  severity: 'info' | 'warning' | 'danger'
  suggestedAction?: string           // 권장 매매 방식
}
