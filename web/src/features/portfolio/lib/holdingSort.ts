import { holdingValue } from './accountKey'
import { rowTradeCost, type TradeCostOptions } from './summary'
import type { HoldingRow } from '../types'

export type HoldingSortKey = 'default' | 'pct_desc' | 'pct_asc' | 'value_desc'

export const HOLDING_SORT_OPTIONS: { key: HoldingSortKey; label: string }[] = [
  { key: 'default', label: '기본 순' },
  { key: 'pct_desc', label: '수익률 높은 순' },
  { key: 'pct_asc', label: '수익률 낮은 순' },
  { key: 'value_desc', label: '평가금액 많은 순' },
]

export function isHoldingSortKey(v: unknown): v is HoldingSortKey {
  return HOLDING_SORT_OPTIONS.some((o) => o.key === v)
}

type SortOpts = { includeCost: boolean; tradeCostOpts: TradeCostOptions }

/** 카드에 보이는 수익률과 같은 값 — 비용 포함을 켜면 매매비용을 뺀 수익률 */
export function displayedReturnPct(r: HoldingRow, opts: SortOpts): number | null {
  const pct = r.unrealized_pct != null ? Number(r.unrealized_pct) : null
  if (!opts.includeCost || r.unrealized_pnl == null) return pct != null && Number.isFinite(pct) ? pct : null
  const inv = Number(r.quantity || 0) * Number(r.avg_price || 0)
  if (!(inv > 0)) return null
  const v = ((Number(r.unrealized_pnl) - rowTradeCost(r, opts.tradeCostOpts)) / inv) * 100
  return Number.isFinite(v) ? v : null
}

/** 정렬한 새 배열을 돌려준다. 값이 없는 종목은 어느 순서든 맨 뒤, 같은 값은 원래 순서 유지 */
export function sortHoldings(rows: HoldingRow[], key: HoldingSortKey, opts: SortOpts): HoldingRow[] {
  if (key === 'default') return rows
  const valueOf = (r: HoldingRow): number | null => {
    if (key === 'value_desc') {
      const v = holdingValue(r)
      return Number.isFinite(v) ? v : null
    }
    return displayedReturnPct(r, opts)
  }
  const dir = key === 'pct_asc' ? 1 : -1
  return rows
    .map((r, i) => ({ r, i, v: valueOf(r) }))
    .sort((a, b) => {
      if (a.v == null && b.v == null) return a.i - b.i
      if (a.v == null) return 1
      if (b.v == null) return -1
      return a.v === b.v ? a.i - b.i : (a.v - b.v) * dir
    })
    .map((x) => x.r)
}
