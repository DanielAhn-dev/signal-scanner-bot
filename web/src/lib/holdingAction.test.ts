import { describe, expect, it } from 'vitest'
import { resolveHoldingAction, summarizeAccounts } from './holdingAction'

const base = { pnlPct: 0, accountWeightPct: 5, isBotAccount: false }

describe('resolveHoldingAction', () => {
  it('봇 계좌는 직접 할 일이 없다', () => {
    const a = resolveHoldingAction({ ...base, code: '005930', name: '삼성전자', isBotAccount: true })
    expect(a.verdict).toBe('봇이 관리')
  })
  it('지수 ETF는 손실 중에도 계속 보유', () => {
    const a = resolveHoldingAction({ ...base, code: '069500', name: 'KODEX 200', pnlPct: -8 })
    expect(a.tone).toBe('keep')
    expect(a.now).toContain('-8.0%')
  })
  it('배당 ETF는 인컴 배당으로 보고 보유', () => {
    const a = resolveHoldingAction({ ...base, code: '458730', name: 'TIGER 미국배당다우존스', pnlPct: -4.99 })
    expect(a.role).toBe('인컴 (배당)')
    expect(a.verdict).toBe('계속 보유')
  })
  it('커버드콜이 인컴의 1/3을 넘으면 새 돈만 배당으로', () => {
    const over = resolveHoldingAction({ ...base, code: '0094M0', name: 'RISE 코리아밸류업위클리고정커버드콜', coveredCallShareOfIncomePct: 46 })
    expect(over.verdict).toBe('보유 · 추가는 배당으로')
    const under = resolveHoldingAction({ ...base, code: '0094M0', name: 'RISE 코리아밸류업위클리고정커버드콜', coveredCallShareOfIncomePct: 30 })
    expect(under.verdict).toBe('계속 보유')
  })
  it('개별주는 비중 초과 → 줄이기, 과열 → 추가 멈춤, 큰 손실 → 추가 멈춤, 그 외 보유', () => {
    expect(resolveHoldingAction({ ...base, code: '005930', name: '삼성전자', accountWeightPct: 25 }).verdict).toBe('일부 줄이기')
    expect(resolveHoldingAction({ ...base, code: '005930', name: '삼성전자', weightCaution: { level: 'caution', message: '과열' } }).verdict).toBe('추가매수 멈춤')
    expect(resolveHoldingAction({ ...base, code: '005930', name: '삼성전자', pnlPct: -20 }).verdict).toBe('추가매수 멈춤')
    expect(resolveHoldingAction({ ...base, code: '005930', name: '삼성전자' }).verdict).toBe('보유 · 추가는 지수로')
  })
  it('레버리지는 줄이기 검토', () => {
    expect(resolveHoldingAction({ ...base, code: '122630', name: 'KODEX 레버리지' }).tone).toBe('act')
  })
})

describe('summarizeAccounts', () => {
  it('계좌별 비중과 인컴 중 커버드콜 비중', () => {
    const s = summarizeAccounts([
      { accountKey: 'A', code: '0094M0', name: 'RISE 코리아밸류업위클리고정커버드콜', value: 400 },
      { accountKey: 'A', code: '458730', name: 'TIGER 미국배당다우존스', value: 600 },
      { accountKey: 'B', code: '069500', name: 'KODEX 200', value: 1000 },
    ])
    expect(s.weightPct('A', 400)).toBeCloseTo(40)
    expect(s.coveredCallShareOfIncomePct('A')).toBeCloseTo(40)
    expect(s.coveredCallShareOfIncomePct('B')).toBeNull()
  })
})
