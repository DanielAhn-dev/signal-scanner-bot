import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const apiFetch = vi.fn()
vi.mock('../../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }))

import DistributionInbox from './DistributionInbox'

const krw = (v: number) => `${v.toLocaleString('ko-KR')}원`
const guide = (net: number) => ({
  data: {
    plan: { buyTarget: { name: 'KODEX 200TR' } },
    distributionReceipts: { thisMonth: { month: '2026-10', net, estimatedCount: 0, items: [{}, {}] } },
  },
})

describe('DistributionInbox', () => {
  beforeEach(() => apiFetch.mockReset())

  it('받은 금액과 이미 넣은 금액의 차이만 넣는다', async () => {
    apiFetch.mockResolvedValue(guide(281_246))
    const onApply = vi.fn(async () => true)
    render(<DistributionInbox month="2026-10" invested={200_000} onApply={onApply} krw={krw} />)
    await waitFor(() => expect(screen.getByText('이번 달 받은 분배금 281,246원')).toBeTruthy())
    expect(screen.getByText('KODEX 200TR')).toBeTruthy()
    fireEvent.click(screen.getByText('81,246원 투자금에 넣기'))
    await waitFor(() => expect(onApply).toHaveBeenCalledWith(81_246))
  })

  it('다 넣었으면 되돌리기, 받은 기록이 없으면 보이지 않는다', async () => {
    apiFetch.mockResolvedValue(guide(281_246))
    const onApply = vi.fn(async () => true)
    const { unmount } = render(<DistributionInbox month="2026-10" invested={281_246} onApply={onApply} krw={krw} />)
    await waitFor(() => expect(screen.getByText('281,246원 넣음')).toBeTruthy())
    fireEvent.click(screen.getByText('되돌리기'))
    await waitFor(() => expect(onApply).toHaveBeenCalledWith(-281_246))
    unmount()
    apiFetch.mockResolvedValue(guide(0))
    const { container } = render(<DistributionInbox month="2026-10" invested={0} onApply={onApply} krw={krw} />)
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2))
    expect(container.textContent).toBe('')
  })
})
