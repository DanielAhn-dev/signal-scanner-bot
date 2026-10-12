import { describe, expect, it } from 'vitest'
import { DROP_DAY_FACTS } from '../data/dropDayFacts'
import { dropDayLines, pickDropBucket, type DropDayView } from './dropDay'

const view = (over: Partial<DropDayView> = {}): DropDayView => ({
  asOf: '2026-10-12',
  changePct: -1.73,
  fromHighPct: -7.03,
  downStreak: 4,
  yearCounts: { '-1.5': 40, '-2': 37, '-3': 31, '-5': 3 },
  foreign: null,
  ...over,
})

describe('pickDropBucket', () => {
  it('들어가는 가장 깊은 구간을 고른다', () => {
    expect(pickDropBucket(-1.4)).toBeNull()
    expect(pickDropBucket(-1.5)?.threshold).toBe(-1.5)
    expect(pickDropBucket(-2.6)?.threshold).toBe(-2)
    expect(pickDropBucket(-7)?.threshold).toBe(-5)
  })
})

describe('dropDayLines', () => {
  it('−1.5%보다 덜 빠진 날은 카드를 만들지 않는다', () => {
    expect(dropDayLines(view({ changePct: -1.2 }), -0.4, '2026-10-12')).toBeNull()
  })

  it('빈도·고점 대비·연속 하락·올해 횟수를 한 줄에 담는다', () => {
    const l = dropDayLines(view(), -0.4, '2026-10-12')!
    expect(l.headline).toBe(`오늘 코스피 −1.73% — 1년에 약 ${Math.round(DROP_DAY_FACTS.buckets[0].perYear)}번 있는 크기의 하락`)
    expect(l.sub).toBe('최근 고점 대비 −7.0% · 4일 연속 하락 · 올해 40번째(−1.5% 이하 기준)')
  })

  it('간밤 미국 몫과 나머지를 나눠 보여 주고, 합이 오늘 등락과 같다', () => {
    const l = dropDayLines(view(), -1, '2026-10-12')!
    const part = DROP_DAY_FACTS.us.beta * -1
    expect(l.us).toContain(`약 −${Math.abs(part).toFixed(1)}%p`)
    expect(l.us).toContain(`나머지 −${Math.abs(-1.73 - part).toFixed(1)}%p`)
  })

  it('미국 자료가 없으면 그 줄을 빼고, 지난 거래일이면 날짜로 표시한다', () => {
    const l = dropDayLines(view({ asOf: '2026-10-08', changePct: -2.62 }), null, '2026-10-11')!
    expect(l.us).toBeNull()
    expect(l.dayLabel).toBe('10월 8일')
  })

  it('외국인 위치 문구', () => {
    expect(dropDayLines(view({ foreign: { date: '2026-10-12', net: -8200, rank: 0.04 } }), 0, '2026-10-12')!.foreign)
      .toBe('외국인 8,200억원 순매도 — 최근 1년 중 가장 많이 판 쪽 4% 안')
    expect(dropDayLines(view({ foreign: { date: '2026-10-12', net: 300, rank: 0.5 } }), 0, '2026-10-12')!.foreign)
      .toBe('외국인 300억원 순매수 — 최근 1년 평소 범위')
  })

  it('과거 흐름에는 1년 뒤 마이너스였던 비율을 함께 적는다', () => {
    const l = dropDayLines(view({ changePct: -3.2 }), 0, '2026-10-12')!
    const b = DROP_DAY_FACTS.buckets.find((x) => x.threshold === -3)!
    expect(l.after).toContain(`${b.events}번 뒤`)
    expect(l.after).toContain(`마이너스였던 때가 ${100 - b.h250.upPct}%`)
  })
})
