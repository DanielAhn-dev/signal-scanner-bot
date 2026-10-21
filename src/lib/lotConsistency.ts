// 보유 행과 열린 FIFO 로트의 수량 정합성 — 보유 행(position_id) 단위로 본다.
// 한 계정에 봇 가상 행과 여러 실계좌 행이 같은 종목으로 있을 수 있어서,
// 종목코드로 합산하면 계좌 사이에 수량이 섞여 가짜 불일치가 나고, 정리하면 다른 계좌 로트까지 닫힌다.

export type LotConsistencyPosition = {
  id: number
  code: string
  quantity: number
  broker_name?: string | null
  account_name?: string | null
  name?: string | null
}

export type LotConsistencyLot = {
  id: number
  code: string
  remaining_quantity: number
  position_id: number | null
}

export type LotConsistencyIssue = {
  code: string
  name: string | null
  kind: 'mismatch' | 'missing_lots' | 'orphan_lots'
  position_id: number | null
  /** 봇 가상 계좌면 '봇 가상 계좌', 실계좌면 '증권사 / 계좌명' */
  account_label: string | null
  position_qty: number
  lot_qty: number
  /** orphan_lots일 때 닫을 로트 id(종목코드로 닫지 않는다) */
  lot_ids: number[]
  detail: string
}

export function positionAccountLabel(p: { broker_name?: string | null; account_name?: string | null }): string {
  const broker = String(p.broker_name ?? '').trim()
  const account = String(p.account_name ?? '').trim()
  if (!broker && !account) return '봇 가상 계좌'
  return [broker, account].filter(Boolean).join(' / ')
}

function toQty(value: unknown): number {
  const num = Math.floor(Number(value ?? 0))
  return Number.isFinite(num) && num > 0 ? num : 0
}

/**
 * positions: 보유 중(수량>0) 행, lots: 열린(remaining>0) 로트.
 * 보유 행에 연결되지 않은 로트(position_id null 또는 보유 중이 아닌 행)는 종목별 orphan으로 묶어 로트 id를 함께 돌려준다.
 */
export function buildLotConsistencyIssues(
  positions: LotConsistencyPosition[],
  lots: LotConsistencyLot[],
): LotConsistencyIssue[] {
  const positionIds = new Set(positions.map((p) => p.id))
  const lotQtyByPosition = new Map<number, number>()
  const orphanByCode = new Map<string, { qty: number; ids: number[] }>()

  for (const lot of lots) {
    const qty = toQty(lot.remaining_quantity)
    if (qty <= 0) continue
    const positionId = Number(lot.position_id ?? 0)
    if (positionId > 0 && positionIds.has(positionId)) {
      lotQtyByPosition.set(positionId, (lotQtyByPosition.get(positionId) ?? 0) + qty)
      continue
    }
    const code = String(lot.code || '').trim()
    const entry = orphanByCode.get(code) ?? { qty: 0, ids: [] }
    entry.qty += qty
    entry.ids.push(lot.id)
    orphanByCode.set(code, entry)
  }

  const issues: LotConsistencyIssue[] = []
  for (const position of positions) {
    const positionQty = toQty(position.quantity)
    const lotQty = lotQtyByPosition.get(position.id) ?? 0
    if (positionQty === lotQty) continue
    const kind = lotQty <= 0 ? 'missing_lots' : 'mismatch'
    const label = positionAccountLabel(position)
    issues.push({
      code: String(position.code || '').trim(),
      name: String(position.name ?? '').trim() || null,
      kind,
      position_id: position.id,
      account_label: label,
      position_qty: positionQty,
      lot_qty: lotQty,
      lot_ids: [],
      detail: kind === 'missing_lots'
        ? `[${label}] 보유수량 ${positionQty}주인데 열려 있는 FIFO lot 이 없습니다.`
        : `[${label}] 보유수량 ${positionQty}주와 FIFO lot 합계 ${lotQty}주가 다릅니다.`,
    })
  }

  for (const [code, orphan] of orphanByCode.entries()) {
    issues.push({
      code,
      name: null,
      kind: 'orphan_lots',
      position_id: null,
      account_label: null,
      position_qty: 0,
      lot_qty: orphan.qty,
      lot_ids: orphan.ids,
      detail: `보유 행에 연결되지 않은 FIFO lot ${orphan.qty}주가 열려 있습니다.`,
    })
  }

  return issues
}
