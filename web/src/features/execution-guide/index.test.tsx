import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ExecutionGuidePage from './index'

// 분해 전에 현재 동작을 고정하는 스모크 테스트. API·공유·토스트는 가짜이고 PDF 다운로드는 다루지 않는다.
type Call = { url: string; method?: string; body?: string }
const calls: Call[] = []
const toasts: string[] = []
const shareSpy = { createShare: vi.fn(), loadList: vi.fn(), setOpen: vi.fn() }
let seedCapital: number | null = null
let seedLoaded = true
let stockLatestFail: string | null = null

const advisor = (entryLow: number, entryHigh: number, stop: number, t1: number, t2: number) => ({
  finalScore: 72.4, statusLabel: '진입 관심', summary: '요약 문구', entryLow, entryHigh, stopPrice: stop,
  target1: t1, target2: t2, target1Pct: 0.08, target2Pct: 0.15, holdDays: [5, 10], riskReward: 2.2, warnings: ['경고1'],
})
const STOCKS: Record<string, { name: string; adv: ReturnType<typeof advisor> }> = {
  '005930': { name: '삼성전자', adv: advisor(49000, 51000, 47000, 54000, 58000) },
  '000660': { name: 'SK하이닉스', adv: advisor(99000, 101000, 95000, 108000, 116000) },
  '035420': { name: 'NAVER', adv: advisor(199000, 201000, 190000, 216000, 232000) },
}
const SCAN = [
  { code: '111111', name: '스캔A', sector_id: 'S1', entry_score: 4, trend_grade: 'A', quick_trade_score: 80, adaptive_score: 70, liquidity: 50_000_000_000, intraday_change_pct: 2.5 },
  { code: '222222', name: '스캔B', sector_id: 'S1', entry_score: 3, trend_grade: 'B', quick_trade_score: 70, adaptive_score: 60, liquidity: 20_000_000_000, intraday_change_pct: 1 },
  { code: '333333', name: '스캔C', sector_id: 'S1', entry_score: 3, trend_grade: 'B', quick_trade_score: 65, adaptive_score: 55, liquidity: 20_000_000_000, intraday_change_pct: 1 },
  { code: '444444', name: '스캔D', sector_id: 'S2', entry_score: 2, trend_grade: 'C', quick_trade_score: 50, adaptive_score: 40, liquidity: 5_000_000_000, intraday_change_pct: 0 },
]

vi.mock('../../lib/api', () => ({
  apiFetch: vi.fn((url: string, opts?: { method?: string; body?: string }) => {
    const u = String(url)
    calls.push({ url: u, method: opts?.method, body: opts?.body })
    if (u.startsWith('/api/ui/stock-latest')) {
      const code = decodeURIComponent(/code=([^&]+)/.exec(u)?.[1] ?? '')
      if (code === stockLatestFail || !STOCKS[code]) return Promise.resolve({})
      const s = STOCKS[code]
      return Promise.resolve({ profile: { name: s.name }, latest: { close: s.adv.entryHigh, trade_date: '2026-10-09' }, advisor: s.adv })
    }
    if (u.startsWith('/api/ui/news')) return Promise.resolve({ data: [{ title: '뉴스 &amp; 제목', link: 'https://news.example/1', source: '언론사' }] })
    if (u.startsWith('/api/ui/scan-highlights')) return Promise.resolve({ data: [] })
    if (u.startsWith('/api/ui/scan-candidates')) return Promise.resolve({ data: SCAN })
    if (u.startsWith('/api/ui/report-snapshot')) return Promise.resolve({ ok: true })
    return Promise.resolve({ data: null })
  }),
  getAuthHeaders: vi.fn(async () => ({})),
  invalidateCache: vi.fn(),
}))
vi.mock('../../lib/useSeedCapital', () => ({
  useSeedCapital: () => seedCapital,
  useSeedCapitalState: () => ({ seed: seedCapital, loaded: seedLoaded }),
}))
vi.mock('../../lib/userState', () => ({ userScopedKey: (k: string) => k }))
vi.mock('../../stores/profileStore', () => ({ useCurrentChatId: () => '123', getCurrentClientIdFromStore: () => 'client-1' }))
vi.mock('../../stores/viewModeStore', () => ({ useDetailed: () => true }))
vi.mock('../../components/ui/Detail', () => ({ default: ({ children }: { children: unknown }) => <>{children}</> }))
vi.mock('../../components/ToastProvider', () => ({ useToast: () => ({ show: (m: string) => { toasts.push(m) } }) }))
vi.mock('../../components/ShareModal', () => ({ default: () => null }))
vi.mock('../../components/EconomicEventBadge', () => ({ default: () => null }))
vi.mock('../../hooks/useShareManager', () => ({
  useShareManager: () => ({
    open: false, close: vi.fn(), setOpen: shareSpy.setOpen, info: null, list: [], loading: false, creating: false,
    includeAll: false, setIncludeAll: vi.fn(), revokeShare: vi.fn(), revokeAllShares: vi.fn(), revokingId: null, revokingAll: false,
    requiresCode: true, createShare: shareSpy.createShare, loadList: shareSpy.loadList,
  }),
}))

