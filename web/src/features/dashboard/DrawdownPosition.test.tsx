import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import DrawdownPosition from './DrawdownPosition'
import { KOSPI_HISTORY } from '../../lib/accumulate'
import { drawdownEpisodes } from '../../lib/drawdownEpisodes'

describe('DrawdownPosition', () => {
  it('회복한 과거 구간 수를 문장과 그림 이름에 같게, 선택 편향 비교(더 내려간 횟수)는 넣지 않는다', () => {
    const past = drawdownEpisodes(KOSPI_HISTORY.monthly, -15).filter((e) => e.recoverYm != null)
    render(<DrawdownPosition fromHighPct={-20} />)
    expect(screen.getByRole('img', { name: new RegExp(`과거 큰 하락 ${past.length}번과 지금 고점 대비 -20.0%`) })).toBeTruthy()
    expect(screen.getByText(new RegExp(`−15% 넘게 빠진 적은 ${past.length}번`))).toBeTruthy()
    expect(screen.queryByText(/지금보다 더 내려갔/)).toBeNull()
  })
  it('고점 위(+)면 0%로 본다', () => {
    render(<DrawdownPosition fromHighPct={2} />)
    expect(screen.getByText(/지금 고점 대비 0.0%/)).toBeTruthy()
  })
})
