import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import OperationsPage from './index'

// 분해 전에 현재 동작을 고정하는 스모크 테스트. 서버 호출은 전부 가짜이며 실제 사이클 실행 요청은 나가지 않는다.
type Call = { url: string; method?: string; body?: any }
const calls: Call[] = []
const toasts: string[] = []
let postResponse: any = null
let jobResponses: any[] = []
let jobCallIndex = 0
let lastPostDryRun: boolean | undefined

const ACTIVITY = [
  { id: 't1', code: '005930', stock_name: '삼성전자', side: 'BUY', price: 70000, quantity: 3, gross_amount: 210000, fee_amount: 100, tax_amount: 0, memo: 'strategy=core.autotrade.v1;event=new-buy;note=autotrade-x', created_at: '2026-10-09T01:00:00Z' },
  { id: 't2', code: '000660', stock_name: 'SK하이닉스', side: 'SELL', price: 100000, quantity: 1, gross_amount: 100000, fee_amount: 100, tax_amount: 50, buy_fee_amount: 100, pnl_amount: 5000, memo: null, created_at: '2026-10-09T02:00:00Z' },
]
const KPI = {
  asof: '2026-10-09', buy_count: 2, sell_count: 1, adjust_count: 0, trade_amount: 1_000_000, run_total: 5, run_success: 4, run_skipped: 0, run_failed: 1,
  queue_waiting: 0, holding_count: 3, latest_failed_reason: 'Error: timeout', virtual_cash: 2_000_000, virtual_seed_capital: 10_000_000,
}
const snapshot = (status: string, payload: any, extra: any = {}) => ({
  job: { id: 'j1', type: 'cron', status, ok: null, error: null, created_at: '2026-10-09T01:00:00Z', started_at: null, finished_at: null, payload, ...extra.job },
  latest_run: { id: 1, run_type: 'x', run_key: 'k', status: 'SUCCESS', summary: { buys: 1, sells: 0, skipped: 2, errors: 0 }, started_at: '', finished_at: null },
  recent_runs: [],
  recent_trades: [],
  timeline: [{ ts: '2026-10-09T01:00:00Z', kind: 'queued', label: '큐 등록' }],
  dry_run_details: { buys: 1, sells: 0, skipped: 2, errors: 0, notes: ['매수 후보 제외: 점수 미달'] },
  ...extra.rest,
})

vi.mock('../../lib/api', () => ({
  apiFetch: vi.fn((url: string, opts?: { method?: string; body?: string }) => {
    const u = String(url)
    const body = opts?.body ? JSON.parse(opts.body) : undefined
    calls.push({ url: u, method: opts?.method, body })
    if (opts?.method === 'POST') {
      lastPostDryRun = body?.dry_run
      return Promise.resolve(postResponse ?? { job_id: 'j1' })
    }
    if (u.includes('view=activity')) return Promise.resolve({ data: ACTIVITY })
    if (u.includes('view=dashboard')) return Promise.resolve({ data: KPI })
    if (u.includes('view=autocycle_insights')) return Promise.resolve({ data: null })
    if (u.includes('view=job')) {
      const base = jobResponses[Math.min(jobCallIndex, jobResponses.length - 1)]
      jobCallIndex += 1
      // 서버는 요청한 dry_run 값을 작업 payload에 그대로 담는다
      const r = base?.job?.payload?.task === 'virtualAutoTrade' && lastPostDryRun !== undefined
        ? { ...base, job: { ...base.job, payload: { ...base.job.payload, dry_run: lastPostDryRun } } }
        : base
      return Promise.resolve({ data: r })
    }
    if (u.includes('view=autosellcheck')) return Promise.resolve({ data: [{ code: '005930', name: '삼성전자', quantity: 3, buy_price: 70000, current_price: 66000, pct_change: -5.7 }] })
    return Promise.resolve({ data: null })
  }),
  invalidateCache: vi.fn(),
}))
const toastApi = { show: (m: string) => { toasts.push(m) } }
vi.mock('../../components/ToastProvider', () => ({ useToast: () => toastApi }))

const callsTo = (needle: string) => calls.filter((c) => c.url.includes(needle))
const posts = () => calls.filter((c) => c.method === 'POST')
const pageText = () => document.body.textContent || ''

