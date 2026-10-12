import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'
import { classifyDryRunNote, interpretMemo, resolveFailureCause, translateOperationMessage } from './memo'
import { getTimelineMeta, normalizeJobState, normalizeStep, progressFill, renderRunSummary, resolveTaskLabel } from './jobs'
import {
  decisionTone,
  estimateMissingReason,
  filterLatestCompareRows,
  filterRunCompareRows,
  normalizeDecisionFilter,
  reasonCategoryFromText,
  runStatusLabel,
  runStatusTone,
} from './insights'
import { cardBgStyle, sideBadge } from '../components/badges'
import type { AutoCycleInsightRun, JobSnapshot } from '../types'

describe('interpretMemo', () => {
  it('메모가 없으면 근거 없음', () => {
    expect(interpretMemo(null)).toEqual({ label: '매매 근거 없음', reason: null })
  })
  it('strategy/event/note 형식: 전략·이벤트를 한글로, note는 사유로', () => {
    expect(interpretMemo('strategy=core.autotrade.v1;event=new-buy;note=autotrade-x')).toEqual({ label: '자동매매 · 신규 매수', reason: 'autotrade x' })
    expect(interpretMemo('strategy=core.autotrade.v1;event=stop-loss;note=stop-loss')).toEqual({ label: '자동매매 · 손절 매도', reason: null })
    expect(interpretMemo('strategy=core.autotrade.v1;event=add-on-buy;note=take-profit').reason).toBe('익절 매도')
    expect(interpretMemo('strategy=bar;event=foo')).toEqual({ label: 'bar · foo', reason: null })
    expect(interpretMemo('event=new-buy').label).toBe('신규 매수')
    expect(interpretMemo('strategy=ops.adjustment.v1').label).toBe('수동 조정')
    expect(interpretMemo('event=').label).toBe('매매')
  })
  it('레거시 메모', () => {
    expect(interpretMemo('autotrade-take-profit')).toEqual({ label: '자동매매 · take profit', reason: null })
    expect(interpretMemo('watchlist-add-x')).toEqual({ label: '관심종목 · add x', reason: null })
    expect(interpretMemo('직접 입력')).toEqual({ label: '직접 입력', reason: null })
  })
})

describe('classifyDryRunNote', () => {
  it('앞선 규칙이 우선: 후보 → 제외 → 리스크 → 정책 → 실행 → 기타', () => {
    expect(classifyDryRunNote('매수 후보 제외: 점수 미달').key).toBe('candidate')
    expect(classifyDryRunNote('슬롯 없음으로 스킵').key).toBe('reject')
    expect(classifyDryRunNote('손절 조건 도달').key).toBe('risk')
    expect(classifyDryRunNote('Timeout while waiting').key).toBe('risk')
    expect(classifyDryRunNote('정책 게이트 차단').key).toBe('policy')
    expect(classifyDryRunNote('체결 완료').key).toBe('execution')
    expect(classifyDryRunNote('zzz')).toMatchObject({ key: 'other', label: '기타' })
  })
})

describe('서버 메시지 번역·실패 원인', () => {
  it('FIFO 수량 부족을 풀어 쓴다', () => {
    const m = translateOperationMessage('FIFO lots are insufficient for 005930: need 10, left 3')
    expect(m).toContain('005930 매도 주문 수량이 현재 FIFO 기준 보유 수량보다 많아')
    expect(m).toContain('10주를 매도하려 했지만 실제로 추적 가능한 잔량은 3주')
  })
  it('시간 초과·미지원 작업·빈 메시지·그 외', () => {
    expect(translateOperationMessage('Error: timeout 60s')).toMatch(/^작업 처리 시간이 초과되었습니다.*원문: Error: timeout 60s$/)
    expect(translateOperationMessage('Unsupported cron_dispatch task: x')).toContain('지원하지 않는 작업 유형')
    expect(translateOperationMessage('')).toBe('실패 원인 상세가 아직 수집되지 않았습니다.')
    expect(translateOperationMessage('기타 메시지')).toBe('기타 메시지')
  })
  it('실패 원인: 작업 오류 → 드라이런 노트의 오류 → 기본 문구', () => {
    const snap = (error: string | null, notes?: string[]) =>
      ({ job: { error }, dry_run_details: notes ? { notes } : undefined }) as unknown as JobSnapshot
    expect(resolveFailureCause(snap('timeout'))).toContain('시간이 초과')
    expect(resolveFailureCause(snap(null, ['정상', '연결 오류 발생']))).toBe('연결 오류 발생')
    expect(resolveFailureCause(snap(null, ['정상']))).toBe('실패 원인 상세가 아직 수집되지 않았습니다.')
    expect(resolveFailureCause(snap(null))).toBe('실패 원인 상세가 아직 수집되지 않았습니다.')
  })
})

