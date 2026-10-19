import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BriefingPage from './index'

const apiFetchMock = vi.fn()
vi.mock('../../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }))
vi.mock('../../stores/profileStore', () => ({
  useCurrentClientId: () => 'test-user',
  useCurrentChatId: () => '1',
}))

const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10)

const flowItem = (themeNo: number, name: string, patch: Record<string, unknown> = {}) => ({
  themeNo, name, rank: themeNo, ret5: 6.2, breadth5: 0.9, valueRatio: null, news5: 2, newsRatio: null, daysUsed: 1, isNew: false,
  news: [
    { title: `${name} 수주 확대`, link: `https://n.news.naver.com/a/${themeNo}`, office: '한국경제', at: '202610191300', tone: 'pos' },
    { title: `${name} 양산 지연 우려`, link: `https://n.news.naver.com/b/${themeNo}`, office: '조선일보', at: '202610191200', tone: 'neutral' },
    { title: `${name} 급락`, link: `https://n.news.naver.com/c/${themeNo}`, office: '매일경제', at: '202610191100', tone: 'neg' },
  ],
  ...patch,
})

const themes = (patch: Record<string, unknown> = {}) => ({
  asOf: today, daysCollected: 1, recentDays: 5, baselineDays: 20,
  hot: [flowItem(1, '2차전지(나트륨이온)', { isNew: true }), flowItem(2, '전력저장장치(ESS)')],
  cooling: [flowItem(3, '유리 기판', { ret5: -4, peakRank: 2 })],
  ...patch,
})

const my = (patch: Record<string, unknown> = {}) => ({
  asOf: today,
  themeError: null,
  rules: { breadthStrong: 0.6, breadthWeak: 0.4, newsStrong: 1.5, newsWeak: 0.5, valueStrong: 1.3, valueWeak: 0.7 },
  holdings: [{
    code: '0190C0', name: 'RISE 현대차고정피지컬AI', isEtf: true, category: '혁신기술 · 로봇', topWeightCovered: 0.93,
    links: [{ themeNo: 9, name: '피지컬 AI/휴머노이드 로봇', overlap: 0.8, matched: ['현대차', '기아', '현대모비스', '레인보우로보틱스'] }],
    primaryTheme: { themeNo: 9, name: '피지컬 AI/휴머노이드 로봇', news: [] },
    evidence: {
      overall: 'mixed',
      signals: [
        { key: 'price', label: '가격 흐름', level: 'normal', detail: '3달 -16.2% · 200일선 판단 불가' },
        { key: 'breadth', label: '종목 폭', level: 'strong', detail: '최근 1일 평균 상승 종목 91%' },
        { key: 'news', label: '언론 관심', level: 'unknown', detail: '평소 기준 쌓는 중' },
        { key: 'value', label: '거래 관심', level: 'unknown', detail: '평소 기준 쌓는 중' },
      ],
    },
  }],
  ...patch,
})

function mockRoutes(routes: Record<string, unknown>) {
  apiFetchMock.mockImplementation((url: string) => {
    const route = /route=([a-z-]+)/.exec(url)?.[1] ?? ''
    if (route in routes) {
      const v = routes[route]
      return v instanceof Error ? Promise.reject(v) : Promise.resolve({ data: v })
    }
    return Promise.reject(new Error(`unmocked ${url}`))
  })
}

const renderPage = () => render(<MemoryRouter><BriefingPage /></MemoryRouter>)

beforeEach(() => {
  apiFetchMock.mockReset()
})

describe('오늘 시장', () => {
  it('뜨는·식는 테마와 따라 사지 말라는 안내를 보여 준다', async () => {
    mockRoutes({ 'market-themes': themes(), 'my-themes': my(), 'market-overview': { indices: { kospi: { price: 2500.12, changeRate: -1.2 } } }, 'economic-calendar': { events: [] } })
    renderPage()
    expect(await screen.findByText('2차전지(나트륨이온)')).toBeInTheDocument()
    expect(screen.getByText('새로 등장')).toBeInTheDocument()
    expect(screen.getByText('최고 2위')).toBeInTheDocument()
    expect(screen.getByText(/매수·매도 신호가 아닙니다/)).toBeInTheDocument()
    expect(screen.getByText(/기록이 1일치뿐이라/)).toBeInTheDocument()
    // 기사 2개만 보이되 부정 기사는 하나 남긴다
    expect(screen.getByText('2차전지(나트륨이온) 급락')).toBeInTheDocument()
    expect(screen.queryByText('2차전지(나트륨이온) 양산 지연 우려')).not.toBeInTheDocument()
  })

  it('보유와 이어진 테마는 겹친 비중·종합·네 신호를 보여 주고 팔라는 말은 하지 않는다', async () => {
    mockRoutes({ 'market-themes': themes(), 'my-themes': my(), 'market-overview': { indices: {} }, 'economic-calendar': { events: [] } })
    renderPage()
    expect(await screen.findByText('RISE 현대차고정피지컬AI')).toBeInTheDocument()
    expect(screen.getByText(/상위 10종목 중 80%/)).toBeInTheDocument()
    expect(screen.getByText('엇갈림')).toBeInTheDocument()
    expect(screen.getByText(/생각을 바꿀 근거는 아닙니다/)).toBeInTheDocument()
    expect(screen.getByText('가격 흐름')).toBeInTheDocument()
    expect(screen.getAllByText('모름')).toHaveLength(2)
    expect(screen.getByText(/팔거나 사라는 뜻이 아닙니다/)).toBeInTheDocument()
  })

  it('보유가 없으면 입력 안내, 테마 기록이 없으면 수집 전 안내', async () => {
    mockRoutes({ 'market-themes': themes({ asOf: null, hot: [], cooling: [], daysCollected: 0 }), 'my-themes': my({ holdings: [] }), 'market-overview': { indices: {} }, 'economic-calendar': { events: [] } })
    renderPage()
    expect(await screen.findByText(/입력한 실계좌 보유가 없습니다/)).toBeInTheDocument()
    expect(await screen.findByText(/테마 기록을 아직 모으기 전입니다/)).toBeInTheDocument()
  })

  it('기록이 오래되면 갱신 지연, 조회 실패는 실패로 보여 준다(빈 목록으로 숨기지 않음)', async () => {
    mockRoutes({ 'market-themes': themes({ asOf: '2026-01-02' }), 'my-themes': new Error('503'), 'market-overview': new Error('x'), 'economic-calendar': { events: [] } })
    renderPage()
    expect(await screen.findByText(/갱신 지연/)).toBeInTheDocument()
    expect(await screen.findByText('불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.')).toBeInTheDocument()
    expect(await screen.findByText(/시세를 불러오지 못했습니다/)).toBeInTheDocument()
  })

  it('이번 주 큰 일정은 중요도 높은 것만', async () => {
    const soon = new Date(Date.now() + 2 * 86_400_000).toISOString()
    mockRoutes({
      'market-themes': themes(), 'my-themes': my(), 'market-overview': { indices: {} },
      'economic-calendar': { events: [
        { id: 'a', name: '미국 CPI', country: 'US', category: 'inflation', importance: 'critical', scheduledAt: soon, forecastValue: 2.9, unit: '%' },
        { id: 'b', name: '주택 착공', country: 'US', category: 'housing', importance: 'low', scheduledAt: soon },
      ] },
    })
    renderPage()
    expect(await screen.findByText('미국 CPI')).toBeInTheDocument()
    expect(screen.getByText('예상 2.9%')).toBeInTheDocument()
    expect(screen.queryByText('주택 착공')).not.toBeInTheDocument()
  })
})
