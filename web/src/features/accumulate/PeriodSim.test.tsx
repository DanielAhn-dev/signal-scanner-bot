import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import PeriodSim from './PeriodSim'

describe('기간 골라 보기 그래프', () => {
  it('세로축은 넣은 돈 대비 % — 원금선과 원금 아래 구간 (2008 금융위기 직전 시작)', () => {
    const { container } = render(<PeriodSim monthly={1_000_000} lump={0} drag={0} years={5} />)
    expect(screen.getByRole('button', { name: '2008 금융위기 직전' })).toHaveAttribute('aria-pressed', 'true')
    const labels = [...container.querySelectorAll('.acc-axis')].map((t) => t.textContent ?? '')
    expect(labels).toContain('원금')
    expect(labels.some((l) => /^[+-]\d+%$/.test(l))).toBe(true)
    expect(labels.some((l) => /만원/.test(l))).toBe(false)
    expect(container.querySelector('.acc-loss-zone')).not.toBeNull()
  })

  it('짚은 달의 넣은 돈·평가금을 보여 준다', () => {
    const { container } = render(<PeriodSim monthly={1_000_000} lump={0} drag={0} years={5} />)
    const svg = container.querySelector('svg')!
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 260, right: 640, bottom: 260, x: 0, y: 0, toJSON: () => ({}) })
    fireEvent.pointerMove(svg, { clientX: 628, clientY: 100 })
    expect(screen.getByRole('status')).toHaveTextContent(/넣은 돈 .*만원/)
    expect(screen.getByRole('status')).toHaveTextContent(/평가금 .*\([+-]\d+%\)/)
    fireEvent.pointerLeave(svg)
    expect(screen.queryByRole('status')).toBeNull()
  })
})
