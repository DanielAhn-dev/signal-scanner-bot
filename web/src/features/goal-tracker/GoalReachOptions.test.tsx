import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import GoalReachOptions from './GoalReachOptions'

const base = {
  planMonthly: 1_220_000,
  target: 1_000_000_000,
  lump: 0,
  rates: { typical: 0.07, low: 0.05, years: 15 },
  today: '2026-10-19',
  raise: null,
  saveMsg: null,
  onOpenMix: () => {},
}

describe('더 빨리 닿는 선택지', () => {
  it('지금 계획으로 언제 닿는지(보통·운 나쁨)와 가는 길, 선택지별로 몇 년 빨라지는지', () => {
    render(<GoalReachOptions {...base} onRaise={() => {}} onSavePlan={() => {}} />)
    // 연 7%: 26년, 연 5%: 31년 (lib/goalReach 테스트와 같은 값)
    expect(screen.getByText(/^약 25년 \d+개월\(2052년\)$|^약 26년\(2052년\)$/)).toBeInTheDocument()
    expect(screen.getByText(/1억원 \d+년/)).toBeInTheDocument()
    // 두 선택지 모두 지금보다 빨라진다
    expect(screen.getAllByText(/약 .+ 빨라짐/, { selector: 'p' })).toHaveLength(2)
    expect(screen.getByText(/15년 넘는 길은 과거 15년 적립 결과의 연평균\(보통 7.0%, 운 나쁨 5.0%\)/)).toBeInTheDocument()
  })

  it('늘리기로 정하면 비율을 저장하고, 더 넣기는 내 계획 금액을 바꾼다', () => {
    const onRaise = vi.fn()
    const onSavePlan = vi.fn()
    render(<GoalReachOptions {...base} onRaise={onRaise} onSavePlan={onSavePlan} />)
    fireEvent.click(screen.getByRole('radio', { name: '3%' }))
    fireEvent.click(screen.getByRole('button', { name: '매년 3%씩 늘리기로 정하기' }))
    expect(onRaise).toHaveBeenCalledWith({ pct: 0.03, since: '2026-10' })
    fireEvent.click(screen.getByRole('radio', { name: '+50만' }))
    fireEvent.click(screen.getByRole('button', { name: /내 계획을 매달 172만원으로 바꾸기/ }))
    expect(onSavePlan).toHaveBeenCalledWith(1_720_000)
  })

  it('이미 정했으면 정한 비율과 그만두기', () => {
    const onRaise = vi.fn()
    render(<GoalReachOptions {...base} raise={{ pct: 0.05, since: '2026-10' }} onRaise={onRaise} onSavePlan={() => {}} />)
    expect(screen.getByText(/매년 5%씩 늘리기로 정했어요/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '그만두기' }))
    expect(onRaise).toHaveBeenCalledWith(null)
  })
})
