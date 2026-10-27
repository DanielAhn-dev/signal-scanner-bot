import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import IncomeTargetCard, { DEFAULT_INCOME_GOAL } from './IncomeTargetCard'
import type { IncomeCheckRow } from '../income-guide/IncomeProductCheck'

const MAN = 10_000
// 누적 1·3·6·9·14·20·31·43 | 59(태권도 학원)·76·116·166(대성학원)
const FIXED = [['쿠팡', 1], ['인터넷', 2], ['보험1', 3], ['보험2', 3], ['통신비', 5], ['암보험', 6], ['실손', 11], ['피아노', 12], ['태권도 학원', 16], ['대출금', 17], ['용돈', 40], ['대성학원', 50]].map(([label, m]) => ({ label: label as string, amount: (m as number) * MAN }))
/** 세후 월 56만원 */
const GROSS = (56 * MAN * 12) / (1 - 0.154)

const candidate = (patch: Partial<IncomeCheckRow>): IncomeCheckRow => ({
  code: 'A', name: '후보 ETF', value: 30_000_000, sharePct: 30, familySharePct: 30, yieldPct: 9, yieldSource: 'history', payments: 14,
  historyMonths: 14, cv6: 0.1, trendPct: 0, lastVsPeakPct: 95, total3mPct: 2, verdict: 'add', reasons: [], ...patch,
})

describe('IncomeTargetCard', () => {
  it('다음 칸이 얼마 모자란지와 점검을 통과한 후보를 보여 준다', () => {
    render(<MemoryRouter><IncomeTargetCard fixed={FIXED} generalGross={GROSS} check={[candidate({})]} goal={DEFAULT_INCOME_GOAL} onGoal={() => {}} /></MemoryRouter>)
    expect(screen.getByText(/월 3만원 부족/)).toBeTruthy()
    expect(screen.getByText('후보 ETF')).toBeTruthy()
  })

  it('후보가 없으면 기다리라고 알린다', () => {
    render(<MemoryRouter><IncomeTargetCard fixed={FIXED} generalGross={GROSS} check={[candidate({ verdict: 'caution' })]} goal={DEFAULT_INCOME_GOAL} onGoal={() => {}} /></MemoryRouter>)
    expect(screen.getByText(/점검을 통과한 후보가 없습니다/)).toBeTruthy()
  })

  it('지역가입자로 바꾸면 선택이 저장 함수로 올라가고, 한도를 넘는 목표 칸에는 안내가 뜬다', () => {
    const onGoal = vi.fn()
    const { rerender } = render(<MemoryRouter><IncomeTargetCard fixed={FIXED} generalGross={GROSS} check={[]} goal={DEFAULT_INCOME_GOAL} onGoal={onGoal} /></MemoryRouter>)
    fireEvent.change(screen.getByLabelText(/건강보험/), { target: { value: 'regional' } })
    expect(onGoal).toHaveBeenCalledWith({ ...DEFAULT_INCOME_GOAL, taxProfile: 'regional' })
    // 지역가입자 선(연 1,000만원)의 여유 선에서 세후 월 약 63만원 — 누적 166만원인 대성학원은 닿지 않는다
    rerender(<MemoryRouter><IncomeTargetCard fixed={FIXED} generalGross={GROSS} check={[]} goal={{ ...DEFAULT_INCOME_GOAL, taxProfile: 'regional', targetLabel: '대성학원' }} onGoal={onGoal} /></MemoryRouter>)
    expect(screen.getByText(/일반 계좌 세금 선 안에서 받을 수 있는 분배금은/)).toBeTruthy()
  })
  it('목표 칸까지 만드는 구성 3종 비교를 접어서 보여 준다', () => {
    render(<MemoryRouter><IncomeTargetCard fixed={FIXED} generalGross={GROSS} generalCapital={80_000_000} monthlyDeposit={1_000_000} check={[]} goal={{ ...DEFAULT_INCOME_GOAL, targetLabel: '대성학원' }} onGoal={() => {}} /></MemoryRouter>)
    fireEvent.click(screen.getByText(/대성학원까지 만드는 구성 비교/))
    expect(screen.getByText('인컴 집중')).toBeTruthy()
    expect(screen.getByText('성장 중심')).toBeTruthy()
    expect(screen.getAllByText(/일반 계좌 세금 선을 연/).length).toBe(3)
  })

  it('나이와 목표 월을 적으면 기한 안에 필요한 월 적립과 지금 적립으로 닿는 칸을 보여 준다', () => {
    const goal = { ...DEFAULT_INCOME_GOAL, targetLabel: '대성학원', age: 45, targetAge: 55 }
    render(<MemoryRouter><IncomeTargetCard fixed={FIXED} generalGross={GROSS} generalCapital={80_000_000} monthlyDeposit={1_000_000} check={[candidate({ verdict: 'caution', name: '주의 ETF' })]} goal={goal} onGoal={() => {}} /></MemoryRouter>)
    fireEvent.click(screen.getByText(/목표에 모자랄 때/))
    expect(screen.getByText(/기한\(45세→55세, 10년\) 안에 닿으려면/)).toBeTruthy()
    expect(screen.getByText(/적립 늘리기/)).toBeTruthy()
    expect(screen.getByText(/주의 주의 ETF/)).toBeTruthy()
  })

  it('목표 월 금액을 입력창에서 나갈 때 한 번만 저장한다', () => {
    const onGoal = vi.fn()
    render(<MemoryRouter><IncomeTargetCard fixed={FIXED} generalGross={GROSS} check={[]} goal={DEFAULT_INCOME_GOAL} onGoal={onGoal} /></MemoryRouter>)
    const input = screen.getByLabelText(/목표 월\(세후\)/)
    fireEvent.change(input, { target: { value: '150' } })
    expect(onGoal).not.toHaveBeenCalled()
    fireEvent.blur(input)
    expect(onGoal).toHaveBeenCalledWith({ ...DEFAULT_INCOME_GOAL, targetMonthly: 150 })
  })
})
