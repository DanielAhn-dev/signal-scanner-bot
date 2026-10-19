import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import FanChart from './FanChart'
import { simulateDca } from '../../lib/accumulate'

describe('적립 그래프', () => {
  const sim = simulateDca({ monthly: 1_000_000, years: 10, months: undefined })!

  it('세로축은 넣은 돈 대비 % — 0%는 원금, 원금 아래로 빠진 구간이 보인다', () => {
    const { container } = render(<FanChart sim={sim} />)
    expect(screen.getByText('원금')).toBeInTheDocument()
    expect(container.querySelector('.acc-loss-zone')).not.toBeNull()
    // 축 글자가 % 단위 (금액이 아니다)
    const labels = [...container.querySelectorAll('.acc-axis')].map((t) => t.textContent)
    expect(labels.some((l) => /^[+-]\d+%$/.test(l ?? ''))).toBe(true)
    expect(labels.some((l) => /만원/.test(l ?? ''))).toBe(false)
  })

  it('짚은 시점의 값을 %와 금액으로 보여 준다', () => {
    const { container } = render(<FanChart sim={sim} />)
    const svg = container.querySelector('svg')!
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 260, right: 640, bottom: 260, x: 0, y: 0, toJSON: () => ({}) })
    fireEvent.pointerMove(svg, { clientX: 640 - 12, clientY: 100 })
    const tip = screen.getByRole('status')
    expect(tip).toHaveTextContent('10년 · 넣은 돈 1억 2,000만원')
    expect(tip).toHaveTextContent(/중앙값 [+-]\d+% \(/)
    fireEvent.pointerLeave(svg)
    expect(screen.queryByRole('status')).toBeNull()
  })
})