const callsTo = (prefix: string) => calls.filter((c) => c.url.startsWith(prefix))
const codesBox = () => screen.getByPlaceholderText('005930, 000660, 272210') as HTMLTextAreaElement
const setCodes = (v: string) => fireEvent.change(codesBox(), { target: { value: v } })
const pageText = () => document.body.textContent || ''

describe('실행 가이드', () => {
  beforeEach(() => {
    calls.length = 0
    toasts.length = 0
    shareSpy.createShare.mockReset()
    seedCapital = null
    seedLoaded = true
    stockLatestFail = null
    window.history.replaceState({}, '', '/')
    try { sessionStorage.clear(); localStorage.clear() } catch { /* ignore */ }
  })

  it('종목이 없으면 안내 문구가 보이고 생성 버튼이 막힌다', () => {
    render(<ExecutionGuidePage />)
    expect(screen.getByText('종목 코드를 입력한 뒤 가이드 생성을 눌러 주세요.')).toBeTruthy()
    expect((screen.getByRole('button', { name: '가이드 생성' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('종목 3개를 넣고 생성하면 종목별 조회·수량 계산·스냅샷 저장이 일어난다', async () => {
    render(<ExecutionGuidePage />)
    setCodes('005930, 000660, 035420')
    fireEvent.click(screen.getByRole('button', { name: '가이드 생성' }))
    expect(await screen.findByText('삼성전자 (005930)')).toBeTruthy()
    expect(callsTo('/api/ui/stock-latest')).toHaveLength(3)
    // 투자금 1천만원, 종목당 최대 25% → 3종목 균등(333만)보다 작은 250만원이 예산, 진입 기준가 50,000원 → 50주
    await waitFor(() => expect(pageText()).toContain('50주'))
    expect(pageText()).toContain('2,500,000')
    expect(pageText()).toContain('경고1')
    expect(pageText()).toContain('뉴스 & 제목')
    await waitFor(() => expect(callsTo('/api/ui/report-snapshot')).toHaveLength(1))
    expect(JSON.parse(callsTo('/api/ui/report-snapshot')[0].body!)).toMatchObject({ topic: '실행가이드' })
  })

  it('뉴스 포함을 끄면 뉴스를 조회하지 않는다', async () => {
    render(<ExecutionGuidePage />)
    setCodes('005930, 000660, 035420')
    fireEvent.click(screen.getByLabelText(/뉴스 상위 3건 요약 포함/))
    fireEvent.click(screen.getByRole('button', { name: '가이드 생성' }))
    await screen.findByText('삼성전자 (005930)')
    expect(callsTo('/api/ui/news')).toHaveLength(0)
  })

  it('위험 성향이 공격이면 손절·목표를 보정한 가격이 나온다', async () => {
    render(<ExecutionGuidePage />)
    setCodes('005930, 000660, 035420')
    fireEvent.change(screen.getByDisplayValue('중립'), { target: { value: 'aggressive' } })
    fireEvent.click(screen.getByRole('button', { name: '가이드 생성' }))
    await screen.findByText('삼성전자 (005930)')
    // 손절 47,000×1.15=54,050 / 목표1 54,000×1.18=63,720
    await waitFor(() => expect(pageText()).toContain('54,050'))
    expect(pageText()).toContain('63,720')
  })

  it('종목이 3개 미만이면 자동 후보로 채운다', async () => {
    render(<ExecutionGuidePage />)
    setCodes('005930')
    fireEvent.click(screen.getByRole('button', { name: '가이드 생성' }))
    await waitFor(() => expect(callsTo('/api/ui/scan-candidates')).toHaveLength(1))
    await waitFor(() => expect(callsTo('/api/ui/stock-latest').length).toBeGreaterThan(1))
    expect(callsTo('/api/ui/scan-highlights')).toHaveLength(1)
  })

  it('한 종목이라도 조회에 실패하면 전체를 실패로 보여준다', async () => {
    stockLatestFail = '000660'
    render(<ExecutionGuidePage />)
    setCodes('005930, 000660, 035420')
    fireEvent.click(screen.getByRole('button', { name: '가이드 생성' }))
    expect(await screen.findByText('000660: 종목 데이터 조회 실패')).toBeTruthy()
    expect(screen.queryByText('삼성전자 (005930)')).toBeNull()
    expect(screen.getByText('종목 코드를 입력한 뒤 가이드 생성을 눌러 주세요.')).toBeTruthy()
  })

  it('URL의 codes·source를 이어받아 자동으로 가이드를 만든다', async () => {
    window.history.replaceState({}, '', '/execution-guide?codes=005930,000660,035420&source=scan')
    render(<ExecutionGuidePage />)
    await waitFor(() => expect(codesBox().value).toBe('005930, 000660, 035420'))
    expect((screen.getByDisplayValue('스캔 연동') as HTMLInputElement).value).toBe('스캔 연동')
    // 이어받기(pending)가 아니라 URL이므로 자동 생성은 하지 않는다
    await new Promise((r) => setTimeout(r, 50))
    expect(callsTo('/api/ui/stock-latest')).toHaveLength(0)
  })

  it('다른 화면이 sessionStorage로 넘긴 종목을 이어받고 한 번만 자동 생성한다', async () => {
    sessionStorage.setItem('execution_guide_pending_v1', JSON.stringify({ codes: ['005930', '000660', '035420'], source: 'backtest' }))
    render(<ExecutionGuidePage />)
    expect(await screen.findByText('삼성전자 (005930)')).toBeTruthy()
    expect(codesBox().value).toBe('005930, 000660, 035420')
    expect(screen.getByDisplayValue('백테스트 연동')).toBeTruthy()
    expect(sessionStorage.getItem('execution_guide_pending_v1')).toBeNull()
    await new Promise((r) => setTimeout(r, 50))
    expect(callsTo('/api/ui/stock-latest')).toHaveLength(3)
  })

  it('이어받은 종목 자동 생성은 시드 조회가 끝나 투자금에 반영된 뒤에 한다', async () => {
    seedLoaded = false
    sessionStorage.setItem('execution_guide_pending_v1', JSON.stringify({ codes: ['005930', '000660', '035420'], source: 'backtest' }))
    const { rerender } = render(<ExecutionGuidePage />)
    await new Promise((r) => setTimeout(r, 50))
    // 시드 조회 전에는 1천만원 기본값으로 만들지 않는다
    expect(callsTo('/api/ui/stock-latest')).toHaveLength(0)
    seedCapital = 2_000_000
    seedLoaded = true
    rerender(<ExecutionGuidePage />)
    expect(await screen.findByText('삼성전자 (005930)')).toBeTruthy()
    expect(callsTo('/api/ui/stock-latest')).toHaveLength(3)
    // 투자금 200만원, 종목당 최대 25% → 50만원 예산, 진입 기준가 50,000원 → 10주
    await waitFor(() => expect(pageText()).toContain('10주'))
    expect(pageText()).not.toContain('50주')
  })

  it('다른 화면이 종목을 넘겨도 시뮬레이터 계획의 투자금을 쓴다', async () => {
    seedCapital = 3_000_000
    localStorage.setItem('highlight_simulation_plan', JSON.stringify({ createdAt: 1, totalCapital: 6_000_000, notes: '', items: [] }))
    sessionStorage.setItem('execution_guide_pending_v1', JSON.stringify({ codes: ['005930'], source: 'backtest' }))
    render(<ExecutionGuidePage />)
    await waitFor(() => expect(screen.getByDisplayValue('6000000')).toBeTruthy())
  })

  it('넘겨받은 종목이 없으면 시뮬레이터 계획의 종목·투자금을 이어받는다', async () => {
    localStorage.setItem('highlight_simulation_plan', JSON.stringify({
      createdAt: 1, totalCapital: 6_000_000, notes: '',
      items: [{ code: '005930', name: 'a' }, { code: 'CASH', name: '현금' }, { code: '000660', name: 'b' }, { code: '035420', name: 'c' }],
    }))
    render(<ExecutionGuidePage />)
    await waitFor(() => expect(codesBox().value).toBe('005930, 000660, 035420'))
    expect(screen.getByDisplayValue('6000000')).toBeTruthy()
    expect(screen.getByDisplayValue('시뮬레이터 계획')).toBeTruthy()
  })

  it('계획에 투자금이 없으면 내 시드를 투자금으로 쓴다', async () => {
    seedCapital = 3_000_000
    render(<ExecutionGuidePage />)
    await waitFor(() => expect(screen.getByDisplayValue('3000000')).toBeTruthy())
  })

  it('자동 후보 찾기: 실행하면 후보 카드가 뜨고 상위 후보 코드를 입력칸에 반영한다', async () => {
    render(<ExecutionGuidePage />)
    fireEvent.click(screen.getByRole('button', { name: /자동 후보 찾기 \(고급\)/ }))
    fireEvent.click(await screen.findByRole('button', { name: '자동 후보 찾기 실행' }))
    expect(await screen.findByText(/스캔A \(111111\)/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '상위 후보 코드 반영' }))
    expect(codesBox().value).toContain('111111')
    expect(screen.getByDisplayValue(/자동 후보\(밸런스\)/)).toBeTruthy()
  })

  it('가이드를 만든 뒤 공유 버튼은 실행가이드 공유를 만든다', async () => {
    render(<ExecutionGuidePage />)
    setCodes('005930, 000660, 035420')
    fireEvent.click(screen.getByRole('button', { name: '가이드 생성' }))
    await screen.findByText('삼성전자 (005930)')
    await waitFor(() => expect(callsTo('/api/ui/report-snapshot')).toHaveLength(1))
    fireEvent.click(screen.getByRole('button', { name: '공유' }))
    await waitFor(() => expect(shareSpy.createShare).toHaveBeenCalledWith('실행가이드', { topic: '실행가이드' }))
    // 스냅샷이 이미 저장된 상태라 다시 저장하지 않는다
    expect(callsTo('/api/ui/report-snapshot')).toHaveLength(1)
  })

  it('가이드가 없을 때 공유는 막혀 있다', () => {
    render(<ExecutionGuidePage />)
    expect((screen.getByRole('button', { name: '공유' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
