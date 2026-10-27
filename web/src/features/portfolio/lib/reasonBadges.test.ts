import { describe, expect, it } from 'vitest'
import { buildReasonBadges } from './reasonBadges'

const labels = (b: ReturnType<typeof buildReasonBadges>) => b.map((x) => x.label)

describe('buildReasonBadges', () => {
  it('아무 신호도 없으면 관망', () => {
    expect(labels(buildReasonBadges({}, 'hold', null, 70))).toEqual(['관망'])
  })
  it('점수가 추가매수 기준 미만이면 점수부족', () => {
    expect(labels(buildReasonBadges({}, 'hold', 60, 70))).toEqual(['점수부족'])
  })
  it('관망 상태에서 경고·매도 신호를 표시', () => {
    expect(labels(buildReasonBadges({ warn_grade: 'WARN', score_signal: 'SELL' }, 'hold', 80, 70))).toEqual(['경고있음', '매도신호'])
  })
  it('부분청산이면 익절구간과 신호·경고 배지', () => {
    const b = buildReasonBadges({ score_signal: 'SELL', warn_grade: 'SELL', warn_score: 4.4 }, 'partial', 50, 70)
    expect(labels(b)).toEqual(['익절구간', '매도신호', '경고강함', '경고점수 4'])
  })
  it('보유 신호는 보유신호 배지', () => {
    expect(labels(buildReasonBadges({ score_signal: 'HOLD' }, 'partial', null, 70))).toEqual(['익절구간', '보유신호'])
  })
  it('추가매수면 점수·진입·추세 배지', () => {
    const b = buildReasonBadges({ entry_grade: 'A', trend_grade: 'B' }, 'add', 75.4, 70)
    expect(labels(b)).toEqual(['추가진입', '점수충족 75', '진입A', '추세B'])
  })
  it('진입 가이드와 비중 경고가 맨 앞에 붙고, 있으면 관망은 붙지 않는다', () => {
    const b = buildReasonBadges({
      entry_price_guide: { verdict: 'caution', gapPct: 3.26, message: '추격 주의' },
      weight_caution: { level: 'strong', message: '과열' },
    }, 'hold', 90, 70)
    expect(labels(b)).toEqual(['추격주의 +3.3%', '비중 점검(강)'])
    expect(b[0]).toMatchObject({ type: 'warn', title: '추격 주의' })
    expect(b[1].title).toContain('과열\n근거:')
  })
  it('가이드가 괜찮으면 ok 배지', () => {
    const b = buildReasonBadges({ entry_price_guide: { verdict: 'ok', gapPct: -1.2, message: '' } }, 'hold', null, 70)
    expect(b[0]).toMatchObject({ label: '지금 매수 무방', type: 'ok' })
  })
  it('연속 영업적자면 경고 배지(근거 포함), 관망은 붙지 않는다', () => {
    const b = buildReasonBadges({ operating_loss_streak: { quarters: 4, latestPeriodEnd: '2026-06-30' } }, 'hold', 90, 70)
    expect(labels(b)).toEqual(['4분기 연속 영업적자'])
    expect(b[0]).toMatchObject({ type: 'warn' })
    expect(b[0].title).toContain('2026-06-30')
    expect(b[0].title).toContain('37.8%')
  })
})
