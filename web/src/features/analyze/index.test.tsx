import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import AnalyzePage from './index'

// 분해 전에 현재 동작을 고정하는 스모크 테스트. API·차트·공시 점검·공유는 가짜다.
type Call = { url: string }
const calls: Call[] = []
const toasts: string[] = []
const shareSpy = { createShare: vi.fn() }
let payload: any = null
let failWith: string | null = null

const baseAdvisor = {
  status: 'buy', statusLabel: '매수', finalScore: 72.4, entryLow: 68000, entryHigh: 70000, stopPrice: 64000, target1: 75000, target2: 80000,
  twoStage: { action: 'pilot_buy', actionLabel: '소량 진입', reason: '규칙상 진입 가능', regime: 'risk_on' },
}
const full = () => ({
  profile: { code: '005930', name: '삼성전자', sma20: 69000, sma50: 67000, rsi14: 55, per: 12.3, pbr: 1.2, roe: 9.1, fundamental_gate: { status: 'pass' } },
  latest: { close: 70000, open: 69000, high: 71000, low: 68500, date: '2026-10-09', change_pct: 1.5, volume: 1000000 },
  data: [
    { date: '2026-10-07', open: 68000, high: 69500, low: 67500, close: 69000, volume: 100 },
    { date: '2026-10-08', open: 69000, high: 70500, low: 68800, close: 69500, volume: 100 },
    { date: '2026-10-09', open: 69000, high: 71000, low: 68500, close: 70000, volume: 100 },
    { date: '', open: 1, high: 1, low: 1, close: 1 },
  ],
  flow: { date: '2026-10-09', foreign: 1_000_000_000, institution: 500_000_000, metric: 'amount' },
  creditShort: { source: 'db', creditRatio: 1.1 },
  advisor: baseAdvisor,
})

