import { describe, expect, it } from 'vitest'
import {
  adultOn, allowance, approxAge, filingDeadline, giftTax, isAdultOn, pendingFilings, planGift, reliefDates, sanitizeChildState, usedInWindow,
  type Child, type Gift,
} from './childGift'
import { childEtfCheck } from './childEtf'
import { investedTotal, project } from './childProjection'

const gift = (date: string, amount: number, reported = false): Gift => ({ id: `${date}-${amount}`, date, amount, giver: 'parent', reported })
const child = (gifts: Gift[], birth = '2020-05'): Child => ({ id: 'c1', alias: '첫째', birth, gifts })

describe('성년·한도', () => {
  it('성년이 되는 날은 만 19세 생일이 있는 달의 말일(보수적)', () => {
    expect(adultOn('2020-05')).toBe('2039-05-31')
    expect(isAdultOn('2020-05', '2039-05-31')).toBe(false)
    expect(isAdultOn('2020-05', '2039-06-01')).toBe(true)
  })
  it('미성년은 2,000만원, 성년은 5,000만원', () => {
    expect(allowance(child([]), '2026-10-03').limit).toBe(20_000_000)
    expect(allowance(child([], '2000-01'), '2026-10-03').limit).toBe(50_000_000)
  })
})

describe('10년 합산', () => {
  it('10년이 지난 증여는 합산에서 빠진다(정확히 10년째 날부터)', () => {
    const gifts = [gift('2016-10-03', 10_000_000), gift('2020-01-01', 5_000_000)]
    expect(usedInWindow(gifts, '2026-10-02')).toBe(15_000_000)
    expect(usedInWindow(gifts, '2026-10-03')).toBe(5_000_000)
  })
  it('남은 한도는 0 밑으로 내려가지 않는다', () => {
    const a = allowance(child([gift('2026-01-01', 30_000_000)]), '2026-10-03')
    expect(a.used).toBe(30_000_000)
    expect(a.remaining).toBe(0)
  })
  it('다음 증여 가능일 — 가장 빠른 회복과 전부 회복, 여유 7일', () => {
    const r = reliefDates(child([gift('2024-03-10', 8_000_000), gift('2026-02-01', 12_000_000)]), '2026-10-03')!
    expect(r.first).toEqual({ on: '2034-03-10', safeOn: '2034-03-17', amount: 8_000_000 })
    expect(r.full.on).toBe('2036-02-01')
    expect(r.full.amount).toBe(20_000_000)
    expect(reliefDates(child([]), '2026-10-03')).toBeNull()
  })
})

describe('증여세 추정', () => {
  it('과세표준 구간별 누진세율', () => {
    expect(giftTax(0)).toBe(0)
    expect(giftTax(50_000_000)).toBe(5_000_000)
    expect(giftTax(100_000_000)).toBe(10_000_000)
    expect(giftTax(200_000_000)).toBe(30_000_000)
  })
  it('한도 안이면 세금 0, 넘으면 넘은 만큼에 10%에서 자진신고 3% 공제', () => {
    expect(planGift(child([]), '2026-10-03', 20_000_000)).toEqual({ withinLimit: true, overBy: 0, tax: 0 })
    const over = planGift(child([]), '2026-10-03', 30_000_000)
    expect(over.withinLimit).toBe(false)
    expect(over.overBy).toBe(10_000_000)
    expect(over.tax).toBe(Math.round(1_000_000 * 0.97))
  })
  it('이미 한도를 쓴 상태에서 더 넣으면 추가분이 그대로 과세 대상', () => {
    const c = child([gift('2026-01-01', 20_000_000)])
    expect(planGift(c, '2026-10-03', 5_000_000)).toEqual({ withinLimit: false, overBy: 5_000_000, tax: Math.round(500_000 * 0.97) })
  })
})

