export type AllocationRow = { code: string; name: string; value: number; ratio: number }

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

/** 종목별 평가금액(+현금) 비중. 평가금액 0 이하 종목은 제외하고 큰 순으로 정렬 */
export function buildAllocationRows(rows: any[], estimatedCash: number): AllocationRow[] {
  const items = rows
    .map((r: any) => {
      const quantity = Number(r.quantity || 0)
      const avgPrice = Number(r.avg_price || 0)
      const unrealized = Number(r.unrealized_pnl || 0)
      const marketValue = quantity > 0 ? (quantity * avgPrice + unrealized) : 0
      const safeValue = Number.isFinite(marketValue) ? marketValue : 0
      return {
        code: String(r.code || '-'),
        name: String(r.stock_name || r.ticker || r.symbol || r.code || '-'),
        value: Math.max(0, safeValue),
      }
    })
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value)

  if (estimatedCash > 0) {
    items.push({ code: 'CASH', name: '현금', value: estimatedCash })
  }

  const sum = items.reduce((acc, row) => acc + row.value, 0)
  if (sum <= 0) return []

  return items.map((row) => ({ ...row, ratio: (row.value / sum) * 100 }))
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
