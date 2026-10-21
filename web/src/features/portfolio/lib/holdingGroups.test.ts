import { describe, expect, it } from 'vitest'
import { groupByAccount, groupByStock } from './holdingGroups'
import type { AccountFolder, HoldingRow } from '../types'

const row = (patch: Partial<HoldingRow>): HoldingRow => ({
  id: Math.random(), code: '069500', stock_name: 'KODEX 200', broker_name: 'NH', account_name: '일반',
  quantity: 10, avg_price: 40_000, stock: { close: 44_000 }, unrealized_pnl: 40_000, ...patch,
})
const folders: AccountFolder[] = [
  { key: 'NH|||일반', brokerName: 'NH', accountName: '일반', count: 2 },
  { key: '토스|||일반', brokerName: '토스', accountName: '일반', count: 1 },
]
const opts = { includeCost: false, tradeCostOpts: { buyFeeRatePct: 0, sellFeeRatePct: 0 } }

describe('groupByAccount', () => {
  it('계좌 탭 순서로 묶고 소계·비중을 낸다, 탭에 없는 계좌는 뒤로', () => {
    const rows = [
      row({ broker_name: '토스' }),
      row({ broker_name: null, account_name: null }),
      row({}),
      row({ code: '005930', stock_name: '삼성전자', quantity: 5, avg_price: 60_000, stock: { close: 56_000 }, unrealized_pnl: -20_000 }),
    ]
    const g = groupByAccount(rows, folders, opts)
    expect(g.map((x) => x.key)).toEqual(['NH|||일반', '토스|||일반', '|||'])
    expect(g[0].rows).toHaveLength(2)
    expect(g[0].value).toBe(440_000 + 280_000)
    expect(g[0].pnl).toBe(20_000)
    expect(g[0].pnlPct).toBeCloseTo((20_000 / 700_000) * 100)
    expect(g[0].weightPct + g[1].weightPct + g[2].weightPct).toBeCloseTo(100)
  })
})

describe('groupByStock', () => {
  it('같은 종목을 여러 계좌에서 합치고 평단은 수량 가중', () => {
    const rows = [
      row({ quantity: 10, avg_price: 40_000 }),
      row({ code: '005930', stock_name: '삼성전자' }),
      row({ broker_name: '토스', quantity: 30, avg_price: 44_000, unrealized_pnl: 0 }),
    ]
    const g = groupByStock(rows, opts)
    expect(g.map((x) => x.code)).toEqual(['069500', '005930'])
    expect(g[0].quantity).toBe(40)
    expect(g[0].avgPrice).toBe((400_000 + 1_320_000) / 40)
    expect(g[0].rows).toHaveLength(2)
    expect(g[0].value).toBe(40 * 44_000)
  })
})