describe('운영 패널', () => {
  beforeEach(() => {
    calls.length = 0
    toasts.length = 0
    postResponse = null
    jobResponses = [snapshot('done', { task: 'virtualAutoTradeIntraday', step: 'intraday', dry_run: true })]
    jobCallIndex = 0
    lastPostDryRun = undefined
  })

  it('마운트하면 이력·KPI·인사이트를 조회하고 매매 근거와 비용·순손익을 보여준다', async () => {
    render(<OperationsPage />)
    expect(await screen.findByText('삼성전자')).toBeTruthy()
    expect(callsTo('view=activity')).toHaveLength(1)
    expect(callsTo('view=dashboard')).toHaveLength(1)
    expect(callsTo('view=autocycle_insights')).toHaveLength(1)
    expect(pageText()).toContain('자동매매 · ')
    expect(pageText()).toContain('매매 근거 없음')
    expect(pageText()).toContain('총비용')
    expect(pageText()).toContain('순손익 +5,000')
    // KPI
    await waitFor(() => expect(pageText()).toContain('3건'))
    expect(pageText()).toContain('매수 2 · 매도 1')
    expect(pageText()).toContain('20.0%')
    expect(pageText()).toContain('작업 처리 시간이 초과되었습니다')
  })

  it('"지금 확인"은 순차 트리거(장중)를 드라이런으로 요청하고, 완료되면 목록을 다시 조회한다', async () => {
    render(<OperationsPage />)
    await screen.findByText('삼성전자')
    fireEvent.click(screen.getByRole('button', { name: /지금 확인/ }))
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(posts()[0].body).toEqual({ mode: 'autotrigger', step: 'intraday', dry_run: true })
    await waitFor(() => expect(pageText()).toContain('순차트리거(intraday) 요청 등록 완료 - job_id: j1'))
    expect(callsTo('view=job&job_id=j1')).toHaveLength(1)
    // 완료 후 500/600/700ms 뒤 이력·KPI·인사이트 재조회
    await waitFor(() => expect(callsTo('view=activity')).toHaveLength(2), { timeout: 2500 })
    await waitFor(() => expect(callsTo('view=dashboard')).toHaveLength(2), { timeout: 2500 })
    await waitFor(() => expect(callsTo('view=autocycle_insights')).toHaveLength(2), { timeout: 2500 })
    expect(toasts).toContain('순차트리거 등록 완료')
    expect(screen.getByText('순차트리거(장중)')).toBeTruthy()
  })

  it('장전/장중 모드를 바꾸면 요청의 step이 달라진다', async () => {
    render(<OperationsPage />)
    await screen.findByText('삼성전자')
    fireEvent.click(screen.getByRole('button', { name: '장중 모드' }))
    fireEvent.click(screen.getByRole('button', { name: /지금 확인/ }))
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(posts()[0].body.step).toBe('ready')
  })

  it('고급 진단의 학습 점검은 드라이런으로 요청하고, 끝나면 승인 대기 배너가 뜬다', async () => {
    jobResponses = [snapshot('done', { task: 'virtualAutoTrade', dry_run: true, trigger_mode: 'learning' })]
    render(<OperationsPage />)
    await screen.findByText('삼성전자')
    fireEvent.click(screen.getByRole('button', { name: /고급 진단 보기/ }))
    fireEvent.click(await screen.findByRole('button', { name: '학습 점검' }))
    await waitFor(() => expect(posts()).toHaveLength(1))
    expect(posts()[0].body).toEqual({ mode: 'autocycle', dry_run: true, trigger_mode: 'learning' })
    expect(await screen.findByText('드라이런 검토 완료: 실행 여부를 선택하세요')).toBeTruthy()
    expect(pageText()).toContain('매수 1 · 매도 0 · 스킵 2 · 오류 0')
  })

  it('승인 대기에서 "결과 수락 후 실제 실행"을 누르면 실제 실행을 요청하고 승인 대기를 지운다', async () => {
    jobResponses = [snapshot('done', { task: 'virtualAutoTrade', dry_run: true })]
    render(<OperationsPage />)
    await screen.findByText('삼성전자')
    fireEvent.click(screen.getByRole('button', { name: /고급 진단 보기/ }))
    fireEvent.click(await screen.findByRole('button', { name: '학습 점검' }))
    await screen.findByText('드라이런 검토 완료: 실행 여부를 선택하세요')
    fireEvent.click(screen.getAllByRole('button', { name: '결과 수락 후 실제 실행' })[0])
    await waitFor(() => expect(posts()).toHaveLength(2))
    expect(posts()[1].body).toEqual({ mode: 'autocycle', dry_run: false, trigger_mode: 'auto' })
    await waitFor(() => expect(screen.queryByText('드라이런 검토 완료: 실행 여부를 선택하세요')).toBeNull())
  })

  it('배너의 닫기는 배너만 숨기고 승인 카드는 남긴다, 보류는 승인 대기를 지운다', async () => {
    jobResponses = [snapshot('done', { task: 'virtualAutoTrade', dry_run: true })]
    render(<OperationsPage />)
    await screen.findByText('삼성전자')
    fireEvent.click(screen.getByRole('button', { name: /고급 진단 보기/ }))
    fireEvent.click(await screen.findByRole('button', { name: '학습 점검' }))
    await screen.findByText('드라이런 검토 완료: 실행 여부를 선택하세요')
    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    expect(screen.queryByText('드라이런 검토 완료: 실행 여부를 선택하세요')).toBeNull()
    expect(screen.getByText('드라이런 결과 검토 완료')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '보류' }))
    expect(screen.queryByText('드라이런 결과 검토 완료')).toBeNull()
  })

  it('작업이 실패하면 원인을 번역해 보여주고 같은 조건으로 재시도할 수 있다', async () => {
    jobResponses = [snapshot('failed', { task: 'virtualAutoTradeIntraday', step: 'ready', dry_run: true }, { job: { error: 'Error: timeout while running' } })]
    render(<OperationsPage />)
    await screen.findByText('삼성전자')
    fireEvent.click(screen.getByRole('button', { name: /지금 확인/ }))
    expect(await screen.findByText('실패 원인')).toBeTruthy()
    expect(pageText()).toContain('작업 처리 시간이 초과되었습니다')
    expect(toasts).toContain('작업 실패: Error: timeout while running')
    fireEvent.click(screen.getByRole('button', { name: '동일 조건 재시도' }))
    await waitFor(() => expect(posts()).toHaveLength(2))
    expect(posts()[1].body).toEqual({ mode: 'autotrigger', step: 'ready', dry_run: true })
  })

  it('서버 오류·job_id 누락·실행 실패 문구', async () => {
    render(<OperationsPage />)
    await screen.findByText('삼성전자')
    const button = () => screen.getByRole('button', { name: /지금 확인/ })

    postResponse = { error: '권한이 없습니다' }
    fireEvent.click(button())
    expect(await screen.findByText('권한이 없습니다')).toBeTruthy()

    postResponse = {}
    fireEvent.click(button())
    expect(await screen.findByText('job_id가 비어 있습니다.')).toBeTruthy()

    postResponse = { job_id: 'j9', execution_error: 'boom' }
    fireEvent.click(button())
    expect(await screen.findByText('순차트리거(intraday) 실행 실패 - boom')).toBeTruthy()
  })

  it('진행 중 작업은 2초마다 다시 조회하고 끝나면 감시를 멈춘다', async () => {
    jobResponses = [snapshot('running', { task: 'virtualAutoTradeIntraday', dry_run: true }), snapshot('done', { task: 'virtualAutoTradeIntraday', dry_run: true })]
    render(<OperationsPage />)
    await screen.findByText('삼성전자')
    fireEvent.click(screen.getByRole('button', { name: /지금 확인/ }))
    await waitFor(() => expect(callsTo('view=job&job_id=j1')).toHaveLength(1))
    await waitFor(() => expect(pageText()).toContain('실행 중'))
    await waitFor(() => expect(callsTo('view=job&job_id=j1')).toHaveLength(2), { timeout: 4000 })
    await waitFor(() => expect(pageText()).toContain('완료'))
    const after = callsTo('view=job&job_id=j1').length
    await new Promise((r) => setTimeout(r, 2300))
    expect(callsTo('view=job&job_id=j1')).toHaveLength(after)
  }, 15000)

  it('고급 진단: 자동매도 점검 조회와 드라이런 상세 모달', async () => {
    render(<OperationsPage />)
    await screen.findByText('삼성전자')
    fireEvent.click(screen.getByRole('button', { name: /고급 진단 보기/ }))
    fireEvent.click(await screen.findByRole('button', { name: '점검 조회' }))
    await waitFor(() => expect(callsTo('view=autosellcheck')).toHaveLength(1))

    fireEvent.click(screen.getByRole('button', { name: /지금 확인/ }))
    fireEvent.click(await screen.findByRole('button', { name: '드라이런 상세 보기' }))
    expect(await screen.findByText('드라이런 상세 리포트')).toBeTruthy()
    expect(pageText()).toContain('매수 후보/제외 사유 요약')
    expect(pageText()).toContain('매수 후보 제외: 점수 미달')
    expect(pageText()).toContain('후보')
  })
})
