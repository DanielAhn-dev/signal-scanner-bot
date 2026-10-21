import { describe, expect, it } from 'vitest'
import { buildAccountOverview, planKrIndexPct } from './accountOverview'
import type { HoldingRow } from '../types'

const row = (patch: Partial<HoldingRow>): HoldingRow => ({
  code: '069500', stock_name: 'KODEX 200', broker_name: '토스', account_name: '일반',
  quantity: 10, avg_price: 100, stock: { close: 100 }, ...patch,
})

describe('planKrIndexPct', () => {
  it('구성 중 코스피200 몫, 구성이 없으면 null', () => {
    expect(planKrIndexPct([{ index: 'kospi200', weight: 1 / 3 }, { index: 'sp500', weight: 1 / 3 }, { index: 'nasdaq100', weight: 1 / 3 }])).toBeCloseTo(33.33, 1)
    expect(planKrIndexPct(null)).toBeNull()
    expect(planKrIndexPct([])).toBeNull()
  })
})

describe('buildAccountOverview', () => {
  it('실계좌만 유형별로 합치고 가상·수량 0은 뺀다', () => {
    const o = buildAccountOverview([
      row({}),
      row({ code: '035420', stock_name: 'NAVER', quantity: 5, avg_price: 200, stock: { close: 100 } }),
      row({ account_kind: 'virtual', quantity: 999 }),
      row({ broker_name: null, account_name: null, quantity: 999 }),
      row({ quantity: 0 }),
    ])
    expect(o.total).toBe(1_000 + 500)
    expect(o.cost).toBe(1_000 + 1_000)
    expect(o.buckets.map((b) => b.bucket)).toEqual(['kr_index', 'stock'])
    expect(o.buckets[1].returnPct).toBe(-50)
  })

  it('개별주 상한 10%·줄일 선 20%를 같은 값으로 알린다', () => {
    const at = (stockValue: number) => buildAccountOverview([
      row({ quantity: 100 - stockValue }),
      row({ code: '035420', stock_name: 'NAVER', quantity: stockValue }),
    ]).buckets.find((b) => b.bucket === 'stock')!.note
    expect(at(10)).toBeNull()
    expect(at(15)).toContain('새 돈은 지수로')
    expect(at(33)).toContain('줄일 선 20%')
  })

  it('커버드콜은 인컴(배당·커버드콜·리츠) 중 1/3을 넘으면 알린다', () => {
    const o = buildAccountOverview([
      row({ code: '0167B0', stock_name: 'SOL 200타겟위클리커버드콜', quantity: 44 }),
      row({ code: '161510', stock_name: 'PLUS 고배당주', quantity: 56 }),
    ])
    expect(o.buckets.find((b) => b.bucket === 'covered_call')!.note).toContain('인컴 중 44%')
    const under = buildAccountOverview([
      row({ code: '0167B0', stock_name: 'SOL 200타겟위클리커버드콜', quantity: 30 }),
      row({ code: '161510', stock_name: 'PLUS 고배당주', quantity: 70 }),
    ])
    expect(under.buckets.find((b) => b.bucket === 'covered_call')!.note).toBeNull()
  })

  it('국내 지수는 지수 몫 중 비중이 계획과 밴드(10%p) 넘게 다를 때만 알린다', () => {
    const rows = [row({ quantity: 15 }), row({ code: '360750', stock_name: 'TIGER 미국S&P500', quantity: 85 })]
    expect(buildAccountOverview(rows, { planKrPct: 33.3 }).buckets.find((b) => b.bucket === 'kr_index')!.note).toBe('지수 중 15% — 내 계획 33%')
    expect(buildAccountOverview(rows, { planKrPct: 20 }).buckets.find((b) => b.bucket === 'kr_index')!.note).toBeNull()
    expect(buildAccountOverview(rows, { planKrPct: null }).buckets.find((b) => b.bucket === 'kr_index')!.note).toBeNull()
  })

  it('가격 없는 종목은 원가로 두고 목록에 올린다, 계좌별 가장 큰 유형을 고른다', () => {
    const o = buildAccountOverview([
      row({ broker_name: '미래에셋', account_name: '연금저축', code: '210780', stock_name: 'TIGER 코스피고배당', quantity: 3, stock: { close: null } }),
      row({ broker_name: '미래에셋', account_name: '연금저축', code: '360750', stock_name: 'TIGER 미국S&P500', quantity: 7 }),
    ])
    expect(o.missingPrice).toEqual([{ code: '210780', name: 'TIGER 코스피고배당' }])
    expect(o.total).toBe(1_000)
    expect(o.accounts[0]).toMatchObject({ label: '미래에셋 / 연금저축', topLabel: '해외 지수', topPct: 70 })
  })
})
