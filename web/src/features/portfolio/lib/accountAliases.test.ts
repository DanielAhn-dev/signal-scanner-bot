import { describe, expect, it } from 'vitest'
import { accountDotColor, aliasTaken, cleanAlias, displayAccountName, normalizeAliases, setAlias } from './accountAliases'

describe('accountAliases', () => {
  it('별칭이 없으면 증권사 / 계좌명, 있으면 별칭을 보인다', () => {
    expect(displayAccountName({}, 'a|||b', '토스증권', 'ISA')).toBe('토스증권 / ISA')
    expect(displayAccountName({ 'a|||b': 'ISA 적립' }, 'a|||b', '토스증권', 'ISA')).toBe('ISA 적립')
  })

  it('공백을 정리하고 20자로 자른다', () => {
    expect(cleanAlias('  연금   저축  ')).toBe('연금 저축')
    expect(cleanAlias('가'.repeat(30))).toHaveLength(20)
  })

  it('빈 이름으로 저장하면 별칭을 지운다', () => {
    const a = setAlias({}, 'k', '단타용')
    expect(a).toEqual({ k: '단타용' })
    expect(setAlias(a, 'k', '  ')).toEqual({})
    expect(a).toEqual({ k: '단타용' })
  })

  it('깨진 저장값은 버린다', () => {
    expect(normalizeAliases({ a: '좋음', b: 3, c: '', d: null })).toEqual({ a: '좋음' })
    expect(normalizeAliases(null)).toEqual({})
    expect(normalizeAliases('x')).toEqual({})
  })

  it('다른 계좌가 쓰는 이름은 중복으로 본다', () => {
    const labels = { k1: '토스증권 / ISA', k2: 'NH / 일반' }
    expect(aliasTaken({}, 'k2', 'nh / 일반', labels)).toBe(false)
    expect(aliasTaken({}, 'k2', '토스증권 / isa', labels)).toBe(true)
    expect(aliasTaken({ k1: '적립' }, 'k2', '적립', labels)).toBe(true)
  })

  it('같은 키는 같은 색이다', () => {
    expect(accountDotColor('a|||b')).toBe(accountDotColor('a|||b'))
    expect(accountDotColor('a|||b')).toMatch(/^hsl\(/)
  })
})
