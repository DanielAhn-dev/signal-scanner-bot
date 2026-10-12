import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import StrategyPage from './index'

// 분해 전에 현재 동작을 고정하는 스모크 테스트. API는 전부 가짜이며 설정 저장도 실제로 나가지 않는다.
const DECISIONS = [
  { id: 3, code: '005930', stock_name: '삼성전자', action: 'SELL', created_at: '2026-10-08T01:00:00Z', strategy_version: 'v2', market_regime: 'bull', trigger_label: 'take-profit', is_auto: true },
  { id: 2, code: '005930', stock_name: '삼성전자', action: 'BUY', created_at: '2026-10-07T01:00:00Z', strategy_version: 'v2', market_regime: 'bull', trigger_label: 'new-buy', is_auto: true },
  { id: 1, code: '000660', stock_name: 'SK하이닉스', action: 'BUY', created_at: '2026-10-06T01:00:00Z', strategy_version: 'v1', market_regime: 'sideways', trigger_label: 'manual', is_auto: false },
]
const SETTINGS = { is_enabled: true, selected_strategy: 'REDUCE_TIGHT', min_buy_score: 72, take_profit_pct: 8, stop_loss_pct: 4, max_positions: 10, monday_buy_slots: 2 }
const sell = (id: string, pnl: number, day: string) => ({ id, code: '005930', stock_name: '삼성전자', side: 'SELL', pnl_amount: pnl, created_at: `2026-10-${day}T01:00:00Z` })
// 누적: 10,000 → 6,000 → 12,000 → 14,000 / 롤링(2건) 승률: 50 → 50 → 100, 평균 67
const ACTIVITY = [sell('a1', 10000, '01'), sell('a2', -4000, '02'), sell('a3', 6000, '03'), sell('a4', 2000, '04'), { id: 'b1', code: '005930', side: 'BUY', pnl_amount: null, created_at: '2026-10-05T01:00:00Z' }]
const ADAPTIVE = {
  latestTradeDate: '2026-10-07', horizonBars: 3, sampleCount: 120, baseHitRatePct: 55, baseAvgReturnPct: 1.2, strengthScore: 63,
  todayBiasSummary: '눌림 깊이 완만',
  topPositiveFactors: [{ key: 'k1', factor: 'f1', label: '추세 양호', sampleCount: 40, winRatePct: 60, avgForwardReturnPct: 1.8, weight: 4 }],
  topNegativeFactors: [],
}
const pattern = (name: string, samples: number, win: number, lift: number, ret: number, mdd: number) => ({
  name, samples, winRatePct: win, liftVsBasePct: lift, avgForwardReturnPct: ret, avgMaxDrawdownPct: mdd,
})
const PRE_RALLY = {
  generatedAt: '2026-10-07T00:00:00Z', fileName: 'pre.json', dataset: { labeledRows: 1234 }, baseline: { testWinRatePct: 41 },
  stablePatterns: [pattern('패턴A', 50, 50, 6, 3, -8), pattern('패턴B', 200, 44, 2, 5, -18), pattern('패턴C', 20, 70, -1, 1, -5)],
  notes: ['노트1'],
}

type Call = { url: string; method?: string; body?: string }
const calls: Call[] = []
let saveResponse: unknown = null

vi.mock('../../lib/api', () => ({
  apiFetch: vi.fn((url: string, opts?: { method?: string; body?: string }) => {
    const u = String(url)
    calls.push({ url: u, method: opts?.method, body: opts?.body })
    if (u.startsWith('/api/ui/decisions')) return Promise.resolve({ data: DECISIONS })
    if (u.startsWith('/api/ui/settings')) {
      if (opts?.method === 'POST') return Promise.resolve(saveResponse ?? { data: JSON.parse(String(opts.body)) })
      return Promise.resolve({ data: SETTINGS })
    }
    if (u.startsWith('/api/ui/operations')) return Promise.resolve({ data: ACTIVITY })
    if (u.startsWith('/api/ui/strategy-adaptive')) return Promise.resolve({ data: ADAPTIVE })
    if (u.startsWith('/api/ui/pre-rally-patterns')) return Promise.resolve({ data: PRE_RALLY })
    return Promise.resolve({ data: null })
  }),
  invalidateCache: vi.fn(),
}))

