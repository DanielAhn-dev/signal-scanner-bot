import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import ChildGiftPage from './index'

describe('자녀 계좌 화면', () => {
  it('자녀가 없으면 추가 폼과 단순하게 가져가는 안내, 세무 면책을 보여준다', () => {
    render(<ChildGiftPage />)
    expect(screen.getByText('자녀 추가하기')).toBeTruthy()
    expect(screen.getByText('단순하게 가져가려면')).toBeTruthy()
    expect(screen.getByText(/세무사나 국세청/)).toBeTruthy()
  })

  it('종목 이름 확인 — 커버드콜은 피하라고, 일반 지수 ETF는 가능하다고 안내한다', () => {
    render(<ChildGiftPage />)
    const input = screen.getByPlaceholderText('예: TIGER 200커버드콜ATM')
    fireEvent.change(input, { target: { value: 'TIGER 200커버드콜ATM' } })
    expect(screen.getByText(/피하세요/)).toBeTruthy()
    fireEvent.change(input, { target: { value: 'KODEX 200' } })
    expect(screen.getByText(/가능:/)).toBeTruthy()
  })
})
