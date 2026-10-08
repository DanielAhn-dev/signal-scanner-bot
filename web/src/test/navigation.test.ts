import { describe, expect, it } from 'vitest'
import { ALL_NAV_ITEMS, SHEET_NAV_KEYS, USER_NAV_KEYS, menuSectionsFor } from '../navigation'

const ribbonKeys = (isAdmin: boolean) => menuSectionsFor(isAdmin).flatMap((s) => s.groups.flatMap((g) => g.items.map((i) => i.key)))

describe('일반 사용자 메뉴', () => {
  it('시트 탭 화면은 리본에 다시 나오지 않는다', () => {
    const ribbon = ribbonKeys(false)
    for (const key of SHEET_NAV_KEYS) expect(ribbon).not.toContain(key)
  })

  it('사용자 화면은 시트나 리본 중 정확히 한 곳에만 있다', () => {
    const places = [...SHEET_NAV_KEYS, ...ribbonKeys(false)]
    for (const key of USER_NAV_KEYS) expect(places.filter((k) => k === key), key).toHaveLength(1)
  })

  it('사용자에게 없는 화면은 어디에도 나오지 않는다', () => {
    for (const key of ribbonKeys(false)) expect(USER_NAV_KEYS).toContain(key)
    for (const key of SHEET_NAV_KEYS) expect(USER_NAV_KEYS).toContain(key)
  })

  it('빈 탭이 없고 종목 선별 번호 흐름은 보이지 않는다', () => {
    const sections = menuSectionsFor(false)
    for (const s of sections) expect(s.groups.length, s.key).toBeGreaterThan(0)
    expect(sections.map((s) => s.key)).not.toContain('research')
    expect(sections.map((s) => s.key)).not.toContain('learn')
  })
})

describe('관리자 메뉴', () => {
  it('모든 화면에 리본으로 닿을 수 있다 (시장·포트폴리오는 종목 연구 흐름에도 있어 원래 두 번 나온다)', () => {
    const ribbon = ribbonKeys(true)
    for (const item of ALL_NAV_ITEMS) {
      if (item.key === 'control') continue
      expect(ribbon, item.key).toContain(item.key)
    }
  })
})
