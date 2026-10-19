import { describe, expect, it } from 'vitest'
import { drawdownEpisodes, monthsLabel } from './drawdownEpisodes'
import { KOSPI_HISTORY } from './accumulate'

describe('drawdownEpisodes', () => {
  it('고점→저점→고점 회복을 한 구간으로, 얕은 하락은 뺀다', () => {
    const s: Array<[string, number]> = [['202001', 100], ['202002', 95], ['202003', 100], ['202004', 110], ['202005', 70], ['202006', 80], ['202007', 111], ['202008', 105]]
    expect(drawdownEpisodes(s, -15)).toEqual([
      { peakYm: '202004', troughYm: '202005', recoverYm: '202007', depthPct: (70 / 110 - 1) * 100, monthsDown: 1, monthsToRecover: 3 },
    ])
  })
  it('회복 못 한 구간은 진행 중(recoverYm null)', () => {
    const e = drawdownEpisodes([['202001', 100], ['202002', 50], ['202003', 60]], -15)
    expect(e).toHaveLength(1)
    expect(e[0].recoverYm).toBeNull()
    expect(e[0].monthsToRecover).toBeNull()
  })
  it('실제 이력: 2007-10 고점(금융위기) 구간이 −40%보다 깊다', () => {
    const e = drawdownEpisodes(KOSPI_HISTORY.monthly, -15)
    const gfc = e.find((x) => x.peakYm === '200710')
    expect(gfc && gfc.depthPct).toBeLessThan(-40)
  })
  it('monthsLabel', () => {
    expect(monthsLabel(15)).toBe('1년 3개월')
    expect(monthsLabel(24)).toBe('2년')
    expect(monthsLabel(7)).toBe('7개월')
  })
})
