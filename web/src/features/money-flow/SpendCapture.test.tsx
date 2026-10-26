import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import SpendCapture from './SpendCapture'

const ocrMock = vi.fn()
vi.mock('./spendOcr', () => ({ ocrSpendCapture: (...args: unknown[]) => ocrMock(...args) }))

const pick = (name = 'a.png') => {
  const input = screen.getByLabelText('거래내역 캡처 고르기') as HTMLInputElement
  fireEvent.change(input, { target: { files: [new File(['x'], name, { type: 'image/png' })] } })
}

describe('지출 캡처 불러오기', () => {
  it('파일을 고르기 전에는 읽기 버튼이 꺼져 있다', () => {
    render(<SpendCapture today="2026-10-26" existing={[]} onRead={vi.fn()} />)
    expect((screen.getByRole('button', { name: '캡처 읽기' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('읽은 글자를 빠른 기록 줄로 바꿔 넘기고, 이미 있는 건·입금은 빼서 알린다', async () => {
    ocrMock.mockResolvedValueOnce('10월 9일\n롯데마트(캠핑) 66,890원\n다이소(이소가스) 2,000원\n환급 입금 +5,000원')
    const onRead = vi.fn()
    render(<SpendCapture today="2026-10-26" existing={[{ date: '2026-10-09', amount: 66_890 }]} onRead={onRead} />)
    pick()
    fireEvent.click(screen.getByRole('button', { name: '캡처 읽기' }))
    await waitFor(() => expect(onRead).toHaveBeenCalled())
    const [text, notice] = onRead.mock.calls[0]
    expect(text).toBe('2026-10-09 다이소(이소가스) 2,000원')
    expect(notice).toContain('1줄을 읽었습니다')
    expect(notice).toContain('이미 있는 1건')
    expect(notice).toContain('입금 1건')
  })

  it('읽은 지출이 없거나 읽기에 실패하면 빈 줄과 안내 문구를 넘긴다', async () => {
    ocrMock.mockResolvedValueOnce('아무 글자 없음')
    const onRead = vi.fn()
    render(<SpendCapture today="2026-10-26" existing={[]} onRead={onRead} />)
    pick()
    fireEvent.click(screen.getByRole('button', { name: '캡처 읽기' }))
    await waitFor(() => expect(onRead).toHaveBeenCalledTimes(1))
    expect(onRead.mock.calls[0][0]).toBe('')
    expect(onRead.mock.calls[0][1]).toContain('읽은 지출이 없습니다')

    ocrMock.mockRejectedValueOnce(new Error('데이터를 내려받지 못했습니다'))
    fireEvent.click(screen.getByRole('button', { name: '캡처 읽기' }))
    await waitFor(() => expect(onRead).toHaveBeenCalledTimes(2))
    expect(onRead.mock.calls[1][1]).toContain('캡처를 읽지 못했습니다')
  })
})
