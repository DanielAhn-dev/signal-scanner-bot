import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import SectorsPage from './index'

// 분해 전에 현재 동작을 고정하는 스모크 테스트. API·경제 이벤트 배지는 가짜다.
type Call = { url: string; cacheMs?: number }
const calls: Call[] = []
let sectorsError: string | null = null
let overview: unknown = { economicPhase: { phase: 'normal', label: '정상' }, tradingSignal: {} }
let overviewFails = false

const SECTORS = [
  { id: 'S1', name: '건설', score: 80, change_rate: 1.5, updated_at: '2026-10-09T01:00:00Z', metrics: { core_count: 5, stock_count: 20, flow_inst_5d: 200_000_000, flow_foreign_5d: 100_000_000 } },
  { id: 'S2', name: '식품', score: 60, change_rate: -0.5, metrics: { flow_inst_5d: -300_000_000, flow_foreign_5d: 0 } },
  { id: 'S3', name: '철강', score: 45, change_rate: 2.0, metrics: { flow_inst_5d: 50_000_000 } },
  { id: 'S4', name: '화학', score: 30, change_rate: -1, metrics: {} },
]
const LEADERS: Record<string, unknown[]> = {
  S1: [{ code: '000001', name: '건설대장', market: 'KOSPI', market_cap: 5_000_000_000_000, liquidity: 1, is_sector_leader: true }],
  S2: [], S3: [{ code: '000003', name: '철강대장', market: 'KOSPI', market_cap: 1_000_000_000_000, liquidity: 1, is_sector_leader: false }],
}

vi.mock('../../lib/api', () => ({
  apiFetch: vi.fn((url: string, opts?: { cacheMs?: number }) => {
    const u = String(url)
    calls.push({ url: u, cacheMs: opts?.cacheMs })
    if (u.startsWith('/api/ui/sectors')) {
      return sectorsError ? Promise.reject(new Error(sectorsError)) : Promise.resolve({ data: SECTORS })
    }
    if (u.startsWith('/api/ui/market-overview')) {
      return overviewFails ? Promise.reject(new Error('overview down')) : Promise.resolve({ data: overview })
    }
    if (u.startsWith('/api/ui/sector-leaders')) {
      const ids = decodeURIComponent(/sectorIds=([^&]+)/.exec(u)?.[1] ?? '').split(',')
      const data: Record<string, unknown[]> = {}
      for (const id of ids) data[id] = LEADERS[id] ?? []
      return Promise.resolve({ data, criteria: '테스트 기준' })
    }
    return Promise.resolve({ data: null })
  }),
  invalidateCache: vi.fn(),
}))
vi.mock('../../components/EconomicEventBadge', () => ({ default: () => null }))

const callsTo = (prefix: string) => calls.filter((c) => c.url.startsWith(prefix))
const pageText = () => document.body.textContent || ''
const rankedNames = () => Array.from(document.querySelectorAll('td.sector-sheet__cell-name')).map((e) => e.textContent)
const tab = (name: string) => screen.getByRole('button', { name })

