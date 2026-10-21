import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../components/ToastProvider'
import ScanPage from './index'

// 분해 전에 현재 동작을 고정하는 스모크 테스트. 후보 하나하나의 등급은 아래 판정 기준을 일부러 갈라 놓은 값이다.
//  - 삼성전자·SK하이닉스: 진입 A/B → 상단 TOP 카드로 올라가 표에서는 빠진다(필터가 전체일 때)
//  - 알파: 이격 A → 후보 단계, 확인 단계는 아님
//  - 베타: 등급 D·경고 → 어느 단계에도 없음 (우선순위 22)
//  - 감마: 이격 B + 추세 B → 후보·확인 단계 (우선순위 0)
const base = {
  liquidity: 1_000_000_000,
  trade_date: '2026-10-09',
  stock_updated_at: '2026-10-09T06:00:00Z',
  dist_pct: 20,
  vol_atr_grade: null,
}
const CANDIDATES = [
  { ...base, code: '005930', name: '삼성전자', sector_id: '반도체', entry_grade: 'A', entry_score: 3, trend_grade: 'A', dist_grade: 'B', pivot_grade: 'B', warn_grade: 'SAFE', warn_score: 0 },
  { ...base, code: '000660', name: 'SK하이닉스', sector_id: '반도체', entry_grade: 'B', entry_score: 3, trend_grade: 'B', dist_grade: 'B', pivot_grade: 'B', warn_grade: 'SAFE', warn_score: 0 },
  { ...base, code: '111111', name: '알파', sector_id: '화학', entry_grade: 'C', entry_score: 1, trend_grade: 'C', dist_grade: 'A', pivot_grade: 'C', warn_grade: 'SAFE', warn_score: 1 },
  { ...base, code: '222222', name: '베타', sector_id: '화학', entry_grade: 'C', entry_score: 2, trend_grade: 'D', dist_grade: 'D', pivot_grade: 'D', warn_grade: 'WARN', warn_score: 6 },
  { ...base, code: '333333', name: '감마', sector_id: '반도체', entry_grade: 'C', entry_score: 0, trend_grade: 'B', dist_grade: 'B', pivot_grade: 'C', warn_grade: 'SAFE', warn_score: 0 },
]

let holdScan = false
vi.mock('../../lib/api', () => ({
  apiFetch: vi.fn((url: string) => {
    const u = String(url)
    if (u.startsWith('/api/ui/scan-candidates')) {
      if (holdScan) return new Promise(() => {})
      return Promise.resolve({ data: CANDIDATES, count: CANDIDATES.length, latestDate: '2026-10-09', marketPhase: 'after-close', realtimeAppliedCount: 0 })
    }
    if (u.startsWith('/api/ui/positions')) return Promise.resolve({ data: [], count: 0 })
    return Promise.resolve({ data: null })
  }),
  invalidateCache: vi.fn(),
}))

const SNAPSHOT_KEY = 'scan_snapshot_v1'

function renderPage(onNavigate?: (route: string) => void) {
  return render(
    <ToastProvider>
      <ScanPage onNavigate={onNavigate} />
    </ToastProvider>,
  )
}

/** 표의 종목명 열(2번째 칸)을 위에서 아래로 */
const tableNames = (c: HTMLElement) =>
  Array.from(c.querySelectorAll('.scan-candidates-table tbody tr td:nth-child(2)')).map((e) => e.textContent?.trim())

