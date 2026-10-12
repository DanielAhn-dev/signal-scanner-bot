import { describe, expect, it } from 'vitest'
import { calcChartHud, normalizeCandles } from './candles'
import { calcPriceBarPct, formatDate, formatDateTime } from './dates'
import { buildShareSummaryLines, buildSignalText } from './shareSummary'
import { calcAnalysisCoverage, decideEntry, validateEntryGap } from './validation'

describe('normalizeCandles', () => {
  it('날짜 없음·비정상 값·고저 불일치는 버리고 날짜순으로 정렬한다', () => {
    const r = normalizeCandles([
      { date: '2026-10-09', open: 10, high: 12, low: 9, close: 11, volume: 5 },
      { Date: '2026-10-07', open: 10, high: 11, low: 9, close: 10 },
      { date: '', open: 1, high: 1, low: 1, close: 1 },
      { date: '2026-10-08', open: 0, high: 5, low: 1, close: 3 },
      { date: '2026-10-08', open: 10, high: 9, low: 8, close: 9 },
      { date: '2026-10-08', open: 'x', high: 5, low: 1, close: 3 },
    ])
    expect(r.map((c) => c.date)).toEqual(['2026-10-07', '2026-10-09'])
    expect(r[0].volume).toBe(0)
    expect(r[1]).toMatchObject({ open: 10, high: 12, low: 9, close: 11, volume: 5 })
  })
  it('지지·저항은 최근 20봉의 최저 저가·최고 고가, 비어 있으면 null', () => {
    expect(calcChartHud([])).toEqual({ support: null, resistance: null })
    const candles = Array.from({ length: 25 }, (_, i) => ({
      date: `2026-09-${String(i + 1).padStart(2, '0')}`, open: 10, high: 20 + i, low: 5 + i, close: 10, volume: 1,
    }))
    // 최근 20봉 = i 5..24 → 최저 저가 10, 최고 고가 44
    expect(calcChartHud(candles)).toEqual({ support: 10, resistance: 44 })
  })
})

describe('dates', () => {
  it('날짜 표기: 비면 —, 파싱 불가면 원문', () => {
    expect(formatDate(null)).toBe('—')
    expect(formatDate('garbage')).toBe('garbage')
    expect(formatDate('2026-10-09')).toMatch(/2026.*10.*09/)
    expect(formatDateTime('2026-10-09T01:30:00Z')).toMatch(/10.*09.*10.*30/)
    expect(formatDateTime('')).toBe('—')
  })
  it('일중 범위 위치: 고가=저가면 null', () => {
    expect(calcPriceBarPct({ high: 110, low: 90, close: 100 })).toBe(50)
    expect(calcPriceBarPct({ high: 100, low: 100, close: 100 })).toBeNull()
    expect(calcPriceBarPct({ close: 100 })).toBeNull()
    expect(calcPriceBarPct(null)).toBeNull()
  })
})

