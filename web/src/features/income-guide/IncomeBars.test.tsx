import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import IncomeBars, { incomeBarSeries } from './IncomeBars'

describe('incomeBarSeries', () => {
  it('첫 기록 달부터 이번 달까지, 빈 달은 none, 끝에 다음 달 예상', () => {
    const s = incomeBarSeries([{ month: '2026-08', total: 300_000 }, { month: '2026-10', total: 420_000 }], '2026-10', 450_000)
    expect(s).toEqual([
      { month: '2026-08', total: 300_000, kind: 'actual' },
      { month: '2026-09', total: null, kind: 'none' },
      { month: '2026-10', total: 420_000, kind: 'actual' },
      { month: '2026-11', total: 450_000, kind: 'projection' },
    ])
  })
  it('12월 다음은 이듬해 1월, 최근 12개월 밖 기록은 자른다', () => {
    const s = incomeBarSeries([{ month: '2025-01', total: 1 }, { month: '2026-12', total: 2 }], '2026-12', 3)
    expect(s[0].month).toBe('2026-12')
    expect(s[s.length - 1]).toEqual({ month: '2027-01', total: 3, kind: 'projection' })
  })
})

describe('IncomeBars', () => {
  it('기록이 없으면 그리지 않는다', () => {
    const { container } = render(<IncomeBars bars={[{ month: '2026-11', total: 1, kind: 'projection' }]} goal={500_000} />)
    expect(container.innerHTML).toBe('')
  })
  it('최근 3달이 모두 기록이면 평균과 목표 대비, 빈 달이 끼면 평균을 내지 않는다', () => {
    const full = incomeBarSeries([{ month: '2026-08', total: 300_000 }, { month: '2026-09', total: 400_000 }, { month: '2026-10', total: 500_000 }], '2026-10', 500_000)
    render(<IncomeBars bars={full} goal={500_000} />)
    expect(screen.getByText(/목표의 80%/)).toBeTruthy()
    const gap = incomeBarSeries([{ month: '2026-08', total: 300_000 }, { month: '2026-10', total: 500_000 }], '2026-10', 500_000)
    const { container } = render(<IncomeBars bars={gap} goal={500_000} />)
    expect(container.textContent).not.toMatch(/최근 3달 평균/)
  })
})
