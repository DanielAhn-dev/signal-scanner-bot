import { describe, expect, it } from 'vitest'
import { buyQuantity, dueDateOf, groupMonthBuys, kstToday, monthTaskView, nextYm } from './monthTask'

describe('이번 달 할 일 상태', () => {
  const base = { depositDay: 1, amount: 1_220_000, price: 93_850 }

  it('넣는 날 전이면 예정, 당일부터 답하기 전까지 할 일', () => {
    expect(monthTaskView({ ...base, depositDay: 25, today: '2026-11-24', tasks: {} }).phase).toBe('upcoming')
    expect(monthTaskView({ ...base, depositDay: 25, today: '2026-11-25', tasks: {} }).phase).toBe('due')
    expect(monthTaskView({ ...base, today: '2026-11-01', tasks: {} }).dueDate).toBe('2026-11-01')
  })

  it('답한 달은 그 상태, 처음 답하기 전에는 첫 달', () => {
    const v = monthTaskView({ ...base, today: '2026-11-03', tasks: { '2026-11': { status: 'bought', qty: 13, at: 'x' } } })
    expect(v.phase).toBe('bought')
    expect(v.firstTime).toBe(false)
    expect(monthTaskView({ ...base, today: '2026-11-03', tasks: undefined }).firstTime).toBe(true)
    // 지난달 답이 있으면 이번 달은 첫 달이 아니다
    const next = monthTaskView({ ...base, today: '2026-12-02', tasks: { '2026-11': { status: 'later', at: 'x' } } })
    expect(next.phase).toBe('due')
    expect(next.firstTime).toBe(false)
  })

  it('넣을 돈으로 살 수 있는 주수와 남는 돈', () => {
    expect(buyQuantity(1_220_000, 93_850)).toEqual({ qty: 12, leftover: 93_800 })
    expect(buyQuantity(1_220_000, null)).toEqual({ qty: null, leftover: null })
    expect(buyQuantity(0, 93_850)).toEqual({ qty: null, leftover: null })
  })

  it('날짜 도우미', () => {
    expect(dueDateOf('2026-02', 31)).toBe('2026-02-28')
    expect(nextYm('2026-12')).toBe('2027-01')
    expect(kstToday(new Date('2026-10-31T16:00:00Z'))).toBe('2026-11-01')
  })
})

describe('이번 달 실계좌 매수 묶기', () => {
  const b = (code: string, quantity: number, price: number, tradedAt: string) => ({ code, quantity, price, tradedAt, broker: '키움', account: '일반', memo: null })
  it('종목별 수량·평균가·마지막 날짜, 고른 상품이 맨 앞', () => {
    const g = groupMonthBuys([b('069500', 3, 40_000, '2026-11-02'), b('294400', 4, 118_000, '2026-11-03'), b('294400', 6, 117_000, '2026-11-05')], '294400')
    expect(g[0]).toMatchObject({ code: '294400', qty: 10, amount: 1_174_000, lastDate: '2026-11-05', account: '키움 · 일반' })
    expect(g[0].avgPrice).toBeCloseTo(117_400)
    expect(g[1].code).toBe('069500')
  })
  it('수량·가격이 0인 행은 뺀다', () => {
    expect(groupMonthBuys([b('294400', 0, 1, '2026-11-01')], '294400')).toEqual([])
  })
})