vi.mock('../../lib/api', () => ({
  apiFetch: vi.fn((url: string) => {
    calls.push({ url: String(url) })
    if (String(url).startsWith('/api/ui/stock-latest')) {
      if (failWith) return Promise.reject(new Error(failWith))
      return Promise.resolve(payload)
    }
    return Promise.resolve({ data: null })
  }),
  invalidateCache: vi.fn(),
}))
vi.mock('../../lib/stockCache', () => ({ getStocks: vi.fn(async () => []), searchStocks: vi.fn(async () => []) }))
vi.mock('../../lib/userState', () => ({ userScopedKey: (k: string) => k }))
vi.mock('../../stores/profileStore', () => ({ useCurrentChatId: () => '123' }))
vi.mock('../../components/ToastProvider', () => ({ useToast: () => ({ show: (m: string) => { toasts.push(m) } }) }))
vi.mock('../../components/ShareModal', () => ({ default: () => null }))
vi.mock('../../components/CandleChart', () => ({ default: () => <div data-testid="candle-chart" /> }))
vi.mock('../../components/EconomicEventBadge', () => ({ default: () => null }))
vi.mock('../../components/ChaseWarningNote', () => ({ default: () => null }))
vi.mock('../../components/DisclosureCheckCard', () => ({ default: () => null }))
vi.mock('../../components/StockSearchInput', () => ({
  default: ({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) => (
    <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
  ),
}))
vi.mock('../../hooks/useShareManager', () => ({
  useShareManager: () => ({
    open: false, close: vi.fn(), setOpen: vi.fn(), info: null, list: [], loading: false, creating: false, includeAll: false,
    setIncludeAll: vi.fn(), revokeShare: vi.fn(), revokeAllShares: vi.fn(), revokingId: null, revokingAll: false,
    requiresCode: false, createShare: shareSpy.createShare, loadList: vi.fn(),
  }),
}))

const callsTo = (prefix: string) => calls.filter((c) => c.url.startsWith(prefix))
const searchBox = () => screen.getByPlaceholderText(/종목 코드\(예: 005930\)/) as HTMLInputElement
const pageText = () => document.body.textContent || ''
const resultName = () => screen.findByText('삼성전자', { selector: 'td' })
async function analyzeSamsung(onNavigate?: (r: string) => void) {
  render(<AnalyzePage onNavigate={onNavigate} />)
  fireEvent.change(searchBox(), { target: { value: '005930' } })
  fireEvent.click(screen.getByRole('button', { name: '분석' }))
  await resultName()
}

describe('종목 분석', () => {
  beforeEach(() => {
    calls.length = 0
    toasts.length = 0
    shareSpy.createShare.mockReset()
    payload = full()
    failWith = null
    window.history.replaceState({}, '', '/analyze')
    try { sessionStorage.clear(); localStorage.clear() } catch { /* ignore */ }
  })

  it('종목을 입력하고 분석하면 채팅 ID와 함께 조회하고 결과·진입 판단을 보여준다', async () => {
    await analyzeSamsung()
    const url = callsTo('/api/ui/stock-latest')[0].url
    expect(url).toContain('code=005930')
    expect(url).toContain('chat_id=123')
    expect(pageText()).toContain('70,000')
    expect(pageText()).toContain('+1.50%')
    expect(pageText()).toContain('소량 진입')
    expect(pageText()).toContain('규칙상 진입 가능')
    expect(pageText()).toContain('5/5')
    expect(screen.getByTestId('candle-chart')).toBeTruthy()
  })

  it('조회 후 주소가 공유용 URL(code 포함)로 바뀐다', async () => {
    await analyzeSamsung()
    await waitFor(() => expect(window.location.search).toContain('code=005930'))
  })

  it('URL의 code를 이어받아 자동으로 분석한다', async () => {
    window.history.replaceState({}, '', '/analyze?code=005930')
    render(<AnalyzePage />)
    expect(await resultName()).toBeTruthy()
    expect(searchBox().value).toBe('005930')
    expect(callsTo('/api/ui/stock-latest')).toHaveLength(1)
  })

  it('다른 화면이 sessionStorage로 넘긴 종목을 분석하고 키를 지운다', async () => {
    sessionStorage.setItem('analyze_pending_code', '005930')
    render(<AnalyzePage />)
    expect(await resultName()).toBeTruthy()
    expect(sessionStorage.getItem('analyze_pending_code')).toBeNull()
  })

  it('핵심 데이터가 2개 이하이면 "데이터 부족"으로 판단한다', async () => {
    payload = {
      profile: { code: '005930', name: '삼성전자' },
      latest: { close: 70000, date: '2026-10-09' },
      data: [], advisor: baseAdvisor,
    }
    await analyzeSamsung()
    expect(pageText()).toContain('데이터 부족')
    expect(pageText()).toContain('1/5')
    expect(pageText()).toContain('미확보: 재무, 기술지표, 수급, 공매도/신용')
  })

  it('진입가와 현재가가 3배 넘게 벌어지면 "판단 보류"와 경고를 보여준다', async () => {
    payload = full()
    payload.advisor = { ...baseAdvisor, entryLow: 19000, entryHigh: 21000 }
    await analyzeSamsung()
    expect(pageText()).toContain('판단 보류')
    expect(pageText()).toContain('가격 기준의 동기화 검증이 필요합니다.')
    expect(pageText()).toContain('진입가와 현재가의 갭이 큼 (비율: 3.5배)')
  })

  it('두 단계 판단이 비중 축소·관망일 때 라벨이 달라진다', async () => {
    payload = full()
    payload.advisor = { ...baseAdvisor, twoStage: { action: 'reduce', actionLabel: '비중 축소', reason: '신규 진입보다 정리', regime: 'risk_off' } }
    await analyzeSamsung()
    expect(pageText()).toContain('비중 축소')
    expect(pageText()).toContain('신규 진입보다 정리')
  })

  it('조회 실패·결과 없음·서버 오류 문구', async () => {
    failWith = '네트워크 오류'
    render(<AnalyzePage />)
    fireEvent.change(searchBox(), { target: { value: '005930' } })
    fireEvent.click(screen.getByRole('button', { name: '분석' }))
    expect(await screen.findByText('네트워크 오류')).toBeTruthy()

    failWith = null
    payload = {}
    fireEvent.click(screen.getByRole('button', { name: '분석' }))
    expect(await screen.findByText('조회 결과 없음')).toBeTruthy()

    payload = { error: '종목을 찾을 수 없습니다' }
    fireEvent.click(screen.getByRole('button', { name: '분석' }))
    expect(await screen.findByText('종목을 찾을 수 없습니다')).toBeTruthy()
  })

  it('분석한 종목은 최근 조회에 쌓이고 누르면 다시 분석한다', async () => {
    await analyzeSamsung()
    const chip = await screen.findByTitle('005930')
    expect(chip.textContent).toBe('삼성전자')
    const before = callsTo('/api/ui/stock-latest').length
    fireEvent.click(chip)
    await waitFor(() => expect(callsTo('/api/ui/stock-latest').length).toBe(before + 1))
  })

  it('시뮬레이터에 추가하면 계획에 종목이 더해지고 시뮬레이터로 이동한다', async () => {
    const nav = vi.fn()
    await analyzeSamsung(nav)
    fireEvent.click(await screen.findByRole('button', { name: '5 시뮬레이터에 추가' }))
    const plan = JSON.parse(localStorage.getItem('highlight_simulation_plan') || '{}')
    expect(plan.items.map((r: any) => r.code)).toEqual(['005930'])
    expect(toasts.some((m) => m.includes('시뮬레이터 계획에 추가했습니다 (1종목)'))).toBe(true)
    expect(nav).toHaveBeenCalledWith('simulator')
    // 같은 종목을 다시 추가해도 중복되지 않는다
    fireEvent.click(screen.getByRole('button', { name: '5 시뮬레이터에 추가' }))
    expect(JSON.parse(localStorage.getItem('highlight_simulation_plan') || '{}').items).toHaveLength(1)
  })

  it('실행가이드로 보내면 세션에 종목을 남기고 이동한다', async () => {
    const nav = vi.fn()
    await analyzeSamsung(nav)
    fireEvent.click(await screen.findByRole('button', { name: '6 실행가이드로' }))
    expect(JSON.parse(sessionStorage.getItem('execution_guide_pending_v1')!)).toEqual({ codes: ['005930'], source: 'analyze' })
    expect(nav).toHaveBeenCalledWith('execution-guide')
  })

  it('링크 공유는 분석 요약을 route-share 페이로드로 만든다', async () => {
    await analyzeSamsung()
    fireEvent.click(screen.getByRole('button', { name: '링크 공유' }))
    await waitFor(() => expect(shareSpy.createShare).toHaveBeenCalled())
    const [scope, body] = shareSpy.createShare.mock.calls[0]
    expect(scope).toBe('analyze')
    expect(body.kind).toBe('analyze')
    expect(body.payload.stock).toMatchObject({ code: '005930', name: '삼성전자', price: 70000, per: 12.3 })
    expect(body.payload.advisor).toMatchObject({ statusLabel: '매수', finalScore: 72.4, entryLow: 68000, stopPrice: 64000 })
    expect(body.payload.recentCloses).toEqual([70000, 69500, 69000])
    expect(body.payload.summaryLines.length).toBeGreaterThan(0)
  })
})
