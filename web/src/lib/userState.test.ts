import { beforeEach, describe, expect, it, vi } from 'vitest'

const clientId = vi.hoisted(() => ({ current: 'user-a' }))
vi.mock('../stores/profileStore', () => ({
  getCurrentClientIdFromStore: () => clientId.current,
  useCurrentClientId: () => clientId.current,
}))
vi.mock('./api', () => ({ apiFetch: vi.fn().mockResolvedValue({ data: {} }) }))

import { clearUserLocalData, readUserState, userScopedKey, writeUserState } from './userState'

describe('userState', () => {
  beforeEach(() => { localStorage.clear(); sessionStorage.clear(); clientId.current = 'user-a' })

  it('계정마다 값이 분리된다', () => {
    writeUserState('tradeCost', { includeCost: false })
    clientId.current = 'user-b'
    expect(readUserState('tradeCost')).toBeNull()
    clientId.current = 'user-a'
    expect(readUserState('tradeCost')).toEqual({ includeCost: false })
  })

  it('로그인 전에는 키가 없어 저장하지 않는다', () => {
    clientId.current = ''
    expect(userScopedKey('x')).toBeNull()
    writeUserState('tradeCost', { includeCost: false })
    expect(localStorage.length).toBe(0)
  })

  it('예전 공용 키 값은 처음 읽는 사용자에게 옮기고 지운다', () => {
    localStorage.setItem('portfolio.holdingRules.v1', JSON.stringify({ gradeAThreshold: 90 }))
    expect(readUserState('holdingRules')).toEqual({ gradeAThreshold: 90 })
    expect(localStorage.getItem('portfolio.holdingRules.v1')).toBeNull()
    clientId.current = 'user-b'
    expect(readUserState('holdingRules')).toBeNull()
  })

  it('로그아웃하면 사용자 데이터가 모두 지워진다', () => {
    writeUserState('buycheck', { maxHoldings: 3 })
    localStorage.setItem('start-wizard:v1', '{"income":"5000000"}')
    localStorage.setItem(userScopedKey('start-wizard')!, '{"income":"5000000"}')
    localStorage.setItem('excel-shell:zoom:v1', '100')
    sessionStorage.setItem('execution_guide_pending_v1', '{}')
    clearUserLocalData()
    expect(readUserState('buycheck')).toBeNull()
    expect(localStorage.getItem('start-wizard:v1')).toBeNull()
    expect(localStorage.getItem(userScopedKey('start-wizard')!)).toBeNull()
    expect(sessionStorage.getItem('execution_guide_pending_v1')).toBeNull()
    expect(localStorage.getItem('excel-shell:zoom:v1')).toBe('100')
  })
})

describe('userState 서버 조회', () => {
  beforeEach(() => { localStorage.clear(); clientId.current = 'user-a' })

  it('저장 대기 중인 값은 서버 값으로 덮지 않는다', async () => {
    const { apiFetch } = await import('./api')
    const { pullUserState } = await import('./userState')
    writeUserState('tradeCost', { includeCost: false })
    vi.mocked(apiFetch).mockResolvedValueOnce({ data: { tradeCost: { value: { includeCost: true }, updatedAt: Date.now() + 10_000 } } })
    await pullUserState()
    expect(readUserState('tradeCost')).toEqual({ includeCost: false })
  })

  it('서버 값이 더 새로우면 로컬을 덮는다', async () => {
    const { apiFetch } = await import('./api')
    const { pullUserState } = await import('./userState')
    vi.mocked(apiFetch).mockResolvedValueOnce({ data: { buycheck: { value: { maxHoldings: 4 }, updatedAt: 5 } } })
    await pullUserState()
    expect(readUserState('buycheck')).toEqual({ maxHoldings: 4 })
  })
})