describe('섹터', () => {
  beforeEach(() => {
    calls.length = 0
    sectorsError = null
    overviewFails = false
    overview = { economicPhase: { phase: 'normal', label: '정상' }, tradingSignal: {} }
    try { localStorage.clear(); sessionStorage.clear() } catch { /* ignore */ }
  })

  it('마운트하면 섹터와 시장 개요를 조회하고 상위 섹터(점수 55 이상)를 점수순으로 보여준다', async () => {
    render(<SectorsPage />)
    await waitFor(() => expect(rankedNames()).toEqual(['건설', '식품']))
    expect(callsTo('/api/ui/sectors')).toHaveLength(1)
    expect(callsTo('/api/ui/market-overview')).toHaveLength(1)
    expect(pageText()).toContain('상위 2 · 다음 2')
    expect(pageText()).toContain('건설 · 식품 · 철강')
  })

  it('시장 개요 조회가 실패해도 섹터는 보여준다', async () => {
    overviewFails = true
    render(<SectorsPage />)
    await waitFor(() => expect(rankedNames()).toEqual(['건설', '식품']))
  })

  it('60초 이내 캐시가 있으면 조회하지 않고 바로 보여준다', async () => {
    localStorage.setItem('ls_sectors_page', JSON.stringify({ ts: Date.now(), data: SECTORS }))
    render(<SectorsPage />)
    expect(rankedNames()).toEqual(['건설', '식품'])
    await new Promise((r) => setTimeout(r, 30))
    expect(callsTo('/api/ui/sectors')).toHaveLength(0)
  })

  it('오래된 캐시는 무시하고 다시 조회한다', async () => {
    localStorage.setItem('ls_sectors_page', JSON.stringify({ ts: Date.now() - 120_000, data: SECTORS }))
    render(<SectorsPage />)
    await waitFor(() => expect(callsTo('/api/ui/sectors')).toHaveLength(1))
  })

  it('다음 섹터 탭은 수급 합이 플러스이거나 오르는 섹터를 수급 순으로 보여준다', async () => {
    render(<SectorsPage />)
    await waitFor(() => expect(rankedNames()).toEqual(['건설', '식품']))
    fireEvent.click(tab('다음 섹터'))
    await waitFor(() => expect(rankedNames()).toEqual(['건설', '철강']))
    expect(pageText()).toContain('순환매 후보 섹터')
  })

  it('전체 섹터 탭은 성격 범례와 섹터 카드를 보여준다', async () => {
    render(<SectorsPage />)
    await waitFor(() => expect(rankedNames()).toEqual(['건설', '식품']))
    fireEvent.click(tab('전체 섹터'))
    await waitFor(() => expect(pageText()).toContain('경기민감'))
    expect(pageText()).toContain('철강')
    expect(pageText()).toContain('화학')
  })

  it('섹터 가이드 탭은 국면 가이드를 보여준다', async () => {
    render(<SectorsPage />)
    await waitFor(() => expect(rankedNames()).toEqual(['건설', '식품']))
    fireEvent.click(tab('섹터 가이드'))
    await waitFor(() => expect(document.querySelector('.sector-guide')).toBeTruthy())
  })

  it('상위 섹터 대장주를 한 번에 조회하고, 탭을 바꿔도 이미 받은 섹터는 다시 조회하지 않는다', async () => {
    render(<SectorsPage />)
    await waitFor(() => expect(callsTo('/api/ui/sector-leaders')).toHaveLength(1))
    expect(decodeURIComponent(callsTo('/api/ui/sector-leaders')[0].url)).toContain('sectorIds=S1,S2')
    expect(callsTo('/api/ui/sector-leaders')[0].url).toContain('limitPerSector=3')
    fireEvent.click(tab('다음 섹터'))
    await waitFor(() => expect(callsTo('/api/ui/sector-leaders')).toHaveLength(2))
    expect(decodeURIComponent(callsTo('/api/ui/sector-leaders')[1].url)).toContain('sectorIds=S3')
    expect(decodeURIComponent(callsTo('/api/ui/sector-leaders')[1].url)).not.toContain('S1')
  })

  it('상세를 누르면 펼쳐 대장주를 보여주고, 대장주를 누르면 분석 화면으로 넘긴다', async () => {
    const nav = vi.fn()
    render(<SectorsPage onNavigate={nav} />)
    await waitFor(() => expect(callsTo('/api/ui/sector-leaders')).toHaveLength(1))
    const detail = screen.getAllByRole('button', { name: '상세' })[0]
    fireEvent.click(detail)
    const leader = await screen.findByTitle('건설대장 분석으로 이동')
    expect(pageText()).toContain('선정 기준: 테스트 기준')
    expect(screen.getAllByRole('button', { name: '접기' })).toHaveLength(1)
    fireEvent.click(leader)
    expect(sessionStorage.getItem('analyze_pending_code')).toBe('000001')
    expect(nav).toHaveBeenCalledWith('analyze')
  })

  it('점수 격차가 작고 거시 국면이 없으면 국면 판단을 보류한다', async () => {
    overviewFails = true
    render(<SectorsPage />)
    await waitFor(() => expect(rankedNames()).toEqual(['건설', '식품']))
    expect(pageText()).toContain('판단중')
    expect(pageText()).toContain('상위 국면 간 점수 차가 작아 판단 보류')
    expect(pageText()).toContain('36% · 낮음')
  })

  it('거시 국면이 불일치하면 신뢰도를 깎고 섹터+거시 혼합으로 표시한다', async () => {
    render(<SectorsPage />)
    await waitFor(() => expect(rankedNames()).toEqual(['건설', '식품']))
    expect(pageText()).toContain('섹터+거시 혼합')
    expect(pageText()).toContain('불일치')
    expect(pageText()).toContain('24% · 낮음')
  })

  it('새로고침은 캐시 없이 다시 조회한다', async () => {
    render(<SectorsPage />)
    await waitFor(() => expect(rankedNames()).toEqual(['건설', '식품']))
    fireEvent.click(screen.getByRole('button', { name: '새로고침' }))
    await waitFor(() => expect(callsTo('/api/ui/sectors')).toHaveLength(2))
    expect(callsTo('/api/ui/sectors')[1].cacheMs).toBe(0)
  })

  it('조회 실패 시 오류를 보여준다', async () => {
    sectorsError = '서버 오류'
    render(<SectorsPage />)
    expect(await screen.findByText('서버 오류')).toBeTruthy()
  })
})
