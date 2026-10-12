import type { CandidateMode } from '../types'

export function parseCodes(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const token of text.split(/[\s,\n]+/g)) {
    const value = token.trim()
    if (!value) continue
    const code = value.replace(/[^0-9A-Za-z]/g, '').toUpperCase()
    if (!code) continue
    if (seen.has(code)) continue
    seen.add(code)
    out.push(code)
  }
  return out
}

export function normalizeSourceLabel(input: string | null | undefined): string {
  const value = String(input || '').trim().toLowerCase()
  if (!value) return '수동 입력'
  if (value === 'manual' || value === 'manual-input') return '수동 입력'
  if (value === 'auto-scan' || value === 'autoscan') return '자동 후보(스캔)'
  if (value === 'scan') return '스캔 연동'
  if (value === 'highlights') return '집행우선 연동'
  if (value === 'execution-guide') return '실행가이드'
  if (value === 'analyze') return '분석 연동'
  if (value === 'backtest') return '백테스트 연동'
  if (value === 'discovery') return '발굴 연동'
  return String(input || '').trim()
}

export function autoSourceLabelByMode(mode: CandidateMode): string {
  if (mode === 'multibagger') return '자동 후보(멀티배거)'
  if (mode === 'swing') return '자동 후보(스윙)'
  return '자동 후보(밸런스)'
}
