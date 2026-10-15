import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SimulatorPage from './index'

// 분해 전에 현재 동작을 고정하는 스모크 테스트. API·라우터 상태·토스트는 가짜이고 실제 저장/전송은 나가지 않는다.
type Call = { url: string; method?: string; body?: string }
const calls: Call[] = []
const toasts: string[] = []
let chatId = '123'
let latestPlan: unknown = null

const SCAN = [
  { code: '000010', name: '에이종목', entry_grade: 'A', entry_score: 4, warn_score: 0, current_price: 10000, close: 10000, signal_rank: 1 },
  { code: '000020', name: '비종목', entry_grade: 'B', entry_score: 3, warn_score: 1, current_price: 20000, close: 20000, signal_rank: 2 },
  { code: '000030', name: '디종목', entry_grade: 'D', entry_score: 1, warn_score: 5, current_price: 30000, close: 30000, signal_rank: 3 },
]
const HIGHLIGHTS = [
  { code: '000010', name: '에이종목', entry_price: 10100, signal_rank: 1 },
  { code: '000040', name: '하이라이트만', entry_price: 40000, signal_rank: 4 },
]
const WATCH = [{ code: '000050', stock_name: '관심종목', current_price: 5000, close: 5000, priority: 3, rank: 5 }]

vi.mock('../../lib/api', () => ({
  apiFetch: vi.fn((url: string, opts?: { method?: string; body?: string }) => {
    const u = String(url)
    calls.push({ url: u, method: opts?.method, body: opts?.body })
    if (u.startsWith('/api/ui/scan-candidates')) return Promise.resolve({ data: SCAN })
    if (u.startsWith('/api/ui?route=scan-highlights')) return Promise.resolve({ data: HIGHLIGHTS })
    if (u.startsWith('/api/ui/positions')) return Promise.resolve({ data: WATCH })
    if (u.startsWith('/api/ui/simulation-plan')) {
      if (opts?.method === 'POST') return Promise.resolve({ data: { ok: true } })
      if (u.includes('mode=latest')) return Promise.resolve({ data: latestPlan ? { plan: latestPlan, updatedAt: '2026-10-10T00:00:00Z' } : null })
      if (u.includes('mode=history')) return Promise.resolve({ data: [] })
    }
    if (u.startsWith('/api/ui/notify')) return Promise.resolve({ data: { ok: true } })
    if (u.startsWith('/api/ui/investment-prefs')) return Promise.resolve({ data: null })
    return Promise.resolve({ data: null })
  }),
  invalidateCache: vi.fn(),
}))
vi.mock('../../lib/stockCache', () => ({ searchStocks: vi.fn(() => Promise.resolve([])) }))
vi.mock('../../stores/profileStore', () => ({ useCurrentChatId: () => chatId }))
vi.mock('../../components/ToastProvider', () => ({ useToast: () => ({ show: (m: string) => { toasts.push(m) } }) }))
vi.mock('../../components/StockDetailModal', () => ({ default: () => null }))
vi.mock('../../components/ui/Detail', () => ({ default: ({ children }: { children: unknown }) => <>{children}</> }))
vi.mock('../../lib/userState', () => ({ userScopedKey: (k: string) => k }))

const callsTo = (prefix: string) => calls.filter((c) => c.url.startsWith(prefix))
const renderPage = (state?: unknown) =>
  render(
    <MemoryRouter initialEntries={[{ pathname: '/simulator', state }]}>
      <SimulatorPage />
    </MemoryRouter>,
  )
const planItem = (code: string, name: string, amount = 1_000_000) => ({
  id: `rs_${code}`, code, name, sector_id: null, amount, targetPct: 5, stopPct: 3, winProb: 40, split1: 40, split2: 35, split3: 25,
})