describe('validation', () => {
  const result = { close: 70000, date: '2026-10-09', sma20: 1, sma50: 2, fundamental_gate: { status: 'pass' } }
  it('진입가-현재가 비율: 2배 이하 정상, 2배 초과 경고, 3배 초과 동기화 경고', () => {
    expect(validateEntryGap(null, null)).toEqual({ isReliable: true, warnings: [] })
    expect(validateEntryGap(result, { entryLow: 68000, entryHigh: 70000 }).isReliable).toBe(true)
    const mid = validateEntryGap(result, { entryLow: 30000, entryHigh: 34000 })
    expect(mid.isReliable).toBe(false)
    expect(mid.warnings[0]).toContain('차이가 예상보다 큼 (비율: 2.2배)')
    const big = validateEntryGap(result, { entryLow: 19000, entryHigh: 21000 })
    expect(big.warnings[0]).toContain('갭이 큼 (비율: 3.5배)')
    expect(big.warnings[0]).toContain('DB 데이터 동기화 확인 필요')
    expect(validateEntryGap(result, { entryLow: null, entryHigh: 70000 }).isReliable).toBe(true)
  })
  it('데이터 충족도: 5개 항목과 프록시 표시', () => {
    expect(calcAnalysisCoverage(null, null, null)).toEqual({ available: 0, total: 5, missing: [], creditIsProxy: false })
    const full = calcAnalysisCoverage(result, { date: 'd', foreign: 1 }, { source: 'live' })
    expect(full).toMatchObject({ available: 5, missing: [], creditIsProxy: false })
    const partial = calcAnalysisCoverage({ close: 1, date: 'd' }, { date: 'd' }, { source: 'proxy' })
    expect(partial).toMatchObject({ available: 1, missing: ['재무', '기술지표', '수급', '공매도/신용'], creditIsProxy: true })
    expect(calcAnalysisCoverage({ close: 1, date: 'd', sma20: 1, rsi14: 50 }, null, null).missing).not.toContain('기술지표')
  })
  describe('진입 판단 분기 순서', () => {
    const ok = { isReliable: true, warnings: [] }
    const adv = (twoStage?: any, extra: any = {}) => ({ statusLabel: '대기', ...extra, twoStage })
    it('판정·현재가 없음 → 판단 보류(중립)', () => {
      expect(decideEntry(null, result, ok, 5)).toMatchObject({ label: '판단 보류', tone: 'neutral' })
      expect(decideEntry(adv(), { close: 0 }, ok, 5).label).toBe('판단 보류')
    })
    it('동기화 검증 실패가 데이터 부족보다 먼저', () => {
      expect(decideEntry(adv(), result, { isReliable: false, warnings: ['w'] }, 1)).toMatchObject({ label: '판단 보류', tone: 'warning' })
    })
    it('충족도 2 이하 → 데이터 부족', () => {
      expect(decideEntry(adv({ action: 'pilot_buy' }), result, ok, 2)).toMatchObject({ label: '데이터 부족', tone: 'warning' })
      expect(decideEntry(adv({ action: 'pilot_buy' }), result, ok, 3).label).toBe('진입 검토')
    })
    it('두 단계 행동별 라벨·사유·톤', () => {
      expect(decideEntry(adv({ action: 'aggressive_buy', actionLabel: '적극', reason: '사유' }), result, ok, 5)).toEqual({ label: '적극', reason: '사유', tone: 'positive' })
      expect(decideEntry(adv({ action: 'reduce' }), result, ok, 5)).toMatchObject({ label: '비중 축소', tone: 'negative' })
      expect(decideEntry(adv({ action: 'hold' }, { signalReason: '근거' }), result, ok, 5)).toEqual({ label: '대기', reason: '근거', tone: 'warning' })
      expect(decideEntry(adv(undefined, { statusLabel: undefined }), result, ok, 5).label).toBe('관망')
    })
  })
})

describe('shareSummary', () => {
  it('공유 요약: 일중 범위·재무·판정·진입구간·목표/손절을 최대 4줄', () => {
    expect(buildShareSummaryLines(null, null)).toEqual([])
    const lines = buildShareSummaryLines(
      { high: 71000, low: 68500, per: 12.3, pbr: 1.2, roe: 9.1 },
      { statusLabel: '매수', finalScore: 72.4, twoStage: { actionLabel: '소량 진입' }, entryLow: 68000, entryHigh: 70000, target1: 75000, stopPrice: 64000 },
    )
    expect(lines).toHaveLength(4)
    expect(lines[0]).toContain('일중 범위')
    expect(lines[1]).toBe('PER 12.30 / PBR 1.20 / ROE 9.10%')
    expect(lines[2]).toBe('규칙 판정 매수 · 72.4점 · 실행 소량 진입')
    expect(lines[3]).toContain('진입구간')
  })
  it('신호 문구: 두 단계 행동 우선, 상태값별 한글', () => {
    expect(buildSignalText({ twoStage: { actionLabel: '소량 진입' }, statusLabel: '매수' })).toBe('소량 진입 (매수)')
    expect(buildSignalText({ twoStage: { actionLabel: '관망' } })).toBe('관망 (대기)')
    expect(buildSignalText({ status: 'strong_buy' })).toBe('매수+')
    expect(buildSignalText({ status: 'buy-on-pullback' })).toBe('매수')
    expect(buildSignalText({ status: 'scale-in' })).toBe('추가매수')
    expect(buildSignalText({ status: 'partial_sell' })).toBe('익절')
    expect(buildSignalText({ status: 'sell' })).toBe('손절/매도')
    expect(buildSignalText({ status: 'watch' })).toBe('관망')
    expect(buildSignalText({ status: 'x', statusLabel: '라벨' })).toBe('라벨')
    expect(buildSignalText(null)).toBe('대기')
  })
})
