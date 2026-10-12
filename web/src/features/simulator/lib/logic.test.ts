import { describe, expect, it } from 'vitest'
import { empiricalWinProb } from '../../../lib/tpSlBaseRates'
import { defaultPlanItem, type HighlightPlanItem } from '../planStore'
import { SCENARIOS } from '../constants'
import { mergeAlgoCandidates } from './algoCandidates'
import { buildWatchlistCandidates } from './watchlistCandidates'
import { countTradeable, getCandidatesBySource, recommendWithStyleFallback } from './recommend'
import { calcItemMeta, calcScenarioRows, calcSummary } from './summary'

const item = (code: string, o: Partial<HighlightPlanItem> = {}): HighlightPlanItem => ({ ...defaultPlanItem({ code, name: code }), ...o })

describe('mergeAlgoCandidates', () => {
  const scan = [
    { code: '000030', name: '디', entry_grade: 'D', entry_score: 5, warn_score: 0, current_price: 30000, close: 30000 },
    { code: '000020', name: '비', entry_grade: 'B', entry_score: 3, warn_score: 1, current_price: 20000, close: 20500, signal_rank: 2 },
    { code: '000010', name: '에이', entry_grade: 'a', entry_score: 4, warn_score: 0, current_price: 10000, close: 10000, signal_rank: 1 },
    { code: '000011', name: '가격없음', entry_grade: 'C', entry_score: 0, warn_score: 0 },
  ]
  const highlights = [
    { code: '000010', name: '에이', entry_price: 10100, signal_rank: 1, signal_score: 7 },
    { code: '000040', name: '하이라이트만', entry_price: 40000, signal_rank: 4 },
    { code: '000041', name: '진입가없음' },
    { code: '', name: '코드없음' },
  ]

  it('등급 D는 제외하고 우선순위(진입 점수 − 경고) 순으로 후보를 만든다', () => {
    const r = mergeAlgoCandidates(scan, [])
    expect(r.map((x) => x.code)).toEqual(['000010', '000020', '000011'])
    expect(r.every((x) => x.targetPct === 5 && x.stopPct === 3)).toBe(true)
    expect(r[0].winProb).toBe(Math.round(empiricalWinProb(5, 3)))
    expect(r[0].source).toBe('scan-candidates')
  })
  it('가격이 없으면 50,000원을 가정한다', () => {
    const r = mergeAlgoCandidates(scan, [])
    const noPrice = r.find((x) => x.code === '000011')!
    expect(noPrice.current_price).toBe(50000)
    expect(noPrice.close).toBe(50000)
    expect(r.find((x) => x.code === '000020')!.close).toBe(20500)
  })
  it('하이라이트가 후보와 겹치면 신호·진입가를 덮고, 새 종목은 추가한다', () => {
    const r = mergeAlgoCandidates(scan, highlights)
    expect(r.map((x) => x.code)).toEqual(['000010', '000020', '000011', '000040', '000041'])
    const overlap = r.find((x) => x.code === '000010')!
    expect(overlap).toMatchObject({ source: 'scan-highlights', current_price: 10100, signal_score: 7, signal_rank: 1 })
    const only = r.find((x) => x.code === '000040')!
    expect(only).toMatchObject({ source: 'scan-highlights', current_price: 40000, targetPct: 5, stopPct: 3 })
    expect(r.find((x) => x.code === '000041')!.current_price).toBeUndefined()
  })
  it('코드가 없거나 입력이 비면 건너뛴다', () => {
    expect(mergeAlgoCandidates([], [])).toEqual([])
    expect(mergeAlgoCandidates([{ name: '코드없음', entry_grade: 'A' }], [])).toEqual([])
  })
})

