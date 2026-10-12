import { beforeEach, describe, expect, it } from 'vitest'
import { readLS, writeLS } from './cache'
import { formatKoDateTime, formatKoDateTimeLong, formatKoreanMoney, toNum } from './format'
import { clampNum, confidenceLabel, detectCurrentPhase, mapMacroPhaseToRotation } from './phase'
import { buildMetricsSummary, buildSectorReason } from './sectorText'
import type { Sector } from '../types'
import { flow5d, isNextCandidate, latestSectorUpdate, rankSectors } from './tabs'

const sector = (name: string, score: number | null, o: Partial<Sector> = {}): Sector => ({ id: name, name, score, change_rate: 0, ...o })

describe('cache', () => {
  beforeEach(() => localStorage.clear())
  it('TTL 안의 값만 돌려준다', () => {
    writeLS('k', { a: 1 })
    expect(readLS<{ a: number }>('k', 60_000)).toEqual({ a: 1 })
    localStorage.setItem('old', JSON.stringify({ ts: Date.now() - 120_000, data: 1 }))
    expect(readLS('old', 60_000)).toBeNull()
    expect(readLS('none', 60_000)).toBeNull()
    localStorage.setItem('bad', '{not json')
    expect(readLS('bad', 60_000)).toBeNull()
  })
})

describe('format', () => {
  it('숫자 변환: 유한하지 않으면 null', () => {
    expect(toNum('12')).toBe(12)
    expect(toNum('x')).toBeNull()
    expect(toNum(undefined)).toBeNull()
    expect(toNum(null)).toBe(0) // Number(null) === 0 인 기존 동작
  })
  it('한국식 금액 단위(조·억·만)와 자릿수', () => {
    expect(formatKoreanMoney(5_000_000_000_000)).toBe('5.00조')
    expect(formatKoreanMoney(150_000_000)).toBe('1.50억')
    expect(formatKoreanMoney(2_500_000_000)).toBe('25.0억')
    expect(formatKoreanMoney(30_000_000_000)).toBe('300억')
    expect(formatKoreanMoney(-30_000)).toBe('-3.00만')
    expect(formatKoreanMoney(500)).toBe('500')
  })
  it('날짜 표기: 비정상은 —', () => {
    expect(formatKoDateTime(null)).toBe('—')
    expect(formatKoDateTime('garbage')).toBe('—')
    expect(formatKoDateTime('2026-10-09T01:30:00Z')).toMatch(/10.*09/)
    expect(formatKoDateTimeLong('2026-10-09T01:30:15Z')).toMatch(/:15$|15$/)
    expect(formatKoDateTimeLong(undefined)).toBe('—')
  })
})

describe('sectorText', () => {
  it('지표 요약: 있는 항목만, 기관 방향 표시', () => {
    expect(buildMetricsSummary(sector('a', 1))).toBeNull()
    expect(buildMetricsSummary(sector('a', 1, { metrics: { core_count: 4.6, stock_count: 20, flow_inst_5d: 200_000_000 } }))).toBe('핵심 5종목 · 전체 20종목 · 기관↑ 2.00억원')
    expect(buildMetricsSummary(sector('a', 1, { metrics: { flow_inst_5d: -30_000 } }))).toBe('기관↓ -3.00만원')
    expect(buildMetricsSummary(sector('a', 1, { metrics: { flow_inst_5d: 0 } }))).toBe('기관- 0원')
  })
  it('섹터 한 줄 사유: 상위 탭은 점수, 그 외는 등락률', () => {
    const s = sector('a', 80, { change_rate: 1.234, metrics: { flow_inst_5d: 200_000_000 } })
    expect(buildSectorReason(s, 'promising')).toBe('점수 상위권으로 주도 강도가 높은 구간입니다. 기관 수급이 최근 5일 2.00억원 순유입입니다.')
    expect(buildSectorReason(s, 'next')).toBe('단기 등락률이 +1.23%로 우상향 흐름입니다. 기관 수급이 최근 5일 2.00억원 순유입입니다.')
    expect(buildSectorReason(sector('a', 55), 'promising')).toContain('기준선(55점) 이상')
    expect(buildSectorReason(sector('a', 10), 'promising')).toContain('점수는 낮지만')
    expect(buildSectorReason(sector('a', 10, { change_rate: -2 }), 'next')).toContain('-2.00%로 변동성 확인이 필요')
    expect(buildSectorReason(sector('a', 10), 'next')).toBe('단기 등락률은 보합권입니다. 수급 데이터는 제한적으로 제공됩니다.')
    expect(buildSectorReason(sector('a', 10, { metrics: { flow_inst_5d: -50_000_000 } }), 'next')).toContain('순유출')
    expect(buildSectorReason(sector('a', 10, { metrics: { flow_inst_5d: 0 } }), 'next')).toContain('중립')
  })
})

