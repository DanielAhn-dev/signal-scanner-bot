import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import SplitPlanCard from './SplitPlanCard'

describe('SplitPlanCard', () => {
  it('기본은 1,000만원 절반 먼저 — 500·250·250만원 날짜표를 보여준다', () => {
    render(<SplitPlanCard />)
    const table = screen.getByRole('table', { name: '매수 날짜표' })
    expect(table.textContent).toContain('1회')
    expect(table.textContent).toContain('3회')
    expect(screen.getByRole('radio', { name: '절반 먼저' }).getAttribute('aria-checked')).toBe('true')
  })

  it('균등 6회를 고르면 6회 날짜표가 되고, 금액이 비면 안내한다', () => {
    render(<SplitPlanCard />)
    fireEvent.click(screen.getByRole('radio', { name: '균등 6회' }))
    expect(screen.getByRole('table', { name: '매수 날짜표' }).textContent).toContain('6회')
    fireEvent.change(screen.getByLabelText('넣을 돈(만원)'), { target: { value: '0' } })
    expect(screen.getByText('금액을 입력하세요.')).toBeTruthy()
  })
})
