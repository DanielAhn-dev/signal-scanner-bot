import { describe, expect, it } from 'vitest'
import { MAX_ITEMS, adviceFor, daysUntil, ddayLabel, sanitizeMaturityState, sortMaturities, statusOf, summarizeUpcoming, type Maturity } from '../lib/maturity'

const base: Maturity = { id: 'a', name: '청년적금', amount: 10_000_000, date: '2026-12-01', horizon: 'over5' }

describe('maturity', () => {
  it('올바른 항목은 다듬어 돌려준다', () => {
    const s = sanitizeMaturityState({ items: [{ ...base, name: '  청년적금  ', amount: 10_000_000.4 }] })
    expect(s.items).toEqual([base])
  })

  it('잘못된 항목은 버린다', () => {
    const bad = [
      null, 'x', { ...base, id: '' }, { ...base, name: '   ' }, { ...base, amount: 0 }, { ...base, amount: -5 },
      { ...base, amount: 1e12 }, { ...base, date: '2026-02-30' }, { ...base, date: '내년' }, { ...base, horizon: 'forever' },
    ]
    expect(sanitizeMaturityState({ items: bad }).items).toEqual([])
    expect(sanitizeMaturityState(null).items).toEqual([])
    expect(sanitizeMaturityState({ items: 'x' }).items).toEqual([])
  })

  it('같은 id는 먼저 온 것만 두고 개수와 이름 길이를 제한한다', () => {
    const dup = sanitizeMaturityState({ items: [base, { ...base, name: '다른 이름' }] })
    expect(dup.items).toHaveLength(1)
    expect(dup.items[0].name).toBe('청년적금')
    const many = sanitizeMaturityState({ items: Array.from({ length: 40 }, (_, i) => ({ ...base, id: `i${i}` })) })
    expect(many.items).toHaveLength(MAX_ITEMS)
    expect(sanitizeMaturityState({ items: [{ ...base, name: 'ㄱ'.repeat(100) }] }).items[0].name).toHaveLength(30)
  })

  it('처리 표시는 true일 때만 남긴다', () => {
    expect(sanitizeMaturityState({ items: [{ ...base, done: true }] }).items[0].done).toBe(true)
    expect('done' in sanitizeMaturityState({ items: [{ ...base, done: 'yes' }] }).items[0]).toBe(false)
  })

  it('남은 일수와 표시', () => {
    expect(daysUntil('2026-10-08', '2026-10-08')).toBe(0)
    expect(daysUntil('2026-10-15', '2026-10-08')).toBe(7)
    expect(daysUntil('2026-10-01', '2026-10-08')).toBe(-7)
    expect(daysUntil('2027-01-01', '2026-12-31')).toBe(1)
    expect(ddayLabel(0)).toBe('오늘 만기')
    expect(ddayLabel(7)).toBe('D-7')
    expect(ddayLabel(-3)).toBe('3일 지남')
  })

  it('상태: 지남·곧(14일)·나중·처리함', () => {
    const t = '2026-10-08'
    expect(statusOf({ ...base, date: '2026-10-07' }, t)).toBe('overdue')
    expect(statusOf({ ...base, date: '2026-10-08' }, t)).toBe('soon')
    expect(statusOf({ ...base, date: '2026-10-22' }, t)).toBe('soon')
    expect(statusOf({ ...base, date: '2026-10-23' }, t)).toBe('later')
    expect(statusOf({ ...base, date: '2026-10-07', done: true }, t)).toBe('done')
  })

  it('정렬: 만기일 순, 처리한 것은 맨 아래', () => {
    const items: Maturity[] = [
      { ...base, id: '1', date: '2026-12-01' },
      { ...base, id: '2', date: '2026-10-01', done: true },
      { ...base, id: '3', date: '2026-11-01' },
      { ...base, id: '4', date: '2026-09-01' },
    ]
    expect(sortMaturities(items).map((i) => i.id)).toEqual(['4', '3', '1', '2'])
  })

  it('쓸 시점이 3년 안이면 지수로 보내지 않는다', () => {
    const a = adviceFor('under3')
    expect(a.where).toContain('지수에 넣지 않고')
    expect(JSON.stringify(a)).not.toContain('KODEX 200TR')
  })

  it('3~5년은 일부만, 5년 넘게는 KODEX 200TR 일시금', () => {
    expect(adviceFor('3to5').where).toContain('일부')
    expect(adviceFor('over5').where).toContain('KODEX 200TR')
    expect(adviceFor('over5').steps.join(' ')).toContain('한도')
  })

  it('요약은 처리 안 한 만기만 센다', () => {
    const items: Maturity[] = [
      { ...base, id: '1', date: '2026-12-01', amount: 5_000_000 },
      { ...base, id: '2', date: '2026-11-01', amount: 7_000_000 },
      { ...base, id: '3', date: '2026-10-01', amount: 9_000_000, done: true },
    ]
    const s = summarizeUpcoming(items)
    expect(s.count).toBe(2)
    expect(s.amount).toBe(12_000_000)
    expect(s.next?.id).toBe('2')
    expect(summarizeUpcoming([]).next).toBeNull()
  })
})
