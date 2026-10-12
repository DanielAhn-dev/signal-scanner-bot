import { buildAccountKey, isVirtualPositionRow } from './accountKey'
import type { HoldingRow } from '../types'

/** 계좌 탭 선택값('all' | 'virtual' | 계좌 키)에 맞는 보유 행만 남긴다 */
export function selectAccountRows(rows: HoldingRow[], accountKey: string): HoldingRow[] {
  if (accountKey === 'all') return rows
  if (accountKey === 'virtual') return rows.filter((r) => isVirtualPositionRow(r))
  return rows.filter((r) => buildAccountKey(r?.broker_name, r?.account_name) === accountKey)
}

export function extractSectors(rows: HoldingRow[]): Array<{ id: string; name: string }> {
  const seen = new Map<string, { id: string; name: string }>()
  for (const r of rows) {
    const s = r.stock?.sector
    if (s?.id && s?.name && !seen.has(String(s.id))) {
      seen.set(String(s.id), { id: String(s.id), name: String(s.name) })
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name, 'ko'))
}

export type HoldingFilterCriteria = {
  accountKey: string
  sectorId: string | null
  search: string
  stateFilter: 'all' | 'hold' | 'add' | 'partial'
  gradeFilter: 'all' | 'A' | 'B' | 'C'
}

export function filterHoldings(
  rows: HoldingRow[],
  criteria: HoldingFilterCriteria,
  getState: (row: HoldingRow) => 'hold' | 'add' | 'partial',
  getGrade: (row: HoldingRow) => 'A' | 'B' | 'C',
): HoldingRow[] {
  let result = selectAccountRows(rows, criteria.accountKey)
  if (criteria.sectorId) result = result.filter((r) => String(r.stock?.sector_id ?? '') === criteria.sectorId)
  if (criteria.search) {
    const q = criteria.search.toLowerCase()
    result = result.filter((r) =>
      (r.code || '').toLowerCase().includes(q) ||
      (r.stock_name || '').toLowerCase().includes(q),
    )
  }
  if (criteria.stateFilter !== 'all') result = result.filter((r) => getState(r) === criteria.stateFilter)
  if (criteria.gradeFilter !== 'all') result = result.filter((r) => getGrade(r) === criteria.gradeFilter)
  return result
}
