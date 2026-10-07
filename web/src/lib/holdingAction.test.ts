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
    expect(over.verdict).toBe('보유 · 새 돈 멈춤')
    expect(over.todo).toContain('46%')
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

describe('종목별 숫자로 말하기', () => {
  const plus = { code: '161510', name: 'PLUS 고배당주', bucket: 'dividend' as const, weightPct: 30, etf: { yieldTtm: 4.34, fee: 0.23, return1y: 30.3, benchmarkReturn1y: 45 } }
  const sol = { code: '0105E0', name: 'SOL 코리아고배당', bucket: 'dividend' as const, weightPct: 40, etf: { yieldTtm: 5.51, fee: 0.15, return1y: 34, benchmarkReturn1y: 45 } }
  const cc = { code: '290080', name: 'RISE 200고배당커버드콜ATM', bucket: 'covered_call' as const, weightPct: 30, etf: { yieldTtm: 10.9, fee: 0.3, return1y: 12, benchmarkReturn1y: 45 } }
  const peers = [plus, sol, cc]

  it('같은 한국 고배당 두 개면 새 돈은 이력이 검증된 쪽 한 곳으로 — 이유에 보수 차이와 상장 시점', () => {
    const p = resolveHoldingAction({ ...base, code: plus.code, name: plus.name, etf: plus.etf, incomePeers: peers, coveredCallShareOfIncomePct: 30 })
    const s = resolveHoldingAction({ ...base, code: sol.code, name: sol.name, etf: sol.etf, incomePeers: peers, coveredCallShareOfIncomePct: 30 })
    expect(p.verdict).toBe('새 돈은 여기로')
    expect(s.verdict).toBe('보유 · 새 돈은 다른 곳')
    expect(s.todo).toContain('PLUS 고배당주')
    expect(s.todo).toContain('0.08%p')
    expect(p.todo).not.toBe(s.todo)
  })
  it('배당 카드 근거에 분배율·분배금 증감·줄어든 해·출처가 종목마다 다르게', () => {
    const p = resolveHoldingAction({ ...base, code: plus.code, name: plus.name, etf: plus.etf, incomePeers: peers })
    expect(p.facts.join(' / ')).toContain('분배율 연 4.3%')
    expect(p.facts.join(' / ')).toMatch(/줄어든 해 \d+번/)
    expect(p.source).toContain('네이버')
    const s = resolveHoldingAction({ ...base, code: sol.code, name: sol.name, etf: sol.etf, incomePeers: peers })
    expect(s.facts.join(' / ')).toContain('분배율 연 5.5%')
    expect(s.facts.join(' / ')).toContain('이력이 아직 없어요')
  })
  it('커버드콜은 같은 계좌 배당 ETF와 분배율·1년 수익을 비교하고 가격 잠식을 숫자로', () => {
    const a = resolveHoldingAction({ ...base, code: cc.code, name: cc.name, etf: cc.etf, incomePeers: peers, coveredCallShareOfIncomePct: 30 })
    expect(a.facts.join(' / ')).toContain('PLUS 고배당주(4.3%)의 2.5배')
    expect(a.todo).toMatch(/가격이 -\d+%/)
  })
  it('커버드콜이 1/3을 넘으면 살 종목·목표 비중·필요한 새 돈을 원 단위로', () => {
    const ps = [{ ...plus, value: 3_000_000 }, { ...sol, value: 2_000_000 }, { ...cc, value: 5_000_000 }]
    const a = resolveHoldingAction({ ...base, code: cc.code, name: cc.name, etf: cc.etf, incomePeers: ps, coveredCallShareOfIncomePct: 50 })
    expect(a.verdict).toBe('보유 · 새 돈 멈춤')
    // 3C − I = 15,000,000 − 10,000,000
    expect(a.todo).toContain('5,000,000원')
    expect(a.todo).toContain('50% → 33%')
    expect(a.todo).toContain('PLUS 고배당주')
    const d = resolveHoldingAction({ ...base, code: plus.code, name: plus.name, etf: plus.etf, incomePeers: ps, coveredCallShareOfIncomePct: 50 })
    expect(d.todo).toContain('5,000,000원')
  })
  it('계좌에 배당 ETF가 없으면 분배 이력이 검증된 한국 배당 ETF를 이름으로 제시', () => {
    const a = resolveHoldingAction({ ...base, code: cc.code, name: cc.name, etf: cc.etf, incomePeers: [{ ...cc, value: 1_000_000 }], coveredCallShareOfIncomePct: 100 })
    expect(a.todo).toMatch(/\(\d{6}\)/)
    expect(a.todo).toContain('줄어든 해')
  })
  it('주당 분배금이 20% 넘게 줄면 새 돈 멈춤', () => {
    const a = resolveHoldingAction({ ...base, code: '999999', name: 'KODEX 테스트고배당', history: { name: 'KODEX 테스트고배당', first: '2015-01', asOf: '2026-10-01', divTtm: 600, divPrev: 1000, divChgPct: -40 } })
    expect(a.verdict).toBe('새 돈 멈춤')
    expect(a.todo).toContain('-40%')
  })
  it('코스피200 ETF 보수가 비싸면 새 돈은 저보수로', () => {
    const a = resolveHoldingAction({ ...base, code: '069500', name: 'KODEX 200', etf: { yieldTtm: 1.5, fee: 0.15, return1y: 45 } })
    expect(a.verdict).toBe('보유 · 새 돈은 저보수로')
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
    expect(s.incomePeers('A').map((p) => p.code).sort()).toEqual(['0094M0', '458730'])
    expect(s.incomePeers('B')).toEqual([])
  })
})
