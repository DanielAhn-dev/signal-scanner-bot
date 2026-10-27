import type { HoldingRow } from '../types'
/** rest: '그 외 N종목' 줄에 묶인 종목들(더보기로 펼친다) */
export type AllocationRow = { code: string; name: string; value: number; ratio: number; quantity?: number; rest?: AllocationRow[] }

type AllocationItem = { code: string; name: string; value: number; quantity?: number }

export const ALLOCATION_COLORS = [
  '#2f7ae5',
  '#14b8a6',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#06b6d4',
  '#84cc16',
  '#f97316',
  '#ec4899',
  '#64748b',
]

/** 목록·도넛에 따로 보이는 종목 수. 나머지는 '그 외 N종목' 한 줄 (실계좌 80여 종목이 전부 펼쳐져 화면이 1만 px를 넘었다) */
export const ALLOCATION_TOP = 12
export const ALLOCATION_OTHER_CODE = 'OTHER'

/**
 * 종목별 평가금액(+현금) 비중. 평가금액 0 이하 종목은 제외하고 큰 순으로 정렬.
 * 같은 종목이 여러 계좌에 있으면 한 줄로 합친다(계좌 이름 없이 같은 이름이 여러 번 보였다).
 */
export function buildAllocationRows(rows: HoldingRow[], estimatedCash: number): AllocationRow[] {
  const perRow = rows
    .map((r: HoldingRow) => {
      const quantity = Number(r.quantity || 0)
      const avgPrice = Number(r.avg_price || 0)
      const unrealized = Number(r.unrealized_pnl || 0)
      const marketValue = quantity > 0 ? (quantity * avgPrice + unrealized) : 0
      const safeValue = Number.isFinite(marketValue) ? marketValue : 0
      return {
        code: String(r.code || '-'),
        name: String(r.stock_name || r.ticker || r.symbol || r.code || '-'),
        value: Math.max(0, safeValue),
        quantity: Number.isFinite(quantity) ? quantity : 0,
      }
    })
    .filter((row) => row.value > 0)
  const byCode = new Map<string, AllocationItem>()
  for (const r of perRow) {
    const prev = byCode.get(r.code)
    if (prev) {
      prev.value += r.value
      prev.quantity = (prev.quantity ?? 0) + (r.quantity ?? 0)
    } else byCode.set(r.code, { ...r })
  }
  const sorted = [...byCode.values()].sort((a, b) => b.value - a.value)
  // 한 종목만 남는 '그 외'는 만들지 않는다
  const items: AllocationItem[] = sorted.length > ALLOCATION_TOP + 1
    ? [
        ...sorted.slice(0, ALLOCATION_TOP),
        { code: ALLOCATION_OTHER_CODE, name: `그 외 ${sorted.length - ALLOCATION_TOP}종목`, value: sorted.slice(ALLOCATION_TOP).reduce((s, r) => s + r.value, 0) },
      ]
    : sorted

  if (estimatedCash > 0) {
    items.push({ code: 'CASH', name: '현금', value: estimatedCash })
  }

  const sum = items.reduce((acc, row) => acc + row.value, 0)
  if (sum <= 0) return []

  const withRatio = (row: AllocationItem) => ({ ...row, ratio: (row.value / sum) * 100 })
  const restRows = sorted.length > ALLOCATION_TOP + 1 ? sorted.slice(ALLOCATION_TOP).map(withRatio) : []
  return items.map((row) => (row.code === ALLOCATION_OTHER_CODE ? { ...withRatio(row), rest: restRows } : withRatio(row)))
}

export function buildDonutGradient(rows: AllocationRow[]): string {
  if (rows.length === 0) return 'conic-gradient(#e5e7eb 0deg 360deg)'
  let currentAngle = 0
  const parts = rows.map((row, idx) => {
    const start = currentAngle
    const angle = (row.ratio / 100) * 360
    currentAngle += angle
    const end = idx === rows.length - 1 ? 360 : currentAngle
    return `${ALLOCATION_COLORS[idx % ALLOCATION_COLORS.length]} ${start.toFixed(2)}deg ${end.toFixed(2)}deg`
  })
  return `conic-gradient(${parts.join(', ')})`
}
