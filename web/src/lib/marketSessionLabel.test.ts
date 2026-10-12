import { describe, expect, it } from 'vitest'
import { krxSessionLabel, usSessionLabel } from './marketSessionLabel'

describe('marketSessionLabel', () => {
  it('국장: 평일 시각에 따라 개장 전·장중·마감', () => {
    expect(krxSessionLabel(new Date('2026-10-12T08:59:00+09:00'))).toBe('국장 개장 전')
    expect(krxSessionLabel(new Date('2026-10-12T09:00:00+09:00'))).toBe('국장 장중')
    expect(krxSessionLabel(new Date('2026-10-12T15:30:00+09:00'))).toBe('국장 마감')
    expect(krxSessionLabel(new Date('2026-10-12T17:51:00+09:00'))).toBe('국장 마감')
  })

  it('국장: 주말·휴장일(한글날)은 휴장', () => {
    expect(krxSessionLabel(new Date('2026-10-10T10:00:00+09:00'))).toBe('국장 휴장')
    expect(krxSessionLabel(new Date('2026-10-09T10:00:00+09:00'))).toBe('국장 휴장')
  })

  it('미장: 뉴욕 시각 기준 정규장 시간·장외·주말', () => {
    expect(usSessionLabel(new Date('2026-10-12T10:00:00-04:00'))).toBe('미장 정규장 시간')
    expect(usSessionLabel(new Date('2026-10-12T16:00:00-04:00'))).toBe('미장 장외 시간')
    expect(usSessionLabel(new Date('2026-10-12T04:51:00-04:00'))).toBe('미장 장외 시간')
    expect(usSessionLabel(new Date('2026-10-10T10:00:00-04:00'))).toBe('미장 주말')
  })
})
