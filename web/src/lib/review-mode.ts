/**
 * Review mode utility - allows viewing UI without authentication
 * Usage: ?review=1
 */

export function isReviewMode(): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('review') === '1'
}

/**
 * Mock response for a given API route
 */
export function getMockResponse(path: string): any {
  if (!isReviewMode()) return null

  // Normalize various URL formats to route name
  let route: string = ''
  
  // Extract route from different URL formats:
  // - http://localhost:3000/api/ui?route=summary
  // - http://localhost:3000/api/ui?route=sectors&top=8
  // - /api/ui?route=summary
  if (path.includes('route=')) {
    const m = path.match(/route=([^&]+)/)
    route = m?.[1] ? decodeURIComponent(m[1]) : ''
  } else if (path.includes('/api/ui/')) {
    const m = path.match(/\/api\/ui\/([^/?]+)/)
    route = m?.[1] || ''
  }

  // Debug logging
  if (route) {
    console.log('[Review Mode] Fetching mock for route:', route, 'from path:', path)
  }

  // Mock data by route
  const mocks: Record<string, any> = {
    summary: {
      positions: 3,
      unrealized_pnl_sum: 1250000,
      last_scan_at: new Date().toISOString(),
    },
    sectors: {
      data: [
        { id: '1', name: '반도체', score: 82, change_rate: 2.5 },
        { id: '2', name: '에너지', score: 76, change_rate: -1.2 },
        { id: '3', name: '은행', score: 72, change_rate: 0.8 },
        { id: '4', name: '유틸리티', score: 68, change_rate: 1.1 },
        { id: '5', name: '헬스케어', score: 65, change_rate: -0.3 },
        { id: '6', name: '통신', score: 62, change_rate: 0.5 },
        { id: '7', name: '부동산', score: 58, change_rate: -0.7 },
        { id: '8', name: '기술', score: 55, change_rate: 1.9 },
      ],
    },
    'scan-highlights': {
      data: [
        {
          code: '005930',
          name: '삼성전자',
          entry_price: 70000,
          current_price: 71500,
          confidence_pct: 85,
          reason: 'RSI 과매도 회복',
        },
        {
          code: '000660',
          name: 'SK하이닉스',
          entry_price: 140000,
          current_price: 142500,
          confidence_pct: 78,
          reason: '기술적 지지선 반발',
        },
        {
          code: '373220',
          name: 'LG에너지솔루션',
          entry_price: 650000,
          current_price: 660000,
          confidence_pct: 72,
          reason: '이동평균선 정렬',
        },
      ],
    },
    'discovery-picks': {
      picks: [
        {
          rank: 1,
          code: '012330',
          name: '현대모비스',
          sector: '자동차부품',
          match_score: 92,
          reasons: ['성장성', '저평가'],
        },
        {
          rank: 2,
          code: '175330',
          name: 'JB금융지주',
          sector: '금융',
          match_score: 88,
          reasons: ['배당성', '기술적 정렬'],
        },
        {
          rank: 3,
          code: '066570',
          name: 'LG전자',
          sector: '전자',
          match_score: 85,
          reasons: ['섹터 모멘텀', '기술적 지지'],
        },
        {
          rank: 4,
          code: '015760',
          name: '한국전력',
          sector: '전력',
          match_score: 81,
          reasons: ['정책 지원', '배당률'],
        },
        {
          rank: 5,
          code: '034020',
          name: '두산중공업',
          sector: '기계',
          match_score: 77,
          reasons: ['에너지 전환', '기술적 회복'],
        },
      ],
      funnel: {
        initial: 1500,
        passed_fundamental: 420,
        passed_technical: 85,
        final: 5,
      },
      fetchedAt: new Date().toISOString(),
    },
  }

  const result = mocks[route]
  if (result) {
    console.log('[Review Mode] Returning mock data for route:', route)
  }
  return result || null
}
