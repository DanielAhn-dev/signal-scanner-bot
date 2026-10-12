import type { AutoPickTier } from '../types'

export function autoTierLabel(tier: AutoPickTier): string {
  if (tier === 'now') return '즉시 매수 후보'
  if (tier === 'prepare') return '반등 준비 후보'
  return '관찰 후보'
}

export function matchMeta(n: number): { label: string; cls: string } {
  if (n >= 3) return { label: '패턴 일치 높음 (3/3)', cls: 'bt-match--high' }
  if (n >= 2) return { label: '패턴 일치 중간 (2/3)', cls: 'bt-match--mid' }
  if (n >= 1) return { label: '패턴 일치 낮음 (1/3)', cls: 'bt-match--low' }
  return { label: '패턴 불일치', cls: 'bt-match--none' }
}

export function confidenceMeta(sampleCount: number): { label: string; cls: string } {
  if (sampleCount >= 20) return { label: `표본 충분 (${sampleCount})`, cls: 'bt-match--high' }
  if (sampleCount >= 10) return { label: `표본 보통 (${sampleCount})`, cls: 'bt-match--mid' }
  if (sampleCount >= 5) return { label: `표본 적음 (${sampleCount})`, cls: 'bt-match--low' }
  return { label: `표본 매우 적음 (${sampleCount})`, cls: 'bt-match--none' }
}

export function pbrMeta(pbr: number): { note: string; cls: string } {
  if (pbr <= 1.0) return { note: '청산가치 이하 — 강한 저평가', cls: 'bt-check-fund-value--good' }
  if (pbr <= 1.5) return { note: '저평가 구간', cls: 'bt-check-fund-value--good' }
  if (pbr <= 2.5) return { note: '적정 수준', cls: '' }
  return { note: '고평가', cls: 'bt-check-fund-value--warn' }
}
