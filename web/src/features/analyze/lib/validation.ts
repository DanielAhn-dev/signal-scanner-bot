import type { SignalTone } from '../types'

export type DataValidation = { isReliable: boolean; warnings: string[] }
export type AnalysisCoverage = { available: number; total: number; missing: string[]; creditIsProxy: boolean }

/** 데이터 신뢰성 검증: 진입 구간과 현재가가 2배·3배 넘게 벌어지면 동기화 문제로 본다 */
export function validateEntryGap(result: any, advisor: any): DataValidation {
  if (!result || !advisor) return { isReliable: true, warnings: [] as string[] }
  
  const warnings: string[] = []
  const currentPrice = result.close ?? 0
  const entryMid = advisor.entryLow != null && advisor.entryHigh != null
    ? (advisor.entryLow + advisor.entryHigh) / 2
    : null
  
  // 진입가와 현재가의 갭 검증 (스케일링 이슈)
  if (entryMid && currentPrice > 0) {
    const ratio = Math.max(currentPrice, entryMid) / Math.min(currentPrice, entryMid)
    if (ratio > 3) {
      warnings.push(`진입가와 현재가의 갭이 큼 (비율: ${ratio.toFixed(1)}배). DB 데이터 동기화 확인 필요`)
    } else if (ratio > 2) {
      warnings.push(`진입가와 현재가의 차이가 예상보다 큼 (비율: ${ratio.toFixed(1)}배)`)
    }
  }
  
  return {
    isReliable: warnings.length === 0,
    warnings,
  }
}

/** 가격·재무·기술지표·수급·공매도/신용 5개 중 확보된 개수 */
export function calcAnalysisCoverage(result: any, flow: any, creditShort: any): AnalysisCoverage {
  if (!result) return { available: 0, total: 5, missing: [] as string[], creditIsProxy: false }
  const checks = [
    { label: '가격', ok: result.close != null && result.date != null },
    { label: '재무', ok: result?.fundamental_gate?.status === 'pass' || result?.fundamental_gate?.status === 'fail' },
    { label: '기술지표', ok: [result.sma20, result.sma50, result.rsi14].filter((value) => value != null).length >= 2 },
    { label: '수급', ok: flow?.date != null && (flow?.foreign != null || flow?.institution != null) },
    { label: '공매도/신용', ok: creditShort?.source === 'db' || creditShort?.source === 'live' },
  ]
  return {
    available: checks.filter((item) => item.ok).length,
    total: checks.length,
    missing: checks.filter((item) => !item.ok).map((item) => item.label),
    creditIsProxy: creditShort?.source === 'proxy',
  }
}

/** 현재 진입 판단 라벨. 분기 순서(데이터 없음 → 동기화 검증 → 데이터 부족 → 두 단계 행동)가 결과를 결정한다 */
export function decideEntry(
  advisor: any,
  result: any,
  validation: DataValidation,
  coverageAvailable: number,
): { label: string; reason: string; tone: SignalTone } {
  if (!advisor || !result?.close) {
    return { label: '판단 보류', reason: '현재가 또는 판정 데이터가 없습니다.', tone: 'neutral' as SignalTone }
  }
  if (!validation.isReliable) {
    return { label: '판단 보류', reason: '가격 기준의 동기화 검증이 필요합니다.', tone: 'warning' as SignalTone }
  }
  if (coverageAvailable <= 2) {
    return { label: '데이터 부족', reason: '핵심 데이터가 부족해 진입 판단의 신뢰도가 낮습니다.', tone: 'warning' as SignalTone }
  }
  const action = String(advisor?.twoStage?.action || '').toLowerCase()
  if (action === 'aggressive_buy' || action === 'pilot_buy') {
    return { label: advisor.twoStage.actionLabel || '진입 검토', reason: advisor.twoStage.reason || advisor.signalReason || '규칙상 진입 검토 구간입니다.', tone: 'positive' as SignalTone }
  }
  if (action === 'reduce') {
    return { label: advisor.twoStage.actionLabel || '비중 축소', reason: advisor.twoStage.reason || advisor.signalReason || '신규 진입보다 리스크 관리가 우선입니다.', tone: 'negative' as SignalTone }
  }
  return { label: advisor?.twoStage?.actionLabel || advisor.statusLabel || '관망', reason: advisor?.twoStage?.reason || advisor.signalReason || '현재는 진입 조건 확인이 더 필요합니다.', tone: 'warning' as SignalTone }
}