const callsTo = (prefix: string) => calls.filter((c) => c.url.startsWith(prefix))
const order = (names: string[]) => {
  const text = document.body.textContent || ''
  return names.map((n) => ({ n, i: text.indexOf(n) })).sort((a, b) => a.i - b.i).map((x) => x.n)
}

describe('전략 대시보드', () => {
  beforeEach(() => {
    calls.length = 0
    saveResponse = null
  })

  it('현황 탭: 현재 전략·자동매매 상태·설정값 요약을 보여준다', async () => {
    render(<StrategyPage />)
    expect(await screen.findByText('타이트 손절')).toBeTruthy()
    expect(screen.getByText('활성화')).toBeTruthy()
    expect(screen.getByText('72')).toBeTruthy()
    expect(screen.getByText('8% / 4%')).toBeTruthy()
    expect(screen.getByText('10종목')).toBeTruthy()
    expect(screen.getByText('2개')).toBeTruthy()
  })

  it('현황 탭: 적응형 엔진과 의사결정 요약(건수·자동 비율)을 보여준다', async () => {
    render(<StrategyPage />)
    expect(await screen.findByText('눌림 깊이 완만')).toBeTruthy()
    expect(screen.getByText('추세 양호')).toBeTruthy()
    expect(await screen.findByText('3건')).toBeTruthy()
    expect(screen.getByText('67%')).toBeTruthy() // 자동 2건 / 전체 3건
    expect(screen.getByText('(2건)')).toBeTruthy()
  })

  it('프리랠리: 기본은 Lift 순이고 배지는 추천·주의로 나뉜다', async () => {
    render(<StrategyPage />)
    await screen.findByText('1234')
    expect(order(['패턴A', '패턴B', '패턴C'])).toEqual(['패턴A', '패턴B', '패턴C'])
    expect(screen.getAllByText('추천')).toHaveLength(1)
    expect(screen.getAllByText('주의')).toHaveLength(2) // B: 낙폭 -18%, C: Lift 음수
  })

  it('프리랠리: 정렬 기준을 바꾸면 순서가 바뀐다', async () => {
    const { container } = render(<StrategyPage />)
    await screen.findByText('1234')
    const select = container.querySelector('select') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'win' } })
    expect(order(['패턴A', '패턴B', '패턴C'])).toEqual(['패턴C', '패턴A', '패턴B'])
    fireEvent.change(select, { target: { value: 'samples' } })
    expect(order(['패턴A', '패턴B', '패턴C'])).toEqual(['패턴B', '패턴A', '패턴C'])
    fireEvent.change(select, { target: { value: 'ret' } })
    expect(order(['패턴A', '패턴B', '패턴C'])).toEqual(['패턴B', '패턴A', '패턴C'])
  })

  it('프리랠리: 기간 버튼을 누르면 그 기간으로 다시 조회한다', async () => {
    render(<StrategyPage />)
    await screen.findByText('1234')
    expect(callsTo('/api/ui/pre-rally-patterns').map((c) => c.url)).toEqual(['/api/ui/pre-rally-patterns?horizon=40'])
    fireEvent.click(screen.getByText('20거래일'))
    await waitFor(() => expect(callsTo('/api/ui/pre-rally-patterns').map((c) => c.url)).toContain('/api/ui/pre-rally-patterns?horizon=20'))
  })

  it('가정 투자금을 바꾸면 과거 가정손익이 다시 계산된다', async () => {
    const { container } = render(<StrategyPage />)
    await screen.findByText('1234')
    const input = container.querySelector('input[type="number"][min="10"]') as HTMLInputElement
    expect(input.value).toBe('500')
    expect(document.body.textContent).toContain('투자금 500만원): +150,000') // 500만원 × 평균 3%
    fireEvent.change(input, { target: { value: '1000' } })
    expect(document.body.textContent).toContain('투자금 1,000만원): +300,000')
  })

  it('새로고침을 누르면 조회 5개를 다시 호출한다', async () => {
    const { container } = render(<StrategyPage />)
    await screen.findByText('1234')
    await waitFor(() => expect(container.querySelector('h1')?.parentElement?.querySelector('button')?.hasAttribute('disabled')).toBe(false))
    const before = calls.length
    fireEvent.click(container.querySelector('h1')!.parentElement!.querySelector('button')!)
    await waitFor(() => expect(calls.length - before).toBeGreaterThanOrEqual(5))
    const added = calls.slice(before).map((c) => c.url.split('?')[0])
    expect(added).toEqual(expect.arrayContaining([
      '/api/ui/decisions', '/api/ui/settings', '/api/ui/operations', '/api/ui/strategy-adaptive', '/api/ui/pre-rally-patterns',
    ]))
  })

  it('전략 설정 탭: 전략을 고르고 저장하면 선택한 전략으로 POST한다', async () => {
    render(<StrategyPage />)
    await screen.findByText('타이트 손절')
    fireEvent.click(screen.getByRole('button', { name: '전략 설정' }))
    fireEvent.click((await screen.findAllByText('저가 매수 대기'))[0])
    fireEvent.click(screen.getByRole('button', { name: '설정 저장' }))
    expect(await screen.findByText('저장 완료')).toBeTruthy()
    const post = callsTo('/api/ui/settings').find((c) => c.method === 'POST')!
    expect(JSON.parse(post.body!)).toMatchObject({ selected_strategy: 'WAIT_AND_DIP_BUY', is_enabled: true, min_buy_score: 72 })
  })

  it('전략 설정 탭: 자동매매 활성화 체크를 끄고 저장하면 is_enabled=false로 보낸다', async () => {
    render(<StrategyPage />)
    await screen.findByText('타이트 손절')
    fireEvent.click(screen.getByRole('button', { name: '전략 설정' }))
    fireEvent.click(await screen.findByLabelText('자동매매 활성화'))
    fireEvent.click(screen.getByRole('button', { name: '설정 저장' }))
    await screen.findByText('저장 완료')
    const post = callsTo('/api/ui/settings').find((c) => c.method === 'POST')!
    expect(JSON.parse(post.body!).is_enabled).toBe(false)
  })

  it('전략 설정 탭: 서버가 오류를 돌려주면 오류 문구를 보여준다', async () => {
    saveResponse = { error: '권한 없음' }
    render(<StrategyPage />)
    await screen.findByText('타이트 손절')
    fireEvent.click(screen.getByRole('button', { name: '전략 설정' }))
    fireEvent.click(await screen.findByRole('button', { name: '설정 저장' }))
    expect(await screen.findByText('오류: 권한 없음')).toBeTruthy()
  })

  it('성장 기록 탭: 누적 실현손익과 전략·국면 전환 타임라인', async () => {
    render(<StrategyPage />)
    await screen.findByText('타이트 손절')
    fireEvent.click(screen.getByRole('button', { name: '성장 기록' }))
    expect(await screen.findByText('실현손익 추이')).toBeTruthy()
    expect(screen.getByText('1만')).toBeTruthy() // 누적 14,000원 → 1만
    expect(screen.getByText('전략 버전 전환 → v2')).toBeTruthy()
    expect(screen.getByText('시장 국면 전환 → 상승장')).toBeTruthy()
    expect(screen.getByText('전략 버전 전환 → v1')).toBeTruthy()
    expect(screen.getByText('시장 국면 전환 → 횡보장')).toBeTruthy()
    expect(screen.getByText('롤링 승률 추이')).toBeTruthy()
  })

  it('성장 기록 탭: 트리거 분포를 한글 라벨로 보여준다', async () => {
    render(<StrategyPage />)
    await screen.findByText('타이트 손절')
    fireEvent.click(screen.getByRole('button', { name: '성장 기록' }))
    expect((await screen.findAllByText('익절 매도')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('신규 매수').length).toBeGreaterThan(0)
    expect(screen.getAllByText('수동 거래').length).toBeGreaterThan(0)
  })
})