describe('buildWatchlistCandidates', () => {
  it('필드 별칭을 읽고 가격 기본값을 채운다', () => {
    const r = buildWatchlistCandidates([
      { code: '000050', stock_name: '관심', current_price: 5000, close: 5100, priority: 3, rank: 5, market: 'KOSPI' },
      { symbol: '000060', name: '심볼', stock: { close: 7000, market: 'KOSDAQ' } },
      { code: '000070', name: '가격없음' },
      { name: '코드없음' },
    ])
    expect(r.map((x) => x.code)).toEqual(['000050', '000060', '000070'])
    expect(r[0]).toMatchObject({ source: 'watchlist', current_price: 5000, close: 5100, signal_score: 3, signal_rank: 5, market: 'KOSPI' })
    expect(r[1]).toMatchObject({ name: '심볼', current_price: 7000, close: 7000, market: 'KOSDAQ', signal_rank: 9999 })
    expect(r[2]).toMatchObject({ current_price: 50000, close: 50000 })
  })
})

describe('recommend', () => {
  const pools = { algo: [item('A1')], watchlist: [item('W1'), item('W2')], items: [item('I1'), item('CASH')] }
  it('소스별 후보, 현재 종목은 현금 행 제외', () => {
    expect(getCandidatesBySource('algo', pools).map((x) => x.code)).toEqual(['A1'])
    expect(getCandidatesBySource('watchlist', pools)).toHaveLength(2)
    expect(getCandidatesBySource('items', pools).map((x) => x.code)).toEqual(['I1'])
    expect(countTradeable(pools.items)).toBe(1)
  })
  // 목표 5%/손절 3%/승률 55%: 손익비 1.67 → 안정(1.9) 탈락, 균형(1.6) 통과
  const mid = item('M1', { targetPct: 5, stopPct: 3, winProb: 55, current_price: 10000, close: 10000 })
  it('폴백을 허용하면 안정 기준 미달 시 균형으로 내려가고, 허용하지 않으면 빈 결과', () => {
    const noFallback = recommendWithStyleFallback([mid], 'stable', false, 10_000_000, 500_000)
    expect(noFallback.styleUsed).toBe('stable')
    expect(countTradeable(noFallback.rows)).toBe(0)
    const fallback = recommendWithStyleFallback([mid], 'stable', true, 10_000_000, 500_000)
    expect(fallback.styleUsed).toBe('balanced')
    expect(countTradeable(fallback.rows)).toBeGreaterThan(0)
  })
  it('기준을 통과하는 종목이면 선호 성향 그대로', () => {
    const good = item('G1', { targetPct: 8, stopPct: 2, winProb: 70, current_price: 10000, close: 10000 })
    const r = recommendWithStyleFallback([good], 'stable', true, 10_000_000, 500_000)
    expect(r.styleUsed).toBe('stable')
    expect(countTradeable(r.rows)).toBe(1)
  })
})

describe('summary', () => {
  const items = [item('S1', { amount: 3_000_000 }), item('S2', { amount: 2_000_000 })]
  it('배분 합계·잔여·비용 차감 기대값의 관계', () => {
    const s = calcSummary({ items, fillRatePct: 100, feePct: 0.15, taxPct: 0.2, totalCapital: 4_000_000 })
    expect(s.allocated).toBe(5_000_000)
    expect(s.remaining).toBe(-1_000_000)
    expect(s.feeTax).toBeCloseTo(s.splitInvested * 0.0035, 6)
    expect(s.evAfterCost).toBeCloseTo(s.ev - s.feeTax, 6)
  })
  it('체결률이 낮으면 체결 반영 투자금이 줄고, 종목이 없으면 전부 0', () => {
    const full = calcSummary({ items, fillRatePct: 100, feePct: 0, taxPct: 0, totalCapital: 1 })
    const half = calcSummary({ items, fillRatePct: 50, feePct: 0, taxPct: 0, totalCapital: 1 })
    expect(half.splitInvested).toBeLessThan(full.splitInvested)
    expect(calcSummary({ items: [], fillRatePct: 100, feePct: 1, taxPct: 1, totalCapital: 100 })).toMatchObject({ allocated: 0, ev: 0, remaining: 100 })
  })
  it('시나리오 행은 정해진 등락률 순서, 종목별 메타는 종목 수만큼', () => {
    expect(calcScenarioRows(items, 100, 0.15, 0.2).map((r) => r.pct)).toEqual(SCENARIOS)
    const meta = calcItemMeta(items, 100)
    expect(meta).toHaveLength(2)
    expect(meta[0]).toHaveProperty('grade')
  })
})
