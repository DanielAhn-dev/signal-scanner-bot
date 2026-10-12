import { describe, expect, it } from 'vitest'
import { autoSourceLabelByMode, normalizeSourceLabel, parseCodes } from './codes'
import { applyRiskMode, parseHoldDays } from './risk'
import {
  decodeHeadlineText,
  formatDateRangeLabel,
  formatRowDataAsOf,
  normalizeDateLabel,
  normalizeNewsSource,
  normalizeNewsUrl,
} from './news'
import {
  clampValue,
  computeFlowAccelerationScore,
  computeNetFlow,
  computeNetFlowScore,
  computeOverheatRisk,
  formatCompactKrw,
  formatStageLabel,
  getThemeBoost,
  gradeToPct,
  normalizeScoreFrom5,
  scoreSignalFreshness,
} from './scoring'

describe('codes', () => {
  it('쉼표·공백·줄바꿈으로 나누고 특수문자 제거·대문자·중복 제거', () => {
    expect(parseCodes('005930, 000660\n005930 a-b ,, ')).toEqual(['005930', '000660', 'AB'])
    expect(parseCodes('')).toEqual([])
    expect(parseCodes('---')).toEqual([])
  })
  it('출처 라벨 정규화', () => {
    expect(normalizeSourceLabel(null)).toBe('수동 입력')
    expect(normalizeSourceLabel('Manual')).toBe('수동 입력')
    expect(normalizeSourceLabel('scan')).toBe('스캔 연동')
    expect(normalizeSourceLabel('highlights')).toBe('집행우선 연동')
    expect(normalizeSourceLabel('backtest')).toBe('백테스트 연동')
    expect(normalizeSourceLabel('내 메모')).toBe('내 메모')
    expect(autoSourceLabelByMode('swing')).toBe('자동 후보(스윙)')
    expect(autoSourceLabelByMode('multibagger')).toBe('자동 후보(멀티배거)')
    expect(autoSourceLabelByMode('balanced')).toBe('자동 후보(밸런스)')
  })
})

describe('risk', () => {
  it('위험 성향별 손절·목표 보정과 null 통과', () => {
    expect(applyRiskMode(47000, 'aggressive', 'stop')).toBe(54050)
    expect(applyRiskMode(54000, 'conservative', 'target')).toBe(45900)
    expect(applyRiskMode(54000, 'neutral', 'target')).toBe(54000)
    expect(applyRiskMode(null, 'aggressive', 'stop')).toBeNull()
  })
  it('보유 기간 파싱', () => {
    expect(parseHoldDays([5, 10])).toEqual([5, 10])
    expect(parseHoldDays([0, 2.7])).toEqual([1, 2])
    expect(parseHoldDays([1])).toBeNull()
    expect(parseHoldDays('x')).toBeNull()
    expect(parseHoldDays(['a', 3])).toBeNull()
  })
})

describe('news', () => {
  it('HTML 엔티티 해제와 공백 정리', () => {
    expect(decodeHeadlineText('A &amp; B  &#39;x&#39; &#x41; &lt;t&gt;')).toBe("A & B 'x' A <t>")
    expect(decodeHeadlineText(null as any)).toBe('')
  })
  it('URL·출처·날짜 정규화', () => {
    expect(normalizeNewsUrl('//a.com/x')).toBe('https://a.com/x')
    expect(normalizeNewsUrl('http://a.com')).toBe('http://a.com')
    expect(normalizeNewsUrl('ftp://a.com')).toBeNull()
    expect(normalizeNewsSource('  ')).toBeNull()
    expect(normalizeNewsSource('언론&amp;사')).toBe('언론&사')
    expect(normalizeDateLabel('2026.10.9')).toBe('2026-10-09')
    expect(normalizeDateLabel('2026-10-09T12:00:00Z')).toBe('2026-10-09')
    expect(normalizeDateLabel('garbage')).toBeNull()
    expect(normalizeDateLabel('')).toBeNull()
  })
  it('날짜 범위·기준일 표기', () => {
    expect(formatDateRangeLabel(['2026-10-09', '2026.10.07', null])).toBe('2026-10-07~2026-10-09')
    expect(formatDateRangeLabel(['2026-10-09', '2026-10-09'])).toBe('2026-10-09')
    expect(formatDateRangeLabel([])).toBeNull()
    expect(formatRowDataAsOf('2026-10-09', '2026-10-08')).toBe('시세 2026-10-09 · 뉴스 2026-10-08')
    expect(formatRowDataAsOf('2026-10-09', null)).toBe('시세 2026-10-09')
    expect(formatRowDataAsOf(null, null)).toBe('—')
  })
})

