import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import HoldingList from './HoldingList'
import { summarizeAccounts } from '../../../lib/holdingAction'
import type { HoldingGroupMode } from '../lib/holdingGroups'
import type { AccountFolder, HoldingRow } from '../types'

const row = (patch: Partial<HoldingRow>): HoldingRow => ({
  id: Math.random(), position_type: 'holding', code: '069500', stock_name: 'KODEX 200', broker_name: 'NH', account_name: '일반',
  quantity: 10, avg_price: 40_000, stock: { close: 44_000 }, unrealized_pnl: 40_000, unrealized_pct: 10, ...patch,
})
const ROWS = [
  row({ id: 1 }),
  row({ id: 2, code: '005930', stock_name: '삼성전자', quantity: 5, avg_price: 60_000, stock: { close: 56_000 }, unrealized_pnl: -20_000 }),
  row({ id: 3, broker_name: '토스', quantity: 30, avg_price: 44_000, unrealized_pnl: 0 }),
]
const FOLDERS: AccountFolder[] = [
  { key: 'NH|||일반', brokerName: 'NH', accountName: '일반', count: 2 },
  { key: '토스|||일반', brokerName: '토스', accountName: '일반', count: 1 },
]

function renderList(mode: HoldingGroupMode, openMaintenanceModal = vi.fn()) {
  const view = render(
    <MemoryRouter>
      <HoldingList
        loading={false} error={null} rows={ROWS} allRows={ROWS}
        evaluateHoldingState={() => ({ state: 'hold', reasons: [] })} getPerformanceGrade={() => 'B'}
        accountSummary={summarizeAccounts([])} addEntryMinScore={70}
        includeCost={false} tradeCostOpts={{ buyFeeRatePct: 0, sellFeeRatePct: 0 }}
        openTradeModal={vi.fn()} openMaintenanceModal={openMaintenanceModal}
        realTotals={{ total: 0, byCode: {} }}
        sortKey="default" onSortChange={vi.fn()} total={ROWS.length}
        groupable groupMode={mode} onGroupModeChange={vi.fn()}
        accountFolders={FOLDERS} aliases={{ '토스|||일반': '토스 배당' }}
      />
    </MemoryRouter>,
  )
  return { ...view, openMaintenanceModal }
}

describe('HoldingList 묶어 보기', () => {
  it('계좌별: 계좌마다 소계·비중, 별칭 이름, 접으면 카드가 숨고, 이 계좌에 추가는 그 계좌로 연다', () => {
    const { container, openMaintenanceModal } = renderList('account')
    const groups = container.querySelectorAll('section.portfolio-group')
    expect(groups).toHaveLength(2)
    const nh = within(groups[0] as HTMLElement)
    expect(nh.getByText('NH / 일반')).toBeTruthy()
    expect(nh.getByText('2종목')).toBeTruthy()
    expect(within(groups[1] as HTMLElement).getByText('토스 배당')).toBeTruthy()
    expect(groups[0].querySelectorAll('.portfolio-position-card')).toHaveLength(2)
    fireEvent.click(nh.getByRole('button', { name: /NH \/ 일반/ }))
    expect(groups[0].querySelectorAll('.portfolio-position-card')).toHaveLength(0)
    fireEvent.click(within(groups[1] as HTMLElement).getByText('이 계좌에 추가'))
    expect(openMaintenanceModal).toHaveBeenCalledWith('holdingrestore', undefined, { accountKey: '토스|||일반' })
  })

  it('종목별: 여러 계좌의 같은 종목은 합계 한 줄(계좌별 수량), 한 계좌 종목은 카드 그대로', () => {
    const { container } = renderList('stock')
    const groups = container.querySelectorAll('section.portfolio-group')
    expect(groups).toHaveLength(1)
    const g = within(groups[0] as HTMLElement)
    expect(g.getByText('합계 40주 · 평균가 43,000원', { exact: false })).toBeTruthy()
    expect(g.getByText('NH / 일반 10주 · 토스 배당 30주')).toBeTruthy()
    expect(groups[0].querySelectorAll('.portfolio-position-card')).toHaveLength(0)
    fireEvent.click(g.getByRole('button', { name: /KODEX 200/ }))
    expect(groups[0].querySelectorAll('.portfolio-position-card')).toHaveLength(2)
    // 삼성전자(한 계좌)는 묶음 밖 카드
    expect(screen.getAllByText('삼성전자').length).toBeGreaterThan(0)
  })
})
