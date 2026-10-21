import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const apiFetch = vi.fn()
vi.mock('../../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args), invalidateCache: () => {} }))

import { MemoryRouter } from 'react-router-dom'
import DistributionInbox from './DistributionInbox'

const krw = (v: number) => `${v.toLocaleString('ko-KR')}원`
const guide = (net: number, cashDeposit: unknown = null) => ({
  data: {
    plan: { buyTarget: { name: 'KODEX 200TR' } },
    accountList: [{ key: '카카오|일반', label: '카카오 / 일반' }, { key: 'NH|일반', label: 'NH / 일반' }],
    distributionReceipts: { thisMonth: { month: '2026-10', net, estimatedCount: 0, items: [{}, {}] }, cashDeposit },
  },
})

describe('DistributionInbox', () => {
  beforeEach(() => apiFetch.mockReset())

  it('받은 금액과 이미 넣은 금액의 차이만 넣는다', async () => {
    apiFetch.mockResolvedValue(guide(281_246))
    const onApply = vi.fn(async () => true)
    render(<DistributionInbox month="2026-10" invested={200_000} onApply={onApply} krw={krw} />, { wrapper: MemoryRouter })
    await waitFor(() => expect(screen.getByText('이번 달 받은 분배금 281,246원')).toBeTruthy())
    expect(screen.getByText('KODEX 200TR')).toBeTruthy()
    fireEvent.click(screen.getByText('81,246원 투자금 기록에만 넣기'))
    await waitFor(() => expect(onApply).toHaveBeenCalledWith(81_246))
    // 계좌를 안 골랐으면 예수금 요청을 보내지 않는다
    expect(apiFetch).toHaveBeenCalledTimes(1)
  })

  it('다 넣었으면 되돌리기, 받은 기록이 없으면 보이지 않는다', async () => {
    apiFetch.mockResolvedValue(guide(281_246))
    const onApply = vi.fn(async () => true)
    const { unmount } = render(<DistributionInbox month="2026-10" invested={281_246} onApply={onApply} krw={krw} />, { wrapper: MemoryRouter })
    await waitFor(() => expect(screen.getByText(/281,246원 투자금에 넣음 · 계좌 예수금은 그대로/)).toBeTruthy())
    fireEvent.click(screen.getByText('되돌리기'))
    await waitFor(() => expect(onApply).toHaveBeenCalledWith(-281_246))
    unmount()
    apiFetch.mockResolvedValue(guide(0))
    const { container } = render(<DistributionInbox month="2026-10" invested={0} onApply={onApply} krw={krw} />, { wrapper: MemoryRouter })
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2))
    expect(container.textContent).toBe('')
  })

  it('입금한 계좌를 고르면 투자금 기록과 그 계좌 예수금에 같은 금액을 더한다', async () => {
    apiFetch.mockResolvedValueOnce(guide(460_402))
    apiFetch.mockResolvedValueOnce({ ...guide(460_402, { month: '2026-10', accountKey: '카카오|일반', amount: 460_402 }), cashAdjust: { before: 216_503, after: 676_905 } })
    const onApply = vi.fn(async () => true)
    render(<DistributionInbox month="2026-10" invested={0} onApply={onApply} krw={krw} />, { wrapper: MemoryRouter })
    await waitFor(() => expect(screen.getByLabelText('입금한 계좌')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('입금한 계좌'), { target: { value: '카카오|일반' } })
    fireEvent.click(screen.getByText('460,402원 투자금에 넣고 카카오 / 일반 예수금에 더하기'))
    await waitFor(() => expect(screen.getByText(/카카오 \/ 일반 예수금 216,503원 → 676,905원/)).toBeTruthy())
    expect(onApply).toHaveBeenCalledWith(460_402)
    const body = JSON.parse((apiFetch.mock.calls[1][1] as { body: string }).body)
    expect(body).toEqual({ action: 'cash-deposit', month: '2026-10', accountKey: '카카오|일반', amount: 460_402 })
  })

  it('예수금 저장이 실패하면 투자금 기록도 되돌린다', async () => {
    apiFetch.mockResolvedValueOnce(guide(100_000))
    apiFetch.mockResolvedValueOnce({ error: '입금 저장 실패: x' })
    const onApply = vi.fn(async () => true)
    render(<DistributionInbox month="2026-10" invested={0} onApply={onApply} krw={krw} />, { wrapper: MemoryRouter })
    await waitFor(() => expect(screen.getByLabelText('입금한 계좌')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('입금한 계좌'), { target: { value: 'NH|일반' } })
    fireEvent.click(screen.getByText('100,000원 투자금에 넣고 NH / 일반 예수금에 더하기'))
    await waitFor(() => expect(onApply).toHaveBeenCalledWith(-100_000))
    expect(screen.getByText('입금 저장 실패: x')).toBeTruthy()
  })

  it('이미 투자금에만 넣었으면 계좌를 골라 예수금에 나중에 더할 수 있다', async () => {
    apiFetch.mockResolvedValueOnce(guide(460_402))
    apiFetch.mockResolvedValueOnce(guide(460_402, { month: '2026-10', accountKey: '카카오|일반', amount: 460_402 }))
    const onApply = vi.fn(async () => true)
    render(<DistributionInbox month="2026-10" invested={460_402} onApply={onApply} krw={krw} />, { wrapper: MemoryRouter })
    await waitFor(() => expect(screen.getByLabelText('입금한 계좌')).toBeTruthy())
    fireEvent.change(screen.getByLabelText('입금한 계좌'), { target: { value: '카카오|일반' } })
    fireEvent.click(screen.getByText('카카오 / 일반 예수금에 460,402원 더하기'))
    await waitFor(() => expect(screen.getByText(/카카오 \/ 일반 예수금에 460,402원 더함/)).toBeTruthy())
    expect(onApply).not.toHaveBeenCalled()
  })
})