describe('신고 마감', () => {
  it('증여일이 속한 달의 말일부터 3개월 — 그 달의 말일', () => {
    expect(filingDeadline('2026-10-15')).toBe('2027-01-31')
    expect(filingDeadline('2026-11-30')).toBe('2027-02-28')
    expect(filingDeadline('2026-12-01')).toBe('2027-03-31')
  })
  it('신고 안 한 증여만 마감 순으로, 지났으면 overdue', () => {
    const c = child([gift('2026-01-05', 1_000_000, true), gift('2026-04-10', 1_000_000), gift('2026-09-20', 1_000_000)])
    const p = pendingFilings(c, '2026-10-03')
    expect(p.map((x) => x.gift.date)).toEqual(['2026-04-10', '2026-09-20'])
    expect(p[0].overdue).toBe(true)
    expect(p[1].overdue).toBe(false)
    expect(p[1].daysLeft).toBe(Math.round((Date.parse('2026-12-31') - Date.parse('2026-10-03')) / 86_400_000))
  })
})

describe('sanitizeChildState', () => {
  it('모양이 어긋난 값은 버리고 기본값을 채운다', () => {
    const s = sanitizeChildState({ children: [{ id: 'a', alias: '  ', birth: '2020-05', gifts: [{ date: '2026-01-01', amount: 1000 }, { date: 'x', amount: 5 }, { date: '2026-02-01', amount: -1 }] }, { id: 'b', birth: 'bad' }] })
    expect(s.children).toHaveLength(1)
    expect(s.children[0].alias).toBe('자녀')
    expect(s.children[0].gifts).toHaveLength(1)
    expect(s.children[0].gifts[0].giver).toBe('parent')
  })
  it('잘못된 입력은 빈 상태', () => {
    expect(sanitizeChildState(null).children).toEqual([])
    expect(sanitizeChildState({ children: 3 }).children).toEqual([])
  })
})

describe('approxAge', () => {
  it('생일 달이 지났는지 반영', () => {
    expect(approxAge('2020-05', '2026-10-03')).toBe(6)
    expect(approxAge('2020-12', '2026-10-03')).toBe(5)
  })
})

describe('childEtfCheck', () => {
  it('일반 지수 ETF는 허용', () => {
    expect(childEtfCheck('KODEX 200').ok).toBe(true)
    expect(childEtfCheck('TIGER 미국S&P500').ok).toBe(true)
  })
  it('레버리지·인버스·커버드콜·개별주식은 막는다', () => {
    expect(childEtfCheck('KODEX 레버리지').ok).toBe(false)
    expect(childEtfCheck('KODEX 200선물인버스2X').ok).toBe(false)
    expect(childEtfCheck('TIGER 200커버드콜ATM').ok).toBe(false)
    expect(childEtfCheck('삼성전자').ok).toBe(false)
    expect(childEtfCheck('').ok).toBe(false)
  })
})

describe('project', () => {
  it('넣은 돈 합계: 일시금 + 10년마다 추가 + 월 적립', () => {
    expect(investedTotal({ lump: 20_000_000, periodicLump: 20_000_000, monthly: 100_000, years: 20 })).toBe(20_000_000 + 20_000_000 + 24_000_000)
  })
  it('나쁜 운 ≤ 보통 ≤ 좋은 운이고, 일시금만 20년이면 적금은 거의 제자리', () => {
    const p = project({ lump: 20_000_000, periodicLump: 0, monthly: 0, years: 20 })!
    expect(p.worst).toBeLessThanOrEqual(p.p10)
    expect(p.p10).toBeLessThanOrEqual(p.median)
    expect(p.median).toBeLessThanOrEqual(p.p90)
    expect(p.savings).toBeCloseTo(20_000_000 * 1.005 ** 20, -4)
    expect(p.windows).toBeGreaterThan(600)
  })
  it('기간은 10~30년으로 맞춘다', () => {
    expect(project({ lump: 1, periodicLump: 0, monthly: 0, years: 99 })!.invested).toBe(1)
  })
})
