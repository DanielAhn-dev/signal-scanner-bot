import { describe, expect, it } from 'vitest'
import { describePushRegisterError } from './pushTokens'

describe('describePushRegisterError', () => {
  it('원인별로 알아볼 수 있는 말을 돌려준다', () => {
    expect(describePushRegisterError(new Error('Request timed out after 10000ms: /api/ui/push-token'))).toMatch(/응답이 늦/)
    expect(describePushRegisterError(new Error('Network error: Failed to fetch — /api/ui/push-token'))).toMatch(/네트워크/)
    expect(describePushRegisterError(new Error('API request failed (401) from /api/ui/push-token: {"error":"Sign-in required"}'))).toMatch(/로그인/)
    expect(describePushRegisterError(new Error('API request failed (500) from /api/ui/push-token: {"error":"duplicate key value"}'))).toBe('서버 오류 500: duplicate key value')
  })
})
