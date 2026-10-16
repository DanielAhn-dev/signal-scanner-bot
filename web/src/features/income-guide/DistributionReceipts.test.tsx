import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import DistributionReceipts, { type DistributionReceiptsData } from './DistributionReceipts'

const data: DistributionReceiptsData = {
  thisMonth: {
    month: '2026-10',
    items: [{ id: 'a', month: '2026-10', code: '498400', name: 'KODEX 200타겟위클리커버드콜', quantity: 600, perShare: 160, net: 91_200, createdAt: '' }],
    gross: 96_000,
    net: 91_200,
    estimatedCount: 0,
  },
  lastMonth: { month: '2026-09', items: [], gross: 0, net: 0, estimatedCount: 0 },
  projection: {
    total: 120_000,
    fromReceipts: 109_440,
    fromEstimate: 10_560,
    receiptCodes: 1,
    rows: [
      { code: '498400', name: 'KODEX 200타겟위클리커버드콜', quantity: 720, net: 109_440, source: 'receipt', perShare: 160, netRatio: 0.95, intervalMonths: 1, addedShares: 120 },
      { code: '0105E0', name: 'SOL 코리아고배당', quantity: 700, net: 10_560, source: 'estimate', perShare: null, netRatio: null, intervalMonths: null, addedShares: 0 },
    ],
  },
  recent: [{ id: 'a', month: '2026-10', code: '498400', name: 'KODEX 200타겟위클리커버드콜', quantity: 600, perShare: 160, net: 91_200, createdAt: '' }],
}
const holdings = [
  { code: '498400', name: 'KODEX 200타겟위클리커버드콜', quantity: 720 },
  { code: '0105E0', name: 'SOL 코리아고배당', quantity: 700 },
]

describe('DistributionReceipts', () => {
  it('이번 달 합계·다음 달 예상·늘어난 수량 효과를 보여 준다', () => {
    render(<DistributionReceipts data={data} holdings={holdings} buyName="KODEX 200TR" submit={async () => null} />)
    expect(screen.getAllByText('91,200원', { selector: 'strong' }).length).toBeGreaterThan(0)
    expect(screen.getByText(/120주 늘어남/)).toBeTruthy()
    expect(screen.getByText(/아직 안 적은 종목 1개/)).toBeTruthy()
    expect(screen.getByText('KODEX 200TR')).toBeTruthy()
  })

  it('종목을 고르면 지금 수량이 기본값으로 들어가고, 서버 오류는 그 자리에 보인다', async () => {
    const submit = vi.fn(async () => '주당 분배금(원)을 적어 주세요.')
    render(<DistributionReceipts data={data} holdings={holdings} buyName={null} submit={submit} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '0105E0' } })
    expect((screen.getByPlaceholderText('주') as HTMLInputElement).value).toBe('700')
    fireEvent.click(screen.getByText('적기'))
    await waitFor(() => expect(screen.getByText('주당 분배금(원)을 적어 주세요.')).toBeTruthy())
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ action: 'receipt-add', receipt: expect.objectContaining({ code: '0105E0', quantity: '700' }) }))
  })
})
