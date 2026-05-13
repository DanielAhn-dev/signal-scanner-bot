const UI_REVIEW_STORAGE_KEY = 'signal_scanner_ui_review_mode'

type EconomicEventResponse = {
  data: {
    events: Array<{
      id: string
      name: string
      country: string
      importance: 'high' | 'critical'
      scheduledAt: string
      averageKospiReaction?: number
    }>
  }
}

function readReviewFlagFromLocation(): boolean {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  const value = params.get('review')
  return value === '1' || value === 'true'
}

function readReviewFlagFromStorage(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.sessionStorage.getItem(UI_REVIEW_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function persistReviewFlag(enabled: boolean) {
  if (typeof window === 'undefined') return
  try {
    if (enabled) window.sessionStorage.setItem(UI_REVIEW_STORAGE_KEY, '1')
    else window.sessionStorage.removeItem(UI_REVIEW_STORAGE_KEY)
  } catch {
    // ignore
  }
}

export function isUiReviewMode(): boolean {
  const envValue = String(import.meta.env.VITE_UI_REVIEW_MODE || '').trim().toLowerCase()
  if (envValue === '1' || envValue === 'true') return true

  const fromLocation = readReviewFlagFromLocation()
  if (fromLocation) {
    persistReviewFlag(true)
    return true
  }

  return readReviewFlagFromStorage()
}

export function enableUiReviewMode() {
  persistReviewFlag(true)
}

function makeMockStocks() {
  const seed = [
    { code: '005930', name: '삼성전자', sector_id: 'semiconductor' },
    { code: '000660', name: 'SK하이닉스', sector_id: 'semiconductor' },
    { code: '035420', name: 'NAVER', sector_id: 'platform' },
    { code: '051910', name: 'LG화학', sector_id: 'secondary-battery' },
    { code: '247540', name: '에코프로비엠', sector_id: 'secondary-battery' },
    { code: '357780', name: '솔브레인홀딩스', sector_id: 'semiconductor' },
  ]

  const generated = Array.from({ length: 1600 }, (_, index) => ({
    code: String(100000 + index).padStart(6, '0'),
    name: `검수샘플종목${index + 1}`,
    sector_id: index % 3 === 0 ? 'semiconductor' : index % 3 === 1 ? 'secondary-battery' : 'platform',
    liquidity: 1_000_000_000 + index * 10_000_000,
    updated_at: '2026-05-13T09:00:00+09:00',
  }))

  return [
    ...seed.map((item, index) => ({
      ...item,
      liquidity: 8_000_000_000 - index * 500_000_000,
      updated_at: '2026-05-13T09:00:00+09:00',
    })),
    ...generated,
  ]
}

const mockSectors = [
  { id: 'semiconductor', name: '반도체 장비', score: 91, change_rate: 3.8 },
  { id: 'secondary-battery', name: '2차전지 소재', score: 87, change_rate: 2.9 },
  { id: 'platform', name: 'AI 플랫폼', score: 82, change_rate: 1.7 },
  { id: 'bio', name: '바이오시밀러', score: 76, change_rate: 1.4 },
  { id: 'robotics', name: '로봇 자동화', score: 73, change_rate: 1.1 },
  { id: 'defense', name: '방산 수출', score: 69, change_rate: 0.9 },
  { id: 'power-grid', name: '전력 인프라', score: 66, change_rate: 0.8 },
  { id: 'fintech', name: '핀테크', score: 61, change_rate: 0.5 },
]

const mockHighlights = [
  {
    code: '005930',
    name: '삼성전자',
    sector_id: 'semiconductor',
    entry_grade: 'A',
    trend_grade: 'A',
    dist_grade: 'B',
    warn_grade: 'SAFE',
    entry_score: 88,
    total_score: 91,
    adaptive_adjustment: 4,
    adaptive_reasons: ['주도 섹터 대장주 회복 구간입니다.', '외국인 수급이 3주 연속 개선 중입니다.', '실적 추정치 상향이 반영되는 구간입니다.'],
    entry_price: 84200,
    strategy_label: '주도주 추세 지속',
    expected_base_pct: 8.5,
    expected_upside_pct: 14.2,
    expected_drawdown_pct: 4.1,
    confidence_pct: 82.4,
    score_momentum: 84,
    score_value: 66,
    score_safety: 79,
  },
  {
    code: '000660',
    name: 'SK하이닉스',
    sector_id: 'semiconductor',
    entry_grade: 'A',
    trend_grade: 'A',
    dist_grade: 'A',
    warn_grade: 'WATCH',
    entry_score: 86,
    total_score: 89,
    adaptive_adjustment: 3,
    adaptive_reasons: ['메모리 업황 회복 기대가 이어지고 있습니다.', '기관 비중 확대가 확인됩니다.', '상단 목표 대비 기대 보상이 큽니다.'],
    entry_price: 218000,
    strategy_label: '실적 모멘텀',
    expected_base_pct: 7.3,
    expected_upside_pct: 12.8,
    expected_drawdown_pct: 4.7,
    confidence_pct: 77.1,
    score_momentum: 88,
    score_value: 58,
    score_safety: 73,
  },
  {
    code: '247540',
    name: '에코프로비엠',
    sector_id: 'secondary-battery',
    entry_grade: 'B',
    trend_grade: 'A',
    dist_grade: 'B',
    warn_grade: 'SAFE',
    entry_score: 81,
    total_score: 85,
    adaptive_adjustment: 2,
    adaptive_reasons: ['눌림 이후 재돌파 직전 구조입니다.', '밸류 부담이 일부 완화되었습니다.', '모바일 카드형에서 긴 텍스트 검수용 설명입니다.'],
    entry_price: 265500,
    strategy_label: '눌림 후 재돌파',
    expected_base_pct: 9.1,
    expected_upside_pct: 16.3,
    expected_drawdown_pct: 5.8,
    confidence_pct: 74.8,
    score_momentum: 79,
    score_value: 55,
    score_safety: 71,
  },
  {
    code: '357780',
    name: '솔브레인홀딩스',
    sector_id: 'semiconductor',
    entry_grade: 'B',
    trend_grade: 'B',
    dist_grade: 'A',
    warn_grade: 'SAFE',
    entry_score: 75,
    total_score: 78,
    adaptive_adjustment: 1,
    adaptive_reasons: null,
    entry_price: 54300,
    strategy_label: '중형주 확산',
    expected_base_pct: 6.2,
    expected_upside_pct: 11.4,
    expected_drawdown_pct: 4.4,
    confidence_pct: 68.3,
    score_momentum: 72,
    score_value: 63,
    score_safety: 69,
  },
  {
    code: '035420',
    name: 'NAVER',
    sector_id: 'platform',
    entry_grade: 'B',
    trend_grade: 'B',
    dist_grade: 'B',
    warn_grade: 'WATCH',
    entry_score: 72,
    total_score: 75,
    adaptive_adjustment: 0,
    adaptive_reasons: null,
    entry_price: 211500,
    strategy_label: '플랫폼 반등',
    expected_base_pct: 5.4,
    expected_upside_pct: 9.8,
    expected_drawdown_pct: 4.2,
    confidence_pct: 64.2,
    score_momentum: 67,
    score_value: 61,
    score_safety: 70,
  },
  {
    code: '051910',
    name: 'LG화학',
    sector_id: 'secondary-battery',
    entry_grade: 'C',
    trend_grade: 'B',
    dist_grade: 'B',
    warn_grade: 'WARN',
    entry_score: 69,
    total_score: 71,
    adaptive_adjustment: -1,
    adaptive_reasons: null,
    entry_price: 344500,
    strategy_label: '리스크 감수형',
    expected_base_pct: 4.8,
    expected_upside_pct: 8.9,
    expected_drawdown_pct: 5.6,
    confidence_pct: 59.9,
    score_momentum: 65,
    score_value: 58,
    score_safety: 61,
  },
]

const mockDiscoveryPicks = [
  {
    code: '357780',
    name: '솔브레인홀딩스',
    sectorId: 'semiconductor',
    sectorName: '반도체 장비',
    sectorRawScore: 91,
    marketCap: 1_850_000_000_000,
    pbr: 1.42,
    per: 12.1,
    roe: 15.8,
    peg: 0.82,
    pegSource: 'net_income',
    revQoq: 8.7,
    opQoq: 12.4,
    revAcceleration: 2.1,
    opAcceleration: 3.2,
    smartMoney12w: 128_000_000_000,
    smartMoneyRatioPct: 6.8,
    score: { totalScore: 86, value: 24, momentum: 33, smartMoney: 19, sector: 10 },
  },
  {
    code: '039030',
    name: '이오테크닉스',
    sectorId: 'semiconductor',
    sectorName: '반도체 장비',
    sectorRawScore: 91,
    marketCap: 2_420_000_000_000,
    pbr: 1.77,
    per: 15.2,
    roe: 14.1,
    peg: 0.94,
    pegSource: 'op_income',
    revQoq: 6.1,
    opQoq: 10.3,
    revAcceleration: 1.4,
    opAcceleration: 2.6,
    smartMoney12w: 94_000_000_000,
    smartMoneyRatioPct: 4.1,
    score: { totalScore: 82, value: 21, momentum: 32, smartMoney: 19, sector: 10 },
  },
  {
    code: '247540',
    name: '에코프로비엠',
    sectorId: 'secondary-battery',
    sectorName: '2차전지 소재',
    sectorRawScore: 87,
    marketCap: 9_100_000_000_000,
    pbr: 1.88,
    per: 18.2,
    roe: 13.2,
    peg: 1.14,
    pegSource: 'net_income_forward',
    revQoq: 5.2,
    opQoq: 7.8,
    revAcceleration: 0.8,
    opAcceleration: 1.7,
    smartMoney12w: 153_000_000_000,
    smartMoneyRatioPct: 3.4,
    score: { totalScore: 79, value: 20, momentum: 29, smartMoney: 20, sector: 10 },
  },
  {
    code: '035420',
    name: 'NAVER',
    sectorId: 'platform',
    sectorName: 'AI 플랫폼',
    sectorRawScore: 82,
    marketCap: 31_500_000_000_000,
    pbr: 1.31,
    per: 16.8,
    roe: 9.7,
    peg: 1.06,
    pegSource: 'sales',
    revQoq: 4.5,
    opQoq: 5.9,
    revAcceleration: 0.9,
    opAcceleration: 1.1,
    smartMoney12w: 71_000_000_000,
    smartMoneyRatioPct: 1.8,
    score: { totalScore: 74, value: 23, momentum: 24, smartMoney: 17, sector: 10 },
  },
]

function buildAbsoluteUrl(url: string): URL {
  if (typeof window !== 'undefined') {
    return new URL(url, window.location.origin)
  }
  return new URL(url, 'http://localhost')
}

function getRouteName(inputUrl: URL): string {
  if (inputUrl.pathname.includes('/api/ui/')) {
    const segment = inputUrl.pathname.split('/api/ui/')[1] || ''
    return segment.split('/')[0] || ''
  }
  return inputUrl.searchParams.get('route') || ''
}

function buildDiscoveryResponse(inputUrl: URL) {
  const minMarketCapBillion = Number(inputUrl.searchParams.get('minMarketCapBillion') || 500)
  const minRoe = Number(inputUrl.searchParams.get('minRoe') || 8)
  const maxPbr = Number(inputUrl.searchParams.get('maxPbr') || 2)
  const minPegRaw = inputUrl.searchParams.get('minPeg')
  const maxPegRaw = inputUrl.searchParams.get('maxPeg')
  const qoqMode = inputUrl.searchParams.get('qoqMode') === 'latest-quarter-positive' ? 'latest-quarter-positive' : 'two-quarter-positive'

  return {
    fetchedAt: '2026-05-13T09:20:00+09:00',
    criteria: {
      minMarketCapBillion,
      minRoe,
      maxPbr,
      minPeg: minPegRaw == null || minPegRaw === '' ? null : Number(minPegRaw),
      maxPeg: maxPegRaw == null || maxPegRaw === '' ? null : Number(maxPegRaw),
      qoqMode,
    },
    funnel: {
      annualUniverse: 2431,
      afterMarketCap: 621,
      afterValue: 214,
      afterPeg: 108,
      afterTrendData: 72,
      afterGrowth: mockDiscoveryPicks.length,
    },
    picks: mockDiscoveryPicks,
  }
}

export function getUiReviewMock(url: string, method = 'GET') {
  if (!isUiReviewMode()) return null

  const inputUrl = buildAbsoluteUrl(url)
  const route = getRouteName(inputUrl)

  if (method === 'GET' && route === 'summary') {
    return {
      data: {
        positions: 4,
        position_count: 4,
        unrealized_pnl_sum: 1284000,
        total_invested: 18400000,
        total_current_value: 19684000,
        total_unrealized_pnl: 1284000,
        total_realized_pnl: 420000,
        cash_balance: 3620000,
        last_scan_at: '2026-05-13T08:47:00+09:00',
        last_updated: '2026-05-13T09:10:00+09:00',
      },
    }
  }

  if (method === 'GET' && route === 'sectors') {
    const top = Number(inputUrl.searchParams.get('top') || mockSectors.length)
    return { data: mockSectors.slice(0, top) }
  }

  if (method === 'GET' && route === 'stocks') {
    return { data: makeMockStocks() }
  }

  if (method === 'GET' && route === 'access-users') {
    return { data: { is_admin: true, chat_id: '8311154094' } }
  }

  if (method === 'GET' && route === 'scan-highlights') {
    return { data: mockHighlights }
  }

  if (method === 'GET' && route === 'discovery-picks') {
    return buildDiscoveryResponse(inputUrl)
  }

  if (inputUrl.pathname.includes('/api/economic-calendar')) {
    const response: EconomicEventResponse = {
      data: {
        events: [
          {
            id: 'cpi-us',
            name: '미국 CPI 발표',
            country: 'US',
            importance: 'critical',
            scheduledAt: '2026-05-14T21:30:00+09:00',
            averageKospiReaction: -1.24,
          },
        ],
      },
    }
    return response
  }

  if (inputUrl.pathname.includes('/api/ui/profile')) {
    if (method === 'GET') {
      return {
        data: {
          telegram_id: '8311154094',
          nickname: 'Review User',
        },
      }
    }

    return {
      ok: true,
      data: {
        telegram_id: '8311154094',
        nickname: 'Review User',
      },
    }
  }

  return null
}