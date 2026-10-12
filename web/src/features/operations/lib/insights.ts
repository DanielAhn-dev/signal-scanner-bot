import type { AutoCycleInsightRun } from '../types'

export function runStatusLabel(status: AutoCycleInsightRun['status']): string {
  if (status === 'SUCCESS') return '성공'
  if (status === 'FAILED') return '실패'
  return '스킵'
}

export function runStatusTone(status: AutoCycleInsightRun['status']): { color: string; bg: string } {
  if (status === 'SUCCESS') return { color: '#0F766E', bg: '#E8F7F3' }
  if (status === 'FAILED') return { color: '#B42318', bg: '#FFF0F1' }
  return { color: '#92400E', bg: '#FFF4E5' }
}

export function decisionTone(decision: AutoCycleInsightRun['compare_rows'][number]['decision']): { color: string; bg: string } {
  if (decision === 'BUY') return { color: '#0F766E', bg: '#E8F7F3' }
  if (decision === 'SELL') return { color: '#0B57D0', bg: '#EBF3FF' }
  if (decision === 'SKIP') return { color: '#92400E', bg: '#FFF4E5' }
  if (decision === 'ERROR') return { color: '#B42318', bg: '#FFF0F1' }
  return { color: '#475467', bg: '#F5F7FA' }
}

export function normalizeDecisionFilter(
  value: unknown,
): 'ALL' | 'BUY' | 'SKIP' | 'HOLD' | 'SELL' | 'ERROR' {
  const upper = String(value || 'ALL').toUpperCase()
  if (upper === 'BUY' || upper === 'SKIP' || upper === 'HOLD' || upper === 'SELL' || upper === 'ERROR') {
    return upper
  }
  return 'ALL'
}

export function reasonCategoryFromText(reason: string): string {
  const text = String(reason || '').toLowerCase()
  if (/신뢰도|기술관문|signal|trust/.test(text)) return '기술관문'
  if (/현금|자금|주문 가능 금액/.test(text)) return '자금/현금'
  if (/일손실|리스크|복구모드|슬롯|정책/.test(text)) return '리스크/정책'
  if (/후보 없음|후보|필터/.test(text)) return '후보 부족'
  return '기타'
}

export function estimateMissingReason(input: {
  signal: string | null
  latest: AutoCycleInsightRun
}): string {
  const signal = String(input.signal || '').toUpperCase().trim()
  if (signal && !['BUY', 'STRONG_BUY', 'WATCH'].includes(signal)) {
    return `신호 우선순위 미달(${signal})`
  }

  if (input.latest.funnel && input.latest.funnel.selected <= 0) {
    return '후보 선별 단계 미통과'
  }

  const gate = input.latest.key_gate_reasons[0] || ''
  if (gate) {
    return `계좌 게이트 우선 차단(${gate})`
  }

  return '상위 후보 우선순위 밀림 또는 보유/중복 제외'
}