describe('scoring', () => {
  it('범위 제한·5점/100점 척도·등급 환산', () => {
    expect(clampValue(NaN, 0, 10)).toBe(0)
    expect(clampValue(15, 0, 10)).toBe(10)
    expect(normalizeScoreFrom5(4)).toBe(80)
    expect(normalizeScoreFrom5(50)).toBe(50)
    expect(normalizeScoreFrom5(150)).toBe(100)
    expect(normalizeScoreFrom5(undefined)).toBe(0)
    expect(gradeToPct('b')).toBe(78)
    expect(gradeToPct('?')).toBe(50)
  })
  it('순매수 합산: 외국인+기관, 둘 다 없으면 null, 별칭 키 허용', () => {
    expect(computeNetFlow({ foreign_net_buy_5d: 1e9, institution5d: -4e8 })).toEqual({ net5d: 6e8, net20d: null })
    expect(computeNetFlow({ foreignNetBuy20d: 3e9 })).toEqual({ net5d: null, net20d: 3e9 })
    expect(computeNetFlow({})).toEqual({ net5d: null, net20d: null })
  })
  it('수급 점수·가속 점수', () => {
    expect(computeNetFlowScore({})).toEqual({ score: 50, label: null, net5d: null, net20d: null })
    const s = computeNetFlowScore({ foreign_net_buy_5d: 1e9, foreign_net_buy_20d: 5e9 })
    expect(s.score).toBeCloseTo(60.6, 6)
    expect(s.label).toContain('순유입(5D)')
    expect(computeNetFlowScore({ foreign_net_buy_5d: -1e9 }).label).toContain('순유출(5D)')
    expect(computeFlowAccelerationScore(null, null)).toEqual({ score: 50, label: null })
    expect(computeFlowAccelerationScore(1e9, 0).label).toContain('수급 가속')
    expect(computeFlowAccelerationScore(0, 1e9).label).toContain('수급 둔화')
  })
  it('신호 신선도: 엄격 나이 우선, 라이트 나이, 둘 다 없음', () => {
    expect(scoreSignalFreshness(0, undefined)).toEqual({ score: 100, label: '신호 신선도(D-0)' })
    expect(scoreSignalFreshness(4, 0)).toEqual({ score: 68, label: '신호 신선도(D-4)' })
    expect(scoreSignalFreshness(undefined, 2)).toEqual({ score: 72, label: '라이트 신호(D-2)' })
    expect(scoreSignalFreshness(undefined, undefined)).toEqual({ score: 55, label: null })
    // 현재 동작: null은 Number(null)=0 이라 "오늘 신호"로 취급된다(점수 100)
    expect(scoreSignalFreshness(null, null).score).toBe(100)
  })
  it('과열 위험·단계 라벨·테마 가산', () => {
    expect(computeOverheatRisk(6)).toBeCloseTo(32.4, 6)
    expect(computeOverheatRisk(-6)).toBeCloseTo(12, 6)
    expect(computeOverheatRisk(0)).toBe(0)
    expect(computeOverheatRisk(20)).toBe(100)
    expect(formatStageLabel('Breakout')).toBe('리드 돌파')
    expect(formatStageLabel('lead')).toBe('리드 축적')
    expect(formatStageLabel(null)).toBe('일반')
    const boost = getThemeBoost('LG전자', '반도체')
    expect(boost.score).toBeCloseTo(3.6, 6)
    expect(boost.labels).toEqual(['LG그룹/전장', '반도체/소부장'])
    expect(getThemeBoost('이름', null)).toEqual({ score: 0, labels: [] })
  })
  it('금액 축약 표기 (억 단위는 1억 미만 자릿수 없음, 10억 이상 소수 1자리)', () => {
    expect(formatCompactKrw(null)).toBe('—')
    expect(formatCompactKrw(NaN)).toBe('—')
    expect(formatCompactKrw(30_000)).toBe('+3만원')
    expect(formatCompactKrw(-5_000)).toBe('-5,000원')
    expect(formatCompactKrw(2_500_000_000)).toBe('+25.0억원')
    expect(formatCompactKrw(300_000_000)).toBe('+3억원')
  })
})
