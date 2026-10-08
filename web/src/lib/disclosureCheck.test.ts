import { describe, expect, it } from 'vitest'
import { disclosureLines, disclosureSourceNote } from './disclosureCheck'

const item = (category: string, date: string) => ({ category, label: category, date, reportName: 'x', rceptNo: date + '0001' })

describe('disclosureLines', () => {
  it('범주별로 묶고 위험을 먼저, 최근 날짜를 보여 준다', () => {
    const lines = disclosureLines([item('buyback', '20260901'), item('dilution', '20260301'), item('dilution', '20260501')])
    expect(lines.map((l) => l.category)).toEqual(['dilution', 'buyback'])
    expect(lines[0].count).toBe(2)
    expect(lines[0].lastDate).toBe('2026-05-01')
    expect(lines[0].evidence).toContain('30% 넘게 뒤처진')
    expect(lines[1].evidence).toContain('뚜렷한 차이가 없었어요')
  })

  it('표본이 작은 범주는 표본 적음을 붙인다', () => {
    expect(disclosureLines([item('audit', '20260101')])[0].evidence).toContain('표본 적음')
  })

  it('생성 180일이 지나면 낡음 표시', () => {
    expect(disclosureSourceNote(new Date('2026-10-09')).stale).toBe(false)
    expect(disclosureSourceNote(new Date('2027-06-01')).stale).toBe(true)
  })
})
