import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ChildGiftPage from './index'

const apiFetchMock = vi.fn()
vi.mock('../../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }))
vi.mock('../../stores/profileStore', () => ({
  useCurrentClientId: () => 'test-user',
  getCurrentClientIdFromStore: () => 'test-user',
}))

beforeEach(() => {
  window.localStorage.clear()
  apiFetchMock.mockReset()
  apiFetchMock.mockResolvedValue({ data: {} })
})

function addChild() {
  fireEvent.change(screen.getByPlaceholderText('예: 첫째'), { target: { value: '첫째' } })
  const month = document.querySelector('input[type="month"]') as HTMLInputElement
  fireEvent.change(month, { target: { value: '2020-05' } })
  fireEvent.click(screen.getByRole('button', { name: '추가' }))
}

describe('자녀 계좌 — 추가부터 기록까지', () => {
  it('자녀를 추가하면 미성년 한도 2,000만원이 남은 한도로 보인다', async () => {
    render(<ChildGiftPage />)
    addChild()
    await waitFor(() => expect(screen.getByText('지금 남은 증여 한도')).toBeTruthy())
    expect(screen.getByText(/10년 한도 \(미성년\)/)).toBeTruthy()
    expect(screen.getAllByText('2,000만원').length).toBeGreaterThan(0)
  })

  it('한도 안 증여는 세금 0, 한도를 넘기면 넘은 금액과 예상 세금을 보여준다', async () => {
    render(<ChildGiftPage />)
    addChild()
    await waitFor(() => screen.getByText('증여 기록'))
    const amount = screen.getByPlaceholderText('2000')
    fireEvent.change(amount, { target: { value: '1500' } })
    expect(screen.getByText(/한도 안이라 증여세는 0원/)).toBeTruthy()
    fireEvent.change(amount, { target: { value: '3000' } })
    expect(screen.getByText(/한도를/)).toBeTruthy()
    expect(screen.getByText(/1,000만원/)).toBeTruthy()
  })

  it('기록하면 남은 한도가 줄고, 신고 표시가 안 된 증여로 마감 안내가 뜬다', async () => {
    render(<ChildGiftPage />)
    addChild()
    await waitFor(() => screen.getByText('증여 기록'))
    fireEvent.change(screen.getByPlaceholderText('2000'), { target: { value: '500' } })
    fireEvent.click(screen.getByRole('button', { name: '기록하기' }))
    await waitFor(() => expect(screen.getByText('신고 표시가 안 된 증여')).toBeTruthy())
    expect(screen.getByText(/최근 10년 쓴 금액/)).toBeTruthy()
    expect(screen.getAllByText('500만원').length).toBeGreaterThan(0)
    fireEvent.click(screen.getByLabelText(/신고함/))
    await waitFor(() => expect(screen.queryByText('신고 표시가 안 된 증여')).toBeNull())
  })

  it('장기 시뮬레이션이 나쁜 운·보통·좋은 운 범위와 적금 비교를 보여준다', async () => {
    render(<ChildGiftPage />)
    addChild()
    await waitFor(() => screen.getByText('오래 두면 어느 정도가 될까'))
    expect(screen.getByText('운이 나쁜 10%에서도')).toBeTruthy()
    expect(screen.getByText('보통의 경우')).toBeTruthy()
    expect(screen.getByText(/같은 돈을 적금에/)).toBeTruthy()
  })
})
