import { describe, expect, it } from 'vitest'
import { ACCUMULATE_ASOF, INDEX_ETF_CANDIDATES, OVERSEAS_ETF_CANDIDATES } from '../data/accumulateData'
import { mergeLiveCandidates } from '../lib/indexEtfCandidates'
import { recommendCandidate } from '../lib/accumulate'
import { adviceFor } from '../lib/maturity'

const full = (patch: (code: string) => Partial<{ feePct: number | null; marketCapEok: number | null; tradingValueMil: number | null }> = () => ({})) =>
  [...INDEX_ETF_CANDIDATES, ...OVERSEAS_ETF_CANDIDATES].map((c) => ({ code: c.code, feePct: c.feePct, marketCapEok: c.marketCapEok, tradingValueMil: c.tradingValueMil, ...patch(c.code) }))

describe('mergeLiveCandidates', () => {
  it('서버 값이 없으면 고정 스냅샷과 그 기준일', () => {
    const v = mergeLiveCandidates(INDEX_ETF_CANDIDATES, null)
    expect(v).toEqual({ cands: INDEX_ETF_CANDIDATES, overseas: OVERSEAS_ETF_CANDIDATES, asOf: ACCUMULATE_ASOF, live: false })
  })

  it('모든 후보가 세 칸을 받으면 서버 기준일로 표시하고 값으로 추천한다', () => {
    // KIWOOM 200TR 순자산이 1조 아래로 내려가면 TR 추천이 다음 상품으로 바뀐다
    const v = mergeLiveCandidates(INDEX_ETF_CANDIDATES, { asOf: '2026-10-16', items: full((code) => (code === '294400' ? { marketCapEok: 9_000 } : {})) })
    expect(v.live).toBe(true)
    expect(v.asOf).toBe('2026-10-16')
    expect(v.cands.find((c) => c.code === '294400')?.marketCapEok).toBe(9_000)
    const pick = recommendCandidate('growth', v.cands, v.asOf).pick
    expect(pick?.code).not.toBe('294400')
    // 만기 '갈 곳'도 같은 값을 쓴다
    expect(adviceFor('over5', v).where).toContain(pick!.name)
  })

  it('한 칸이라도 비면 받은 값은 쓰되 기준일은 스냅샷 그대로(새 날짜를 붙이지 않음)', () => {
    const v = mergeLiveCandidates(INDEX_ETF_CANDIDATES, { asOf: '2026-10-16', items: full((code) => (code === '069500' ? { tradingValueMil: null } : { feePct: 0.001 })) })
    expect(v.live).toBe(false)
    expect(v.asOf).toBe(ACCUMULATE_ASOF)
    expect(v.cands.find((c) => c.code === '069500')?.tradingValueMil).toBe(INDEX_ETF_CANDIDATES.find((c) => c.code === '069500')?.tradingValueMil)
    expect(v.cands.find((c) => c.code === '102110')?.feePct).toBe(0.001)
  })

  it('해외지수 후보도 같은 응답으로 덮고, 해외 후보가 빠지면 최신 표시를 하지 않는다', () => {
    const v = mergeLiveCandidates(INDEX_ETF_CANDIDATES, { asOf: '2026-10-16', items: full((code) => (code === '360750' ? { feePct: 0.002 } : {})) })
    expect(v.live).toBe(true)
    expect(v.overseas.find((c) => c.code === '360750')?.feePct).toBe(0.002)
    expect(v.cands.some((c) => c.code === '360750')).toBe(false)
    const partial = mergeLiveCandidates(INDEX_ETF_CANDIDATES, { asOf: '2026-10-16', items: full().filter((m) => m.code !== '133690') })
    expect(partial.live).toBe(false)
  })
})
