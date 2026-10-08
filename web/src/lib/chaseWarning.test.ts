import { describe, expect, it } from 'vitest'
import { chaseWarning } from './chaseWarning'

describe('chaseWarning', () => {
  it('등락률이 없거나 5% 미만이면 경고하지 않는다', () => {
    expect(chaseWarning(null)).toBeNull()
    expect(chaseWarning(undefined)).toBeNull()
    expect(chaseWarning(Number.NaN)).toBeNull()
    expect(chaseWarning(4.99)).toBeNull()
    expect(chaseWarning(-9)).toBeNull()
  })

  it('5% 이상은 약한 경고, 8% 이상은 강한 경고', () => {
    expect(chaseWarning(5)?.level).toBe('mild')
    expect(chaseWarning(7.99)?.level).toBe('mild')
    expect(chaseWarning(8)?.level).toBe('strong')
    expect(chaseWarning(8.9)?.title).toContain('+8.9%')
  })

  it('15% 이상은 더 나빴던 수치를 보여 준다', () => {
    expect(chaseWarning(20)?.detail).toContain('6.2%')
    expect(chaseWarning(10)?.detail).toContain('4.4%')
  })
})
