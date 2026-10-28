import { describe, expect, it } from 'vitest'
import { findPanicDays, panicNote, type PanicBar } from './panicDay'
import { PANIC_DAY_STATS } from '../data/panicDayStats'

/** 마지막 날짜가 2026-10-xx가 되도록 거래일 n개를 만든다(주말 무시). */
function bars(n: number, volume: number, tweak?: (i: number, b: PanicBar) => void): PanicBar[] {
  const out: PanicBar[] = []
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(2026, 9, 28) - (n - 1 - i) * 86400000).toISOString().slice(0, 10)
    const b = { date: d, close: 10000, volume }
    tweak?.(i, b)
    out.push(b)
  }
  return out
}

describe('findPanicDays', () => {
  it('일 −7%↓이면서 거래대금 3배↑인 날만 투매일로 본다', () => {
    const b = bars(60, 1_000_000, (i, x) => {
      if (i === 50) { x.close = 9000; x.volume = 4_000_000 } // −10%, 거래대금 3.6배
      if (i >= 51) x.close = 9000
    })
    const r = findPanicDays(b)!
    expect(r.days).toHaveLength(1)
    expect(r.days[0].changePct).toBeCloseTo(-10, 5)
    expect(r.days[0].valueMult).toBeGreaterThan(3)
  })

  it('거래대금이 안 늘었거나 하락이 −7%보다 작으면 아니다', () => {
    const quiet = bars(60, 1_000_000, (i, x) => { if (i === 50) x.close = 9000; if (i > 50) x.close = 9000 })
    expect(findPanicDays(quiet)!.days).toHaveLength(0)
    const small = bars(60, 1_000_000, (i, x) => { if (i === 50) { x.close = 9500; x.volume = 5_000_000 } if (i > 50) x.close = 9500 })
    expect(findPanicDays(small)!.days).toHaveLength(0)
  })

  it('최근 20거래일 밖의 투매일은 세지 않고, 41봉 미만이면 판단하지 않는다', () => {
    const old = bars(80, 1_000_000, (i, x) => { if (i === 30) { x.close = 9000; x.volume = 4_000_000 } if (i > 30) x.close = 9000 })
    expect(findPanicDays(old)!.days).toHaveLength(0)
    expect(findPanicDays(bars(40, 1_000_000))).toBeNull()
  })

  it('입력 순서가 뒤섞여도 날짜로 정렬해 계산한다', () => {
    const b = bars(60, 1_000_000, (i, x) => { if (i === 50) { x.close = 9000; x.volume = 4_000_000 } if (i > 50) x.close = 9000 })
    expect(findPanicDays([...b].reverse())!.days).toHaveLength(1)
  })
})

describe('panicNote', () => {
  const panic = (volume: number) => bars(60, volume, (i, x) => { if (i === 50) { x.close = 9000; x.volume = volume * 4 } if (i > 50) x.close = 9000 })

  it('상위 300급 거래대금이면 안내를 만든다', () => {
    const vol = Math.ceil((PANIC_DAY_STATS.tv20Top300 * 2) / 10000) // 20일 평균 거래대금이 기준의 약 2배
    const n = panicNote(panic(vol), new Date('2026-10-29'))!
    expect(n.headline).toContain('급락')
    expect(n.detail).toContain(`${PANIC_DAY_STATS.on}%`)
    expect(n.stale).toBe(false)
  })

  it('중형주 이하 거래대금이거나 투매일이 없으면 보여 주지 않는다', () => {
    const vol = Math.floor((PANIC_DAY_STATS.tv20Top300 * 0.3) / 10000)
    expect(panicNote(panic(vol))).toBeNull()
    expect(panicNote(bars(60, Math.ceil((PANIC_DAY_STATS.tv20Top300 * 2) / 10000)))).toBeNull()
  })

  it('생성 180일이 지나면 낡음 표시', () => {
    const vol = Math.ceil((PANIC_DAY_STATS.tv20Top300 * 2) / 10000)
    expect(panicNote(panic(vol), new Date('2027-06-01'))!.stale).toBe(true)
  })
})
