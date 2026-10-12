import { describe, expect, it } from 'vitest'
import { buildNarrativeLine, flowNarrativeSignal, pegNarrativeSignal, shortNarrativeSignal } from './narrative'
import { advisorStatusStyle, regimeLabel, scoreColor, toneStyle, twoStageActionStyle } from './styles'
import { formatCompactKrw, formatFlowValue, getFlowMetricLabel } from './flow'
import { buildAnalyzeShareUrl } from './shareUrl'

describe('narrative', () => {
  it('PEG 구간별 톤', () => {
    expect(pegNarrativeSignal(null)).toBeNull()
    expect(pegNarrativeSignal(0.4)).toMatchObject({ label: 'PEG 0.40', tone: 'positive' })
    expect(pegNarrativeSignal(0.7)?.tone).toBe('positive')
    expect(pegNarrativeSignal(1.2)?.tone).toBe('neutral')
    expect(pegNarrativeSignal(2)?.tone).toBe('warning')
    expect(pegNarrativeSignal(3.5)?.tone).toBe('negative')
  })
  it('기관·외인 수급 해석', () => {
    expect(flowNarrativeSignal(null, null)).toBeNull()
    expect(flowNarrativeSignal(0, 0)).toBeNull()
    expect(flowNarrativeSignal(100, 100)?.label).toBe('기관·외인 동반 매수')
    expect(flowNarrativeSignal(-1, -1)).toMatchObject({ label: '기관·외인 동반 매도', tone: 'negative' })
    expect(flowNarrativeSignal(200, -10)?.label).toBe('기관 주도 매수')
    expect(flowNarrativeSignal(-10, 200)?.label).toBe('외인 주도 매수')
    expect(flowNarrativeSignal(1, 0)).toMatchObject({ label: '기관 순매수', tone: 'neutral' })
    expect(flowNarrativeSignal(-5, 0)).toMatchObject({ label: '기관 순매도', tone: 'warning' })
    expect(flowNarrativeSignal(null, -5)?.label).toBe('외인 순매도')
  })
  it('공매도 비율 구간', () => {
    expect(shortNarrativeSignal(null)).toBeNull()
    expect(shortNarrativeSignal(3)).toMatchObject({ label: '공매도 3.0%', tone: 'negative' })
    expect(shortNarrativeSignal(1)?.tone).toBe('warning')
    expect(shortNarrativeSignal(0.3)?.tone).toBe('positive')
  })
  it('한 줄 요약: 긍정 공매도는 빼고, 신호가 없으면 null', () => {
    const peg = pegNarrativeSignal(0.4)
    const flow = flowNarrativeSignal(100, 100)
    expect(buildNarrativeLine(peg, flow, shortNarrativeSignal(3))).toBe('고점에서도 추가 상승 근거. 추가 상승 여지. 공매도 높음.')
    expect(buildNarrativeLine(peg, flow, shortNarrativeSignal(0.3))).toBe('고점에서도 추가 상승 근거. 추가 상승 여지.')
    expect(buildNarrativeLine(null, null, null)).toBeNull()
  })
})

describe('styles', () => {
  it('톤·점수·판정·국면·두 단계 행동의 스타일', () => {
    expect(toneStyle('positive').color).toBe('var(--color-success)')
    expect(toneStyle('neutral').bg).toBe('var(--color-bg-sunken)')
    expect(scoreColor(null)).toBe('var(--color-text-tertiary)')
    expect(scoreColor(70)).toBe('var(--color-success)')
    expect(scoreColor(50)).toBe('var(--color-warning)')
    expect(scoreColor(49.9)).toBe('var(--color-error)')
    expect(advisorStatusStyle(undefined).color).toBe('var(--color-text-secondary)')
    expect(advisorStatusStyle('Buy').color).toBe('var(--color-success)')
    expect(advisorStatusStyle('partial_sell').color).toBe('var(--color-warning)')
    expect(advisorStatusStyle('sell').color).toBe('var(--color-error)')
    expect(regimeLabel('risk_on')).toBe('리스크온')
    expect(regimeLabel('RISK_OFF')).toBe('리스크오프')
    expect(regimeLabel('hold')).toBe('중립/HOLD')
    expect(regimeLabel(undefined)).toBe('—')
    expect(twoStageActionStyle('pilot_buy').color).toBe('var(--color-success)')
    expect(twoStageActionStyle('reduce').color).toBe('var(--color-warning)')
    expect(twoStageActionStyle('exit').color).toBe('var(--color-error)')
  })
})

describe('flow', () => {
  it('수급 단위 라벨', () => {
    expect(getFlowMetricLabel('volume')).toBe('거래량')
    expect(getFlowMetricLabel('amount')).toBe('거래대금')
    expect(getFlowMetricLabel(null)).toBeNull()
  })
  it('금액 축약: 억은 소수 1자리(정수면 생략), 만원·원', () => {
    expect(formatCompactKrw(null)).toBe('—')
    expect(formatCompactKrw(NaN)).toBe('—')
    expect(formatCompactKrw(150_000_000)).toBe('1.5억원')
    expect(formatCompactKrw(300_000_000)).toBe('3억원')
    expect(formatCompactKrw(-30_000)).toBe('-3만원')
    expect(formatCompactKrw(500)).toBe('500원')
  })
  it('수급 값 표기: 단위에 따라 주/축약/원', () => {
    expect(formatFlowValue(null, 'amount')).toBe('—')
    expect(formatFlowValue(1234, 'volume')).toBe('1,234주')
    expect(formatFlowValue(150_000_000, 'amount')).toBe('1.5억원')
    expect(formatFlowValue(1234, null)).toContain('1,234')
  })
})

describe('shareUrl', () => {
  it('현재 주소에 code만 덮어쓴다', () => {
    window.history.replaceState({}, '', '/analyze?x=1')
    const url = new URL(buildAnalyzeShareUrl('005930'))
    expect(url.searchParams.get('code')).toBe('005930')
    expect(url.searchParams.get('x')).toBe('1')
  })
})
