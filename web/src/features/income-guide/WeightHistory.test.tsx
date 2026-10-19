import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import WeightHistory, { weightSeries } from './WeightHistory'

const h = (date: string, growth: number, cash = 10) => ({
  date,
  groups: [
    { group: 'growth' as const, actualPct: growth, targetPct: 60 },
    { group: 'cash' as const, actualPct: cash, targetPct: 10 },
  ],
})

describe('weightSeries', () => {
  it('날짜순 정렬, 같은 날은 마지막 기록, 첫 기록부터 지난 날 수', () => {
    const s = weightSeries([h('2026-09-01', 50), h('2026-08-01', 55), h('2026-09-01', 58)], 'growth')
    expect(s).toEqual([
      { day: 0, date: '2026-08-01', actual: 55, target: 60 },
      { day: 31, date: '2026-09-01', actual: 58, target: 60 },
    ])
  })
  it('그 바구니가 없는 기록은 건너뛴다', () => {
    expect(weightSeries([h('2026-08-01', 55)], 'income')).toEqual([])
  })
})

describe('WeightHistory', () => {
  it('기록이 2번 이상인 바구니만 그리고, ±10%p 밖이면 빨간 점 수를 읽어 준다', () => {
    render(<WeightHistory history={[h('2026-08-01', 45), h('2026-09-01', 55)]} />)
    expect(screen.getByRole('img', { name: /성장\(지수\) 비중 기록 2번, 목표 ±10%p 밖 1번, 지금 55%/ })).toBeTruthy()
    expect(screen.getByRole('img', { name: /현금성 비중 기록 2번, 목표 ±10%p 밖 0번/ })).toBeTruthy()
    expect(screen.queryByText(/인컴\(분배형\)/)).toBeNull()
  })
  it('기록이 1번뿐이면 아무것도 그리지 않는다(표만)', () => {
    const { container } = render(<WeightHistory history={[h('2026-08-01', 45)]} />)
    expect(container.innerHTML).toBe('')
  })
})
