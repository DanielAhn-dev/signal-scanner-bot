import { describe, expect, it } from 'vitest'
import {
  ACTIVATION_DAYS,
  INVITE_TTL_DAYS,
  MAX_OPEN_INVITES,
  REFILL_DAYS,
  generateInviteCode,
  isInviteUsable,
  isInviteeActivated,
  nextRefillAt,
  normalizeInviteCode,
  planRefill,
} from '../src/services/invites'

const DAY = 86_400_000
const NOW = Date.parse('2026-10-10T00:00:00Z')
const ago = (days: number) => new Date(NOW - days * DAY).toISOString()
const later = (days: number) => new Date(NOW + days * DAY).toISOString()

describe('초대 코드', () => {
  it('만든 코드는 정규화해도 그대로이고 헷갈리는 글자가 없다', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateInviteCode()
      expect(code).toMatch(/^[2-9A-HJKMNP-Z]{5}-[2-9A-HJKMNP-Z]{5}$/)
      expect(normalizeInviteCode(code)).toBe(code)
    }
  })

  it('소문자·공백·하이픈 누락을 보정하고 형식이 틀리면 거절한다', () => {
    expect(normalizeInviteCode(' abcde fghjk ')).toBe('ABCDE-FGHJK')
    expect(normalizeInviteCode('abcdefghjk')).toBe('ABCDE-FGHJK')
    expect(normalizeInviteCode('ABCDE-FGHJ')).toBeNull()
    expect(normalizeInviteCode('ABCDE-FGHJ0')).toBeNull() // 0은 쓰지 않는 글자
    expect(normalizeInviteCode(null)).toBeNull()
  })
})

describe('초대권 사용 가능 여부', () => {
  it('열려 있고 만료 전일 때만 쓸 수 있다', () => {
    expect(isInviteUsable({ status: 'open', expires_at: later(3) }, NOW)).toBe(true)
    expect(isInviteUsable({ status: 'open', expires_at: ago(1) }, NOW)).toBe(false)
    expect(isInviteUsable({ status: 'used', expires_at: later(3) }, NOW)).toBe(false)
    expect(isInviteUsable({ status: 'revoked', expires_at: later(3) }, NOW)).toBe(false)
  })

  it('기본 규칙 값', () => {
    expect(INVITE_TTL_DAYS).toBe(14)
    expect(ACTIVATION_DAYS).toBe(7)
    expect(REFILL_DAYS).toBe(30)
    expect(MAX_OPEN_INVITES).toBe(2)
  })
})

describe('활동 인정(초대한 사람 보상 조건)', () => {
  it('7일이 지나고 시작 설정을 마쳐야 한다', () => {
    expect(isInviteeActivated(ago(8), true, NOW)).toBe(true)
    expect(isInviteeActivated(ago(7), true, NOW)).toBe(true)
    expect(isInviteeActivated(ago(6), true, NOW)).toBe(false) // 아직 7일 전
    expect(isInviteeActivated(ago(30), false, NOW)).toBe(false) // 설정 안 함
    expect(isInviteeActivated(null, true, NOW)).toBe(false)
  })
})

describe('초대권 보충', () => {
  it('한 번도 못 받았으면 1장', () => {
    expect(planRefill({ openCount: 0, lastIssuedAt: null, now: NOW })).toBe(1)
  })

  it('쓸 수 있는 초대권이 있으면 보충하지 않는다', () => {
    expect(planRefill({ openCount: 1, lastIssuedAt: ago(100), now: NOW })).toBe(0)
  })

  it('다 쓰거나 소멸했어도 마지막 발급 30일 전에는 보충하지 않는다', () => {
    expect(planRefill({ openCount: 0, lastIssuedAt: ago(29), now: NOW })).toBe(0)
    expect(planRefill({ openCount: 0, lastIssuedAt: ago(30), now: NOW })).toBe(1)
  })

  it('상한이면 항상 0', () => {
    expect(planRefill({ openCount: MAX_OPEN_INVITES, lastIssuedAt: null, now: NOW })).toBe(0)
  })

  it('다음 보충 예정일은 마지막 발급 + 30일', () => {
    expect(nextRefillAt(null)).toBeNull()
    expect(nextRefillAt(ago(0) )).toBe(later(30))
  })
})
