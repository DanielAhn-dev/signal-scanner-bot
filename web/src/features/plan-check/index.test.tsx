import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import PlanCheckPage from './index'

describe('계획 점검', () => {
  it('감내 낙폭을 −30%로 올리면 주식 비중 상한 60%, 처음엔 40%를 보여준다', () => {
    render(<PlanCheckPage />)
    fireEvent.change(screen.getByRole('slider'), { target: { value: '30' } })
    expect(screen.getByText('60%', { selector: 'dd' })).toBeTruthy()
    expect(screen.getByText('40%', { selector: 'dd' })).toBeTruthy()
  })

  it('분할 표는 분할이 더 벌어 주는 게 아니라고 말하고 월 1회 확인을 권한다', () => {
    render(<PlanCheckPage />)
    expect(screen.getByText(/나눠 넣는다고 더 벌지는 않습니다/)).toBeTruthy()
    expect(screen.getByText(/월 1회를 권합니다/)).toBeTruthy()
  })

  it('필요 월 적립 탭이 적금·보통·8/10·9/10 범위를 보여준다', () => {
    render(<PlanCheckPage />)
    fireEvent.click(screen.getByRole('tab', { name: '필요 월 적립' }))
    expect(screen.getByText('적금만(실질 연 0.5%)')).toBeTruthy()
    expect(screen.getByText('열 번 중 9번 닿으려면')).toBeTruthy()
  })

  it('은퇴 인출 탭: 1.8억에서 월 150만원 실수령은 높은 인출률 경고가 뜬다', () => {
    render(<PlanCheckPage />)
    fireEvent.click(screen.getByRole('tab', { name: '은퇴 인출' }))
    expect(screen.getByText('계좌에서 매달 꺼낼 돈')).toBeTruthy()
    expect(screen.getByText(/바닥났던 수준/)).toBeTruthy()
  })
})
