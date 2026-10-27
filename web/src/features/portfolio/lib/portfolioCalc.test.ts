import { describe, expect, it } from 'vitest'
import { ALLOCATION_COLORS, buildAllocationRows, buildDonutGradient } from './allocation'
import { extractSectors, filterHoldings, selectAccountRows } from './filtering'
import { rowTradeCost, summarizeHoldings } from './summary'

const row = (patch: Record<string, any>) => ({ position_type: 'holding', quantity: 10, avg_price: 1000, unrealized_pnl: 0, ...patch })

const KIWOOM = { broker_name: '키움', account_name: '일반' }
const TOSS = { broker_name: '토스', account_name: 'ISA' }

describe('selectAccountRows', () => {
  const rows = [
    row({ code: 'A', ...KIWOOM }),
    row({ code: 'B', ...TOSS }),
    row({ code: 'C', account_kind: 'virtual' }),
  ]
  it('real은 실험(가상) 계좌를 뺀 실제 계좌 전부 — 둘을 한 합계로 섞지 않는다', () => {
    expect(selectAccountRows(rows, 'real').map((r) => r.code)).toEqual(['A', 'B'])
  })
  it('virtual은 서버가 virtual로 판정한 행만', () => {
    expect(selectAccountRows(rows, 'virtual').map((r) => r.code)).toEqual(['C'])
  })
  it('계좌 키는 증권사|||계좌명으로 매칭', () => {
    expect(selectAccountRows(rows, '키움|||일반').map((r) => r.code)).toEqual(['A'])
  })
})

describe('extractSectors', () => {
  it('중복을 제거하고 이름 순으로 정렬', () => {
    const rows = [
      row({ stock: { sector: { id: 2, name: '화학' } } }),
      row({ stock: { sector: { id: 1, name: '반도체' } } }),
      row({ stock: { sector: { id: 2, name: '화학' } } }),
      row({ stock: {} }),
    ]
    expect(extractSectors(rows)).toEqual([{ id: '1', name: '반도체' }, { id: '2', name: '화학' }])
  })
})

describe('filterHoldings', () => {
  const rows = [
    row({ code: '005930', stock_name: '삼성전자', stock: { sector_id: 's1' }, ...KIWOOM }),
    row({ code: '000660', stock_name: 'SK하이닉스', stock: { sector_id: 's1' }, ...TOSS }),
    row({ code: '051910', stock_name: 'LG화학', stock: { sector_id: 's2' }, ...KIWOOM }),
  ]
  const all = { accountKey: 'real', sectorId: null, search: '', stateFilter: 'all', gradeFilter: 'all' } as const
  const state = (r: any) => (r.code === '005930' ? 'add' : 'hold') as 'hold' | 'add' | 'partial'
  const grade = (r: any) => (r.code === '000660' ? 'A' : 'C') as 'A' | 'B' | 'C'
  const codes = (c: Parameters<typeof filterHoldings>[1]) => filterHoldings(rows, c, state, grade).map((r) => r.code)

  it('조건이 없으면 전부', () => {
    expect(codes(all)).toEqual(['005930', '000660', '051910'])
  })
  it('계좌·섹터 조합', () => {
    expect(codes({ ...all, accountKey: '키움|||일반', sectorId: 's2' })).toEqual(['051910'])
  })
  it('검색은 코드·이름 대소문자 무관', () => {
    expect(codes({ ...all, search: 'sk' })).toEqual(['000660'])
    expect(codes({ ...all, search: '0059' })).toEqual(['005930'])
  })
  it('상태·등급 필터는 판정 함수를 따른다', () => {
    expect(codes({ ...all, stateFilter: 'add' })).toEqual(['005930'])
    expect(codes({ ...all, gradeFilter: 'A' })).toEqual(['000660'])
    expect(codes({ ...all, stateFilter: 'add', gradeFilter: 'A' })).toEqual([])
  })
})

describe('summarizeHoldings', () => {
  const opts = { includeCost: false, buyFeeRatePct: 0.015, sellFeeRatePct: 0.215, initialCapital: 1_000_000 }
  const rows = [
    row({ code: '005930', stock_name: '삼성전자', quantity: 10, avg_price: 70000, unrealized_pnl: 50000 }),
  ]

  it('비용을 빼지 않으면 평가손익 그대로', () => {
    const s = summarizeHoldings(rows, opts)
    expect(s.totalInvested).toBe(700000)
    expect(s.totalUnrealized).toBe(50000)
    expect(s.adjustedUnrealized).toBe(50000)
    expect(s.totalReturnPct).toBeCloseTo((50000 / 700000) * 100, 8)
    expect(s.estimatedCash).toBe(300000)
    expect(s.totalAssetValue).toBe(1_050_000)
  })
  it('비용 포함이면 매수비용+매도예상비용을 뺀다(개별주는 거래세 포함 요율)', () => {
    const s = summarizeHoldings(rows, { ...opts, includeCost: true })
    const expectedCost = 700000 * 0.00015 + 750000 * 0.00215
    expect(s.totalTradeCost).toBeCloseTo(expectedCost, 6)
    expect(s.adjustedUnrealized).toBeCloseTo(50000 - expectedCost, 6)
  })
  it('ETF는 매도 시 거래세가 없어 수수료만 든다', () => {
    const etf = row({ code: '069500', stock_name: 'KODEX 200', quantity: 10, avg_price: 70000, unrealized_pnl: 50000 })
    expect(rowTradeCost(etf, opts)).toBeCloseTo(700000 * 0.00015 + 750000 * 0.00015, 6)
  })
  it('평가금액이 0 이하이면 매도비용은 없다', () => {
    const dead = row({ code: 'X', stock_name: '폐지', quantity: 10, avg_price: 1000, unrealized_pnl: -10000 })
    expect(rowTradeCost(dead, opts)).toBeCloseTo(10000 * 0.00015, 8)
  })
  it('DB 현금이 있으면 추정(시드 − 매수 원금) 대신 그 값으로 총자산을 낸다 — 실현 손익·분배금 반영', () => {
    const s = summarizeHoldings(rows, { ...opts, cashOverride: 410_000 })
    expect(s.estimatedCash).toBe(410_000)
    expect(s.totalAssetValue).toBe(750_000 + 410_000)
    expect(summarizeHoldings(rows, { ...opts, cashOverride: null }).estimatedCash).toBe(300000)
  })
  it('행이 없으면 모두 0, 현금은 초기 자본', () => {
    const s = summarizeHoldings([], opts)
    expect(s).toMatchObject({ totalInvested: 0, totalReturnPct: 0, estimatedCash: 1_000_000, totalAssetValue: 1_000_000 })
  })
})