describe('phase', () => {
  it('보조 함수', () => {
    expect(clampNum(5, 0, 3)).toBe(3)
    expect(confidenceLabel(80)).toBe('높음')
    expect(confidenceLabel(60)).toBe('보통')
    expect(confidenceLabel(59)).toBe('낮음')
    expect(mapMacroPhaseToRotation(undefined)).toBeNull()
    expect(mapMacroPhaseToRotation('unknown')).toBeNull()
    expect(mapMacroPhaseToRotation('normal')).toBe('expansion')
    expect(mapMacroPhaseToRotation('high_inflation')).toBe('slowdown')
    expect(mapMacroPhaseToRotation('stagflation')).toBe('recession')
    expect(mapMacroPhaseToRotation('deflation')).toBe('recession')
  })
  it('섹터 데이터가 없으면 데이터 부족', () => {
    expect(detectCurrentPhase([])).toMatchObject({ phase: null, confidence: 0, confidenceLabel: '낮음', basisLabel: '데이터 부족' })
    // 메타에 없는 섹터·점수 없는 섹터는 집계에서 빠진다
    expect(detectCurrentPhase([sector('없는섹터', 80), sector('건설', null)])).toMatchObject({ phase: null, reason: '유효한 섹터 점수가 부족해 국면을 산출하지 못했습니다.' })
  })
  it('한 국면이 뚜렷하면 그 국면과 신뢰도(격차·커버리지 기반)', () => {
    // 산업재·소재(회복기) 평균 80 vs 나머지 0 → 격차 비율 1
    const r = detectCurrentPhase([sector('건설', 80), sector('철강', 80), sector('화학', 80)])
    expect(r.phase).toBe('recovery')
    // 30 + 1*42 + (3/12)*18 = 76.5 → 77
    expect(r.confidence).toBe(77)
    expect(r.confidenceLabel).toBe('보통')
    expect(r.basisLabel).toBe('섹터 점수 기반')
    expect(r.reason).toBe('1위-2위 격차 80.0점 · 유효 섹터 3개')
  })
  it('1·2위 점수 차가 작고 거시 신호가 없으면 판단 보류(신뢰도 45 이하)', () => {
    const all = [sector('건설', 80), sector('식품', 60), sector('철강', 45), sector('화학', 30)]
    const r = detectCurrentPhase(all)
    expect(r.phase).toBeNull()
    expect(r.confidence).toBe(36)
    expect(r.reason).toContain('판단 보류')
  })
  it('거시 국면이 일치하면 가산, 불일치하면 감산(가중치는 거시 신뢰도의 20%, 8~20)', () => {
    const all = [sector('건설', 80), sector('철강', 80), sector('화학', 80)]
    const agree = detectCurrentPhase(all, { economicPhase: { phase: 'normal', label: '정상' }, tradingSignal: { confidence: 100 } })
    // 거시 정상 → 확장기, 섹터 1위는 회복기이므로 불일치: 77 - 20
    expect(agree.phase).toBe('recovery')
    expect(agree.confidence).toBe(57)
    expect(agree.basisLabel).toBe('섹터+거시 혼합')
    expect(agree.reason).toContain('불일치')
    const noWeight = detectCurrentPhase(all, { economicPhase: { phase: 'normal' } })
    expect(noWeight.confidence).toBe(65) // 가중치 기본 12
    expect(noWeight.reason).toContain('거시 국면 참고 불일치')
  })
})

describe('tabs', () => {
  const all = [
    sector('A', 80, { change_rate: 1, metrics: { flow_inst_5d: 100, flow_foreign_5d: 50 } }),
    sector('B', 60, { change_rate: -1, metrics: { flow_inst_5d: -500 } }),
    sector('C', 45, { change_rate: 2, metrics: {} }),
    sector('D', 30, { change_rate: 3, metrics: { flow_foreign_5d: 20 } }),
    sector('E', 41, { change_rate: 0.5, updated_at: '2026-10-09T01:00:00Z' }),
    sector('F', null, { change_rate: 5 }),
  ]
  it('수급 합과 다음 섹터 후보 조건', () => {
    expect(flow5d(all[0])).toBe(150)
    expect(flow5d(all[2])).toBe(0)
    expect(isNextCandidate(all[3])).toBe(true) // 점수 30이지만 수급 플러스
    expect(isNextCandidate(all[2])).toBe(true) // 오르고 점수 45
    expect(isNextCandidate(all[1])).toBe(false)
    expect(isNextCandidate(all[5])).toBe(false) // 점수 없음
  })
  it('상위 탭은 점수 55 이상 점수순, 없으면 전체', () => {
    const r = rankSectors(all, 'promising')
    expect(r.promising.map((s) => s.name)).toEqual(['A', 'B'])
    expect(r.displayed.map((s) => s.name)).toEqual(['A', 'B'])
    const none = rankSectors([sector('X', 10), sector('Y', 20)], 'promising')
    expect(none.promising).toEqual([])
    expect(none.displayed.map((s) => s.name)).toEqual(['Y', 'X'])
  })
  it('다음 탭은 수급 합 내림차순, 같으면 등락률 내림차순', () => {
    const r = rankSectors(all, 'next')
    expect(r.displayed.map((s) => s.name)).toEqual(['A', 'D', 'C', 'E'])
    expect(rankSectors(all, 'all').displayed.map((s) => s.name)).toEqual(['A', 'D', 'C', 'E'])
  })
  it('원본 배열은 건드리지 않는다', () => {
    const copy = all.map((s) => s.name)
    rankSectors(all, 'next')
    expect(all.map((s) => s.name)).toEqual(copy)
  })
  it('가장 최근 갱신 시각', () => {
    expect(latestSectorUpdate([])).toBeNull()
    expect(latestSectorUpdate(all)).toBe('2026-10-09T01:00:00.000Z')
    expect(latestSectorUpdate([sector('Z', 1, { updated_at: 'bad' })])).toBeNull()
  })
})