describe('jobs', () => {
  it('작업 상태·단계 정규화', () => {
    expect(normalizeJobState('RUNNING')).toBe('running')
    expect(normalizeJobState('done')).toBe('done')
    expect(normalizeJobState('failed')).toBe('failed')
    expect(normalizeJobState('pending')).toBe('queued')
    expect(normalizeJobState('')).toBe('queued')
    expect(normalizeStep('READY')).toBe('ready')
    expect(normalizeStep(undefined)).toBe('intraday')
    expect(progressFill('queued')).toBe('24%')
    expect(progressFill('running')).toBe('66%')
    expect(progressFill('failed')).toBe('100%')
  })
  it('작업 이름', () => {
    expect(resolveTaskLabel({ task: 'virtualAutoTrade', dry_run: false })).toBe('자동사이클 실제 실행')
    expect(resolveTaskLabel({ task: 'virtualAutoTrade' })).toBe('자동사이클 점검(dry-run)')
    expect(resolveTaskLabel({ task: 'virtualAutoTradeIntraday' })).toBe('순차트리거(장중)')
    expect(resolveTaskLabel({ task: 'x' })).toBe('작업: x')
    expect(resolveTaskLabel(null)).toBe('작업')
  })
  it('실행 요약: 이름 별칭(buys/buyCount) 허용', () => {
    expect(renderRunSummary(null)).toBe('실행 요약 대기 중')
    expect(renderRunSummary({ summary: { buys: 1, sellCount: 2, skipped: 3, errorCount: 4 } } as any)).toBe('매수 1 · 매도 2 · 스킵 3 · 오류 4')
    expect(renderRunSummary({ summary: null } as any)).toBe('매수 0 · 매도 0 · 스킵 0 · 오류 0')
  })
  it('타임라인 아이콘', () => {
    expect(getTimelineMeta({ ts: '', kind: 'queued', label: '' }).icon).toBe('Q')
    expect(getTimelineMeta({ ts: '', kind: 'run_started', label: '' }).icon).toBe('R')
    expect(getTimelineMeta({ ts: '', kind: 'trade', label: '' }).icon).toBe('T')
    expect(getTimelineMeta({ ts: '', kind: 'job_finished', label: '작업 실패' }).icon).toBe('!')
    expect(getTimelineMeta({ ts: '', kind: 'job_finished', label: '작업 완료' }).icon).toBe('D')
  })
})

describe('insights', () => {
  it('실행 상태·판정 톤·필터 정규화', () => {
    expect(runStatusLabel('SUCCESS')).toBe('성공')
    expect(runStatusLabel('FAILED')).toBe('실패')
    expect(runStatusLabel('SKIPPED')).toBe('스킵')
    expect(runStatusTone('FAILED').color).toBe('#B42318')
    expect(decisionTone('BUY').color).toBe('#0F766E')
    expect(decisionTone('HOLD').color).toBe('#475467')
    expect(normalizeDecisionFilter('buy')).toBe('BUY')
    expect(normalizeDecisionFilter('x')).toBe('ALL')
    expect(normalizeDecisionFilter(undefined)).toBe('ALL')
  })
  it('사유 분류', () => {
    expect(reasonCategoryFromText('신뢰도 부족')).toBe('기술관문')
    expect(reasonCategoryFromText('현금 부족')).toBe('자금/현금')
    expect(reasonCategoryFromText('일손실 한도 도달')).toBe('리스크/정책')
    expect(reasonCategoryFromText('후보 없음')).toBe('후보 부족')
    expect(reasonCategoryFromText('기타 사유')).toBe('기타')
  })
  it('빠진 이유 추정: 신호 → 후보 선별 → 계좌 게이트 → 기본', () => {
    const latest = (o: Partial<AutoCycleInsightRun>) => ({ funnel: null, key_gate_reasons: [], ...o }) as AutoCycleInsightRun
    expect(estimateMissingReason({ signal: 'sell', latest: latest({}) })).toBe('신호 우선순위 미달(SELL)')
    expect(estimateMissingReason({ signal: 'WATCH', latest: latest({ funnel: { initial: 1, policy: 1, base: 1, pool: 1, selected: 0 } }) })).toBe('후보 선별 단계 미통과')
    expect(estimateMissingReason({ signal: null, latest: latest({ key_gate_reasons: ['현금 하한'] }) })).toBe('계좌 게이트 우선 차단(현금 하한)')
    expect(estimateMissingReason({ signal: 'BUY', latest: latest({}) })).toBe('상위 후보 우선순위 밀림 또는 보유/중복 제외')
  })
})

describe('badges', () => {
  it('카드 배경과 매매 배지', () => {
    expect(cardBgStyle('BUY').background).toContain('240, 68, 82')
    expect(cardBgStyle('SELL').background).toContain('20, 120, 255')
    expect(cardBgStyle('ADJUST')).toEqual({})
    expect(render(sideBadge('BUY')).container.textContent).toBe('매수')
    expect(render(sideBadge('SELL')).container.textContent).toBe('매도')
    expect(render(sideBadge('ADJUST')).container.textContent).toBe('조정')
  })
})

describe('비교 행 필터', () => {
  const rows = [
    { code: 'A', decision: 'BUY', reason: '현금 부족', score: 1, trust_score: null, min_trust_score: null },
    { code: 'B', decision: 'SKIP', reason: '신뢰도 부족', score: 1, trust_score: null, min_trust_score: null },
    { code: 'C', decision: 'SKIP', reason: '현금 부족', score: 1, trust_score: null, min_trust_score: null },
  ] as AutoCycleInsightRun['compare_rows']
  it('최신 실행은 판정과 사유 분류를 함께, 과거 실행은 판정만', () => {
    expect(filterLatestCompareRows(rows, 'ALL', 'ALL')).toHaveLength(3)
    expect(filterLatestCompareRows(rows, 'SKIP', 'ALL').map((r) => r.code)).toEqual(['B', 'C'])
    expect(filterLatestCompareRows(rows, 'SKIP', '자금/현금').map((r) => r.code)).toEqual(['C'])
    expect(filterLatestCompareRows(rows, 'ALL', '기술관문').map((r) => r.code)).toEqual(['B'])
    expect(filterRunCompareRows(rows, 'ALL')).toBe(rows)
    expect(filterRunCompareRows(rows, 'BUY').map((r) => r.code)).toEqual(['A'])
  })
})