describe('스캔 화면', () => {
  beforeEach(() => {
    // jsdom에는 matchMedia가 없다. 데스크톱 폭(모바일 아님)으로 고정한다
    window.matchMedia = ((query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
    Element.prototype.scrollIntoView = () => {}
    holdScan = false
    window.history.pushState({}, '', '/')
    try { sessionStorage.clear(); localStorage.clear() } catch { /* ignore */ }
  })

  it('TOP 카드로 올라간 종목을 뺀 나머지를 우선순위 큰 순으로 표에 보여준다', async () => {
    const { container } = renderPage()
    await waitFor(() => expect(tableNames(container)).toEqual(['베타', '알파', '감마']))
    // 머리글의 "N개 후보"는 조건 버튼과 같은 전체 기준이고, TOP 카드와 아래 표로 나눠 적는다
    expect(container.querySelector('.scan-stat-count')?.textContent).toBe('5')
    expect(screen.getByText(/위 TOP 카드 2 \+ 아래 표 3/)).toBeTruthy()
    expect(screen.getByText('눌림목 집행 TOP 카드')).toBeTruthy()
  })

  it('조건 버튼에 단계별 개수가 붙는다', async () => {
    const { container } = renderPage()
    await waitFor(() => expect(tableNames(container)).toHaveLength(3))
    expect(screen.getByRole('button', { name: /^후보 \(4\)$/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^확인 \(3\)$/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^전체 \(5\)$/ })).toBeTruthy()
  })

  it('후보 모드를 누르면 후보 단계 종목만 남고 TOP 카드 종목도 표에 들어온다', async () => {
    const { container } = renderPage()
    await waitFor(() => expect(tableNames(container)).toHaveLength(3))
    fireEvent.click(screen.getByRole('button', { name: /^후보 \(4\)$/ }))
    await waitFor(() => expect([...tableNames(container)].sort()).toEqual(['SK하이닉스', '감마', '삼성전자', '알파'].sort()))
    expect(screen.queryByText('눌림목 집행 TOP 카드')).toBeNull()
  })

  it('확인 모드는 확인 단계 종목만 남긴다', async () => {
    const { container } = renderPage()
    await waitFor(() => expect(tableNames(container)).toHaveLength(3))
    fireEvent.click(screen.getByRole('button', { name: /^확인 \(3\)$/ }))
    await waitFor(() => expect([...tableNames(container)].sort()).toEqual(['SK하이닉스', '감마', '삼성전자'].sort()))
  })

  it('섹터를 고르면 그 섹터 종목만, 우선순위 큰 순으로 보인다', async () => {
    const { container } = renderPage()
    await waitFor(() => expect(tableNames(container)).toHaveLength(3))
    fireEvent.change(container.querySelector('select.scan-sector-select') as HTMLSelectElement, { target: { value: '화학' } })
    await waitFor(() => expect(tableNames(container)).toEqual(['베타', '알파']))
    expect(screen.queryByText('눌림목 집행 TOP 카드')).toBeNull()
  })

  it('종목명 머리글을 누르면 가나다순, 다시 누르면 역순', async () => {
    const { container } = renderPage()
    await waitFor(() => expect(tableNames(container)).toHaveLength(3))
    const header = container.querySelector('.scan-candidates-table thead') as HTMLElement
    fireEvent.click(within(header).getByRole('button', { name: /종목명/ }))
    await waitFor(() => expect(tableNames(container)).toEqual(['감마', '베타', '알파']))
    fireEvent.click(within(header).getByRole('button', { name: /종목명/ }))
    await waitFor(() => expect(tableNames(container)).toEqual(['알파', '베타', '감마']))
  })

  it('주소의 filter=buycheck로 열면 매수검토 모드(보유 기준 입력)가 켜져 있다', async () => {
    window.history.pushState({}, '', '/scan?filter=buycheck')
    renderPage()
    expect(await screen.findByText('최대 보유 기준')).toBeTruthy()
  })

  it('불러온 후보를 세션에 저장하고, 다음에 열 때는 응답을 기다리지 않고 바로 보여준다', async () => {
    const first = renderPage()
    await waitFor(() => expect(tableNames(first.container)).toHaveLength(3))
    const saved = JSON.parse(sessionStorage.getItem(SNAPSHOT_KEY) || 'null')
    expect(saved.candidates.map((c: { code: string }) => c.code)).toEqual(['005930', '000660', '111111', '222222', '333333'])
    expect(saved.latestDate).toBe('2026-10-09')
    first.unmount()

    holdScan = true // 이번에는 서버가 응답하지 않는다
    const second = renderPage()
    expect(tableNames(second.container)).toEqual(['베타', '알파', '감마'])
  })

  it('행을 누르면 분석 화면으로 가면서 종목 코드를 넘긴다', async () => {
    const onNavigate = vi.fn()
    const { container } = renderPage(onNavigate)
    await waitFor(() => expect(tableNames(container)).toHaveLength(3))
    fireEvent.click(container.querySelector('.scan-candidates-table tbody tr') as HTMLElement)
    expect(onNavigate).toHaveBeenCalledWith('analyze')
    expect(sessionStorage.getItem('analyze_pending_code')).toBe('222222')
  })

  it('데이 전략 모드를 열면 실행 가이드 카드와 근거 패널이 함께 나온다', async () => {
    window.history.pushState({}, '', '/scan?filter=strategy_day')
    renderPage()
    expect(await screen.findByText('데이 전략 실행 가이드')).toBeTruthy()
    expect(screen.getAllByText(/권장 0.5R/).length).toBeGreaterThan(0)
  })

  it('표에서 눌림 점수가 55 이상인 종목에 눌림형 배지가 붙는다', async () => {
    const { container } = renderPage()
    await waitFor(() => expect(tableNames(container)).toEqual(['베타', '알파', '감마']))
    // 알파(56점)·감마(62점)는 눌림형, 베타는 점수 미달
    const rows = Array.from(container.querySelectorAll('.scan-candidates-table tbody tr'))
    const badged = rows.filter((tr) => tr.textContent?.includes('눌림형')).map((tr) => tr.querySelector('td:nth-child(2)')?.textContent?.trim())
    expect(badged).toEqual(['알파', '감마'])
  })
})
