import { describe, expect, it } from 'vitest'
import { formatKrwCompact, formatKstDateTime } from './format'

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

  it('uses a dash for missing or invalid timestamps', () => {
    expect(formatKstDateTime(null)).toBe('—')
    expect(formatKstDateTime('not-a-date')).toBe('—')
  })
})