describe('buildAllocationRows / buildDonutGradient', () => {
  it('평가금액 큰 순 + 현금 맨 뒤, 비중 합 100', () => {
    const rows = [
      row({ code: 'A', stock_name: 'A', quantity: 1, avg_price: 100, unrealized_pnl: 0 }),
      row({ code: 'B', stock_name: 'B', quantity: 3, avg_price: 100, unrealized_pnl: 0 }),
    ]
    const out = buildAllocationRows(rows, 100)
    expect(out.map((r) => r.code)).toEqual(['B', 'A', 'CASH'])
    expect(out.reduce((a, r) => a + r.ratio, 0)).toBeCloseTo(100, 8)
    expect(out[0].ratio).toBeCloseTo(60, 8)
  })
  it('같은 종목은 계좌가 달라도 한 줄로 합친다', () => {
    const out = buildAllocationRows([
      row({ code: 'A', stock_name: 'A', quantity: 1, avg_price: 100, ...KIWOOM }),
      row({ code: 'A', stock_name: 'A', quantity: 2, avg_price: 100, ...TOSS }),
      row({ code: 'B', stock_name: 'B', quantity: 2, avg_price: 100 }),
    ], 0)
    expect(out.map((r) => [r.code, r.value])).toEqual([['A', 300], ['B', 200]])
  })
  it('보유 주수를 종목별로 싣고, 여러 계좌에 나뉜 종목은 합친다. 현금·그 외 줄에는 주수가 없다', () => {
    const out = buildAllocationRows([
      row({ code: 'A', stock_name: 'A', quantity: 1, avg_price: 100, ...KIWOOM }),
      row({ code: 'A', stock_name: 'A', quantity: 2, avg_price: 100, ...TOSS }),
    ], 50)
    expect(out.map((r) => [r.code, r.quantity])).toEqual([['A', 3], ['CASH', undefined]])
    const many = Array.from({ length: 20 }, (_, i) => row({ code: `C${i}`, stock_name: `C${i}`, quantity: i + 1, avg_price: 1000 - i }))
    const other = buildAllocationRows(many, 0).find((r) => r.code === 'OTHER')
    expect(other?.quantity).toBeUndefined()
    expect(other?.rest?.[0].quantity).toBe(8)
  })
  it('상위 12종목 밖은 그 외 한 줄로, 한 종목만 남으면 묶지 않는다', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => row({ code: `C${i}`, stock_name: `C${i}`, quantity: 1, avg_price: 1000 - i }))
    const out = buildAllocationRows(many(20), 0)
    expect(out).toHaveLength(13)
    expect(out[12]).toMatchObject({ code: 'OTHER', name: '그 외 8종목' })
    expect(out[12].rest?.map((r) => r.code)).toEqual(['C12', 'C13', 'C14', 'C15', 'C16', 'C17', 'C18', 'C19'])
    expect(out.reduce((a, r) => a + r.ratio, 0)).toBeCloseTo(100, 8)
    expect(buildAllocationRows(many(13), 0).map((r) => r.code)).not.toContain('OTHER')
  })
  it('현금이 0 이하이면 현금 항목을 넣지 않는다', () => {
    const out = buildAllocationRows([row({ code: 'A', stock_name: 'A' })], -500)
    expect(out.map((r) => r.code)).toEqual(['A'])
  })
  it('평가금액 0 이하 종목은 제외, 전부 비면 빈 배열', () => {
    expect(buildAllocationRows([row({ quantity: 0 }), row({ unrealized_pnl: -999999 })], 0)).toEqual([])
  })
  it('도넛은 마지막 구간을 360도로 닫는다', () => {
    const g = buildDonutGradient([
      { code: 'A', name: 'A', value: 1, ratio: 50 },
      { code: 'B', name: 'B', value: 1, ratio: 50 },
    ])
    expect(g).toBe(`conic-gradient(${ALLOCATION_COLORS[0]} 0.00deg 180.00deg, ${ALLOCATION_COLORS[1]} 180.00deg 360.00deg)`)
  })
  it('비어 있으면 회색 단색', () => {
    expect(buildDonutGradient([])).toBe('conic-gradient(#e5e7eb 0deg 360deg)')
  })
})
