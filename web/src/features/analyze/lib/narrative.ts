import { formatNumber } from '../../../lib/format'
import type { NarrativeSignal } from '../types'

export function pegNarrativeSignal(peg: number | null): NarrativeSignal | null {
  if (peg == null) return null
  if (peg < 0.5) return { label: `PEG ${formatNumber(peg, 2)}`, detail: '극저평가 — 고점에서도 추가 상승 근거', tone: 'positive' }
  if (peg < 1.0) return { label: `PEG ${formatNumber(peg, 2)}`, detail: '저평가 — 성장 대비 주가 매력적', tone: 'positive' }
  if (peg < 1.5) return { label: `PEG ${formatNumber(peg, 2)}`, detail: '적정가 — 성장률에 맞는 밸류에이션', tone: 'neutral' }
  if (peg < 3.0) return { label: `PEG ${formatNumber(peg, 2)}`, detail: '다소 고평가 — 성장률 대비 주가 부담', tone: 'warning' }
  return { label: `PEG ${formatNumber(peg, 2)}`, detail: '고평가 — 수익 성장 대비 과열', tone: 'negative' }
}

export function flowNarrativeSignal(institution: number | null, foreign: number | null): NarrativeSignal | null {
  if (institution == null && foreign == null) return null
  const instPos = institution != null && institution > 0
  const instNeg = institution != null && institution < 0
  const forPos = foreign != null && foreign > 0
  const forNeg = foreign != null && foreign < 0
  if (instPos && forPos) return { label: '기관·외인 동반 매수', detail: '수급 강세 — 추가 상승 여지', tone: 'positive' }
  if (instNeg && forNeg) return { label: '기관·외인 동반 매도', detail: '수급 이탈 — 단기 조정 주의', tone: 'negative' }
  if (instPos && (institution! / Math.max(1, Math.abs(foreign ?? 0))) > 1.5) return { label: '기관 주도 매수', detail: '외인 혼조이나 기관 우세', tone: 'positive' }
  if (forPos && (foreign! / Math.max(1, Math.abs(institution ?? 0))) > 1.5) return { label: '외인 주도 매수', detail: '기관 혼조이나 외인 우세', tone: 'positive' }
  if (instPos || forPos) return { label: instPos ? '기관 순매수' : '외인 순매수', detail: '단일 주체 매수 진행', tone: 'neutral' }
  if (instNeg || forNeg) return { label: instNeg ? '기관 순매도' : '외인 순매도', detail: '이탈 주의, 방향 확인 필요', tone: 'warning' }
  return null
}

export function shortNarrativeSignal(shortRatio: number | null): NarrativeSignal | null {
  if (shortRatio == null) return null
  if (shortRatio > 2) return { label: `공매도 ${formatNumber(shortRatio, 1)}%`, detail: '높음 — 하방 압력 상존', tone: 'negative' }
  if (shortRatio > 0.5) return { label: `공매도 ${formatNumber(shortRatio, 1)}%`, detail: '보통 — 단기 주의', tone: 'warning' }
  return { label: `공매도 ${formatNumber(shortRatio, 1)}%`, detail: '낮음 — 세력 압박 제한적', tone: 'positive' }
}

export function buildNarrativeLine(
  peg: NarrativeSignal | null,
  flowSig: NarrativeSignal | null,
  shortSig: NarrativeSignal | null,
): string | null {
  const parts: string[] = []
  if (peg) parts.push(peg.detail.split('—')[1]?.trim() ?? peg.detail)
  if (flowSig) parts.push(flowSig.detail.split('—')[1]?.trim() ?? flowSig.detail)
  if (shortSig && shortSig.tone !== 'positive') parts.push(`공매도 ${shortSig.detail.split('—')[0]?.trim()}`)
  return parts.length > 0 ? parts.join('. ') + '.' : null
}
