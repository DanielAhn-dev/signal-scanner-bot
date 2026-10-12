import type { AutoCandidate } from '../types'
import { formatCompactKrw } from './scoring'

export function formatFlowBadgeLabel(flow5d: number | null, flow20d: number | null): string {
  const base = flow5d != null ? flow5d : flow20d
  if (base == null) return '수급액 데이터 없음'
  const sign = base >= 0 ? '유입' : '유출'
  const fiveText = flow5d == null ? '—' : formatCompactKrw(flow5d)
  const twentyText = flow20d == null ? '—' : formatCompactKrw(flow20d)
  return `수급액 ${sign} 5D ${fiveText} · 20D ${twentyText}`
}

export function normalizeSectorKey(value: string | null | undefined): string {
  const text = String(value || '').trim().toLowerCase()
  if (!text) return '__unknown__'
  if (text.includes('반도체') || text.includes('semiconductor') || text.includes('소부장')) return 'semiconductor'
  if (text.includes('로봇') || text.includes('automation') || text.includes('자동화')) return 'robotics'
  if (text.includes('전장') || text.includes('현대차') || text.includes('자동차') || text.includes('auto')) return 'auto'
  if (text.includes('2차전지') || text.includes('배터리') || text.includes('battery')) return 'battery'
  if (text.includes('바이오') || text.includes('제약') || text.includes('bio') || text.includes('pharma')) return 'bio'
  return text
}

export function pickDiversifiedCandidates(input: AutoCandidate[], limit = 16, perSectorCap = 2): AutoCandidate[] {
  const selected: AutoCandidate[] = []
  const sectorCount = new Map<string, number>()
  const usedCode = new Set<string>()

  // 1차: 점수 순을 유지하면서 섹터당 최대 개수 제한을 적용한다.
  for (const row of input) {
    if (selected.length >= limit) break
    if (!row.code || usedCode.has(row.code)) continue
    const sectorKey = normalizeSectorKey(row.sector)
    const used = sectorCount.get(sectorKey) ?? 0
    if (used >= perSectorCap) continue
    selected.push(row)
    usedCode.add(row.code)
    sectorCount.set(sectorKey, used + 1)
  }

  // 2차: 제한 때문에 자리가 남으면 점수 상위 순으로 채운다.
  if (selected.length < limit) {
    for (const row of input) {
      if (selected.length >= limit) break
      if (!row.code || usedCode.has(row.code)) continue
      selected.push(row)
      usedCode.add(row.code)
    }
  }

  return selected
}
