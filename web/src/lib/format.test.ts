import { describe, expect, it } from 'vitest'
import { formatKrwCompact, formatKrwReadable, formatKstDateTime } from './format'

describe('formatKrwCompact', () => {
  it('uses readable Korean units and preserves direction when requested', () => {
    expect(formatKrwCompact(32_000_000_000)).toBe('320억원')
    expect(formatKrwCompact(1_250_000_000)).toBe('12.5억원')
    expect(formatKrwCompact(2_400_000)).toBe('240만원')
    expect(formatKrwCompact(99_999_999)).toBe('1억원')
    expect(formatKrwCompact(9_999)).toBe('9,999원')
    expect(formatKrwCompact(9_999.6)).toBe('1만원')
    expect(formatKrwCompact(-1_250_000_000)).toBe('-12.5억원')
    expect(formatKrwCompact(250_000_000, { showPositiveSign: true })).toBe('+2.5억원')
    expect(formatKrwCompact(null)).toBe('—')
  })
})

describe('formatKstDateTime', () => {
  it('renders ISO timestamps in Korea Standard Time regardless of host timezone', () => {
    const formatted = formatKstDateTime('2026-09-30T08:00:00.000Z')
    expect(formatted).toContain('2026')
    expect(formatted).toContain('17:00')
  })

  it('reads millisecond numbers (Date.now()) too', () => {
    expect(formatKstDateTime(Date.parse('2026-09-30T08:00:00.000Z'))).toContain('17:00')
  })

  it('uses a dash for missing or invalid timestamps', () => {
    expect(formatKstDateTime(null)).toBe('—')
    expect(formatKstDateTime('not-a-date')).toBe('—')
  })
})

describe('formatKrwReadable', () => {
  it('반올림 없이 억·만·원으로 읽어 준다', () => {
    expect(formatKrwReadable(100_000_000)).toBe('1억원')
    expect(formatKrwReadable(624_744)).toBe('62만 4,744원')
    expect(formatKrwReadable(1_220_000)).toBe('122만원')
    expect(formatKrwReadable(200_030_000)).toBe('2억 3만원')
    expect(formatKrwReadable(12_345_678_901)).toBe('123억 4,567만 8,901원')
    expect(formatKrwReadable(0)).toBe('0원')
  })
})
