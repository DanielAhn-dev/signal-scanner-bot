import { describe, expect, it } from 'vitest'
import { buildPlanVsActual, parseMonthTaskMemo } from './planVsActual'

const monthly = 1_000_000

describe('계획 vs 실제', () => {
  it('산 달은 지킴, 못 한 달은 건너뜀, 최근 달이 위', () => {
    const s = buildPlanVsActual({
      monthly,
      bot: [],
      real: [],
      tasks: {
        '2026-11': { status: 'bought', code: '294400', name: 'KIWOOM 200TR', qty: 10, price: 95_000, amount: monthly, at: 'x' },
        '2026-12': { status: 'skipped', at: 'x' },
      },
    })
    expect(s.rows.map((r) => [r.ym, r.result])).toEqual([['2026-12', 'skipped'], ['2026-11', 'kept']])
    expect(s.kept).toBe(1)
    expect(s.counted).toBe(2)
    // 가상 계좌 거래가 없으면 계획 금액 ÷ 그달 가격으로 살 수 있었던 주수
    expect(s.rows[1].plan).toEqual({ name: 'KIWOOM 200TR', qty: 10, amount: monthly, source: 'estimate' })
    expect(s.rows[1].actual).toMatchObject({ status: 'bought', name: 'KIWOOM 200TR', qty: 10 })
  })

  it("'다음 달부터 시작'은 분모에서 뺀다", () => {
    const s = buildPlanVsActual({
      monthly,
      bot: [],
      real: [],
      tasks: {
        '2026-10': { status: 'later', at: 'x' },
        '2026-11': { status: 'bought', qty: 10, price: 95_000, at: 'x' },
      },
    })
    expect(s.rows.find((r) => r.ym === '2026-10')?.result).toBe('notStarted')
    expect(s.kept).toBe(1)
    expect(s.counted).toBe(1)
  })

  it('가상 계좌가 그달 산 지수 ETF가 있으면 그 수량을 계획으로 쓴다 (종목 봇 거래는 뺀다)', () => {
    const s = buildPlanVsActual({
      monthly,
      tasks: { '2026-11': { status: 'skipped', at: 'x' } },
      real: [],
      bot: [
        { code: '069500', name: 'KODEX 200', side: 'BUY', price: 40_000, quantity: 24, tradedAt: '2026-11-03T01:00:00Z', memo: 'strategy=index-hold.v1;event=buy' },
        { code: '005930', name: '삼성전자', side: 'BUY', price: 70_000, quantity: 3, tradedAt: '2026-11-03T01:00:00Z', memo: 'strategy=core.autotrade.v1;event=buy' },
        // KST로는 12월이라 11월 계획에 들어가지 않는다
        { code: '069500', name: 'KODEX 200', side: 'BUY', price: 40_000, quantity: 5, tradedAt: '2026-11-30T16:00:00Z', memo: 'strategy=cash-sweep.v1;event=buy' },
      ],
    })
    expect(s.rows[0].plan).toEqual({ name: 'KODEX 200', qty: 24, amount: monthly, source: 'virtual' })
    expect(s.rows[0].actual).toEqual({ status: 'skipped', name: null, qty: null, price: null })
  })

  it('답이 없어도 이번 달 할 일 메모가 붙은 실계좌 매수가 있으면 산 달', () => {
    expect(parseMonthTaskMemo('month-task:2026-11')).toBe('2026-11')
    expect(parseMonthTaskMemo('follow:12')).toBeNull()
    const s = buildPlanVsActual({
      monthly,
      tasks: undefined,
      bot: [],
      real: [{ code: '294400', name: 'KIWOOM 200TR', side: 'BUY', price: 100_000, quantity: 9, tradedAt: '2026-11-02T01:00:00Z', memo: 'month-task:2026-11' }],
    })
    expect(s.rows).toHaveLength(1)
    expect(s.rows[0]).toMatchObject({ ym: '2026-11', result: 'kept', actual: { qty: 9, price: 100_000 }, plan: { qty: 10 } })
  })

  it('기록이 없으면 빈 표', () => {
    expect(buildPlanVsActual({ monthly, tasks: {}, bot: [], real: [] })).toEqual({ rows: [], kept: 0, counted: 0 })
  })
})