describe('시뮬레이터', () => {
  beforeEach(() => {
    calls.length = 0
    toasts.length = 0
    chatId = '123'
    latestPlan = null
    try { localStorage.clear() } catch { /* ignore */ }
  })

  it('마운트하면 후보 2종을 조회하고, 연동된 계정이면 관심종목과 서버 최신 계획도 조회한다', async () => {
    renderPage()
    await waitFor(() => expect(callsTo('/api/ui/scan-candidates')).toHaveLength(1))
    await waitFor(() => expect(callsTo('/api/ui?route=scan-highlights')).toHaveLength(1))
    await waitFor(() => expect(callsTo('/api/ui/positions').length).toBeGreaterThan(0))
    expect(callsTo('/api/ui/positions')[0].url).toContain('positionType=interest')
    await waitFor(() => expect(callsTo('/api/ui/simulation-plan').some((c) => c.url.includes('mode=latest'))).toBe(true))
  })

  it('chatId가 없으면 관심종목·서버 계획을 조회하지 않는다 (서버 불러오기는 안내 토스트)', async () => {
    chatId = ''
    renderPage()
    await waitFor(() => expect(callsTo('/api/ui/scan-candidates')).toHaveLength(1))
    expect(callsTo('/api/ui/positions')).toHaveLength(0)
    expect(callsTo('/api/ui/simulation-plan')).toHaveLength(0)
    expect(toasts).toContain('서버 불러오기는 텔레그램 연동 후 이용 가능합니다.')
  })

  it('로컬 계획에 종목이 있으면 서버 최신 계획을 부르지 않고 그 종목을 보여준다', async () => {
    localStorage.setItem('highlight_simulation_plan', JSON.stringify({ createdAt: 1, totalCapital: 5_000_000, notes: '', items: [planItem('000099', '로컬종목')] }))
    renderPage()
    expect((await screen.findAllByText('로컬종목')).length).toBeGreaterThan(0)
    await waitFor(() => expect(callsTo('/api/ui/scan-candidates')).toHaveLength(1))
    expect(callsTo('/api/ui/simulation-plan')).toHaveLength(0)
    expect((screen.getByLabelText('총 투자금 (원)') as HTMLInputElement).value).toBe('5000000')
  })

  it('서버에 저장된 계획이 있으면 불러와서 적용한다', async () => {
    latestPlan = { createdAt: 1, totalCapital: 7_000_000, notes: '서버메모', items: [planItem('000088', '서버종목')] }
    renderPage()
    expect((await screen.findAllByText('서버종목')).length).toBeGreaterThan(0)
    expect((screen.getByLabelText('총 투자금 (원)') as HTMLInputElement).value).toBe('7000000')
    expect(toasts).toContain('서버 계획을 불러왔습니다.')
  })

  it('시드 만들기에서 넘어오면 그 투자금으로 시작하고 서버 계획은 부르지 않는다', async () => {
    renderPage({ seedBuilderCapital: 3_000_000 })
    expect(await screen.findByText(/이번 달 투자금에서 확인한 가용 현금/)).toBeTruthy()
    expect((screen.getByLabelText('총 투자금 (원)') as HTMLInputElement).value).toBe('3000000')
    await waitFor(() => expect(callsTo('/api/ui/scan-candidates')).toHaveLength(1))
    expect(callsTo('/api/ui/simulation-plan')).toHaveLength(0)
  })

  it('빈 행을 추가·제거하면 종목 수와 배분 합계가 바뀐다', async () => {
    chatId = ''
    renderPage()
    await waitFor(() => expect(callsTo('/api/ui/scan-candidates')).toHaveLength(1))
    expect(screen.getByText('집행안이 비어 있습니다')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '빈 행 추가' }))
    expect(await screen.findByText('1개', { selector: '.sim-section-count' })).toBeTruthy()
    expect(screen.queryByText('집행안이 비어 있습니다')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '종목 제거' }))
    expect(await screen.findByText('집행안이 비어 있습니다')).toBeTruthy()
  })

  it('배분 합계가 총 투자금을 넘으면 경고를 보여준다', async () => {
    chatId = ''
    localStorage.setItem('highlight_simulation_plan', JSON.stringify({ createdAt: 1, totalCapital: 500_000, notes: '', items: [planItem('000099', '로컬종목', 800_000)] }))
    renderPage()
    expect(await screen.findByText(/배분 합계가 총 투자금을/)).toBeTruthy()
  })

  it('추천 소스 버튼에 후보 개수가 표시되고, 등급 D는 제외·하이라이트는 병합된다', async () => {
    renderPage()
    // 스캔 A·B(2) + 하이라이트 전용(1) = 3 (D 제외, 000010은 중복 병합)
    expect(await screen.findByText('3개', { selector: '.sim-rec-source-count' })).toBeTruthy()
    expect(await screen.findByText('1개', { selector: '.sim-rec-source-count' })).toBeTruthy()
  })

  it('알고리즘 후보는 실측 환산 승률이라 기대값이 낮아 추천이 나오지 않는다 (현재 동작)', async () => {
    renderPage()
    await screen.findByText('3개', { selector: '.sim-rec-source-count' })
    fireEvent.click(screen.getByRole('button', { name: '추천 포트폴리오 만들기' }))
    await waitFor(() => expect(toasts).toContain('추천 가능한 종목이 없습니다. (품질 기준 미충족)'))
    expect(screen.queryByRole('button', { name: '이 포트폴리오 적용' })).toBeNull()
  })

  it('현재 종목을 소스로 추천을 만들고 적용하면 종목이 추천 결과로 바뀐다', async () => {
    chatId = ''
    const good = (code: string, name: string) => ({ ...planItem(code, name), targetPct: 8, stopPct: 2, winProb: 70, current_price: 10000, close: 10000 })
    localStorage.setItem('highlight_simulation_plan', JSON.stringify({ createdAt: 1, totalCapital: 10_000_000, notes: '', items: [good('000101', '좋은종목1'), good('000102', '좋은종목2')] }))
    renderPage()
    await screen.findAllByText('좋은종목1')
    fireEvent.click(screen.getByRole('button', { name: /현재 종목/ }))
    fireEvent.click(screen.getByRole('button', { name: '추천 포트폴리오 만들기' }))
    expect(await screen.findByText(/추천 포트폴리오$/)).toBeTruthy()
    const apply = await screen.findByRole('button', { name: '이 포트폴리오 적용' })
    fireEvent.click(apply)
    expect(toasts).toContain('추천 포트폴리오를 적용했습니다.')
    expect(screen.queryByRole('button', { name: '이 포트폴리오 적용' })).toBeNull()
  })

  it('추천 패널이 열린 채 월 목표를 바꾸면 추천이 다시 계산된다', async () => {
    chatId = ''
    const good = (code: string, name: string) => ({ ...planItem(code, name), targetPct: 8, stopPct: 2, winProb: 70, current_price: 10000, close: 10000 })
    localStorage.setItem('highlight_simulation_plan', JSON.stringify({ createdAt: 1, totalCapital: 10_000_000, notes: '', items: [good('000101', '좋은종목1'), good('000102', '좋은종목2')] }))
    renderPage()
    await screen.findAllByText('좋은종목1')
    fireEvent.click(screen.getByRole('button', { name: /현재 종목/ }))
    fireEvent.click(screen.getByRole('button', { name: '추천 포트폴리오 만들기' }))
    await screen.findByRole('button', { name: '이 포트폴리오 적용' })
    const panelText = () => (document.querySelector('.sim-recommendation-panel') as HTMLElement).textContent || ''
    const before = panelText()
    expect(before).toContain('월 500,000원')
    fireEvent.change(screen.getByDisplayValue('500000'), { target: { value: '1500000' } })
    await waitFor(() => expect(panelText()).toContain('월 1,500,000원'))
  })

  it('설정에서 로컬 저장을 누르면 계획이 localStorage에 남는다', async () => {
    chatId = ''
    renderPage()
    await waitFor(() => expect(callsTo('/api/ui/scan-candidates')).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: /설정/ }))
    fireEvent.click(await screen.findByRole('button', { name: '로컬 저장' }))
    expect(toasts).toContain('로컬에 저장했습니다.')
    const saved = JSON.parse(localStorage.getItem('highlight_simulation_plan') || '{}')
    expect(saved.totalCapital).toBe(10_000_000)
    expect(Array.isArray(saved.items)).toBe(true)
  })

  it('서버 저장은 plan 본문을 POST하고, 텔레그램 전송은 메시지를 POST한다', async () => {
    localStorage.setItem('highlight_simulation_plan', JSON.stringify({ createdAt: 1, totalCapital: 5_000_000, notes: '메모', items: [planItem('000099', '로컬종목')] }))
    renderPage()
    await screen.findAllByText('로컬종목')
    fireEvent.click(screen.getByRole('button', { name: /설정/ }))
    fireEvent.click(await screen.findByRole('button', { name: '서버 저장' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.startsWith('/api/ui/simulation-plan'))).toBe(true))
    const post = calls.find((c) => c.method === 'POST' && c.url.startsWith('/api/ui/simulation-plan'))!
    expect(post.url).toContain('chat_id=123')
    const plan = JSON.parse(post.body!).plan
    expect(plan).toMatchObject({ totalCapital: 5_000_000, notes: '메모' })
    expect(plan.items[0].code).toBe('000099')
    expect(toasts).toContain('서버에 저장했습니다.')

    fireEvent.click(screen.getByRole('button', { name: '텔레그램 전송' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.startsWith('/api/ui/notify'))).toBe(true))
    const msg = JSON.parse(calls.find((c) => c.url.startsWith('/api/ui/notify'))!.body!).message
    expect(typeof msg).toBe('string')
    expect(msg).toContain('로컬종목')
    expect(toasts).toContain('텔레그램 전송 완료')
  })
})
