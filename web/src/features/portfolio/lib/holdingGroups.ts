import { holdingAccountKey, holdingValue } from './accountKey'
import { rowTradeCost, type TradeCostOptions } from './summary'
import type { AccountFolder, HoldingRow } from '../types'

/**
 * 보유 목록 묶기 — 계좌·종목이 많아지면(여러 증권사·여러 계좌) 한 줄로 늘어놓은 카드는 같은 종목이 흩어지고 계좌 소계가 없다.
 * account: 계좌마다 묶고 소계(평가액·손익·비중), stock: 같은 종목을 합친 한 줄(계좌별 수량은 펼쳐서), flat: 지금처럼 한 줄씩.
 * 묶음 안 순서는 들어온 순서(이미 필터·정렬된 행)를 지킨다.
 */
export type HoldingGroupMode = 'account' | 'stock' | 'flat'

export const HOLDING_GROUP_OPTIONS: { key: HoldingGroupMode; label: string }[] = [
  { key: 'account', label: '계좌별' },
  { key: 'stock', label: '종목별' },
  { key: 'flat', label: '한 줄씩' },
]

export function isHoldingGroupMode(v: unknown): v is HoldingGroupMode {
  return HOLDING_GROUP_OPTIONS.some((o) => o.key === v)
}

type CostOpts = { includeCost: boolean; tradeCostOpts: TradeCostOptions }

type Totals = { value: number; invested: number; pnl: number; pnlPct: number | null }

function totalsOf(rows: HoldingRow[], opts: CostOpts): Totals {
  let value = 0
  let invested = 0
  let pnl = 0
  for (const r of rows) {
    const qty = Number(r.quantity || 0)
    const inv = qty * Number(r.avg_price || 0)
    value += holdingValue(r)
    invested += inv
    // 카드와 같은 손익: 서버 unrealized_pnl, 없으면 평가액 − 원금. 비용 포함이면 매매비용을 뺀다
    const raw = r.unrealized_pnl != null ? Number(r.unrealized_pnl) : holdingValue(r) - inv
    pnl += raw - (opts.includeCost ? rowTradeCost(r, opts.tradeCostOpts) : 0)
  }
  return { value, invested, pnl, pnlPct: invested > 0 ? (pnl / invested) * 100 : null }
}

export type AccountGroup = Totals & {
  key: string
  brokerName: string
  accountName: string
  rows: HoldingRow[]
  /** 보이는 묶음 합계 중 이 계좌 비중(%) */
  weightPct: number
}

/** 계좌별 묶음 — 순서는 계좌 탭과 같게(accountFolders 순), 탭에 없는 계좌(봇 등)는 뒤에 */
export function groupByAccount(rows: HoldingRow[], folders: AccountFolder[], opts: CostOpts): AccountGroup[] {
  const by = new Map<string, HoldingRow[]>()
  for (const r of rows) {
    const key = holdingAccountKey(r)
    by.set(key, [...(by.get(key) ?? []), r])
  }
  const order = folders.map((f) => f.key)
  const keys = [...by.keys()].sort((a, b) => {
    const ia = order.indexOf(a)
    const ib = order.indexOf(b)
    return (ia < 0 ? Infinity : ia) - (ib < 0 ? Infinity : ib)
  })
  const groups = keys.map((key) => {
    const list = by.get(key) ?? []
    const folder = folders.find((f) => f.key === key)
    return {
      key,
      brokerName: folder?.brokerName ?? String(list[0]?.broker_name || '').trim(),
      accountName: folder?.accountName ?? String(list[0]?.account_name || '').trim(),
      rows: list,
      weightPct: 0,
      ...totalsOf(list, opts),
    }
  })
  const all = groups.reduce((s, g) => s + g.value, 0)
  for (const g of groups) g.weightPct = all > 0 ? (g.value / all) * 100 : 0
  return groups
}

export type StockGroup = Totals & {
  code: string
  name: string
  quantity: number
  /** 수량 가중 평균 매수가 */
  avgPrice: number | null
  rows: HoldingRow[]
}

/** 종목별 합치기 — 같은 종목을 여러 계좌에 나눠 담았으면 한 줄로. 순서는 그 종목이 처음 나온 자리 */
export function groupByStock(rows: HoldingRow[], opts: CostOpts): StockGroup[] {
  const by = new Map<string, HoldingRow[]>()
  for (const r of rows) {
    const code = String(r.code || '').trim()
    by.set(code, [...(by.get(code) ?? []), r])
  }
  return [...by.entries()].map(([code, list]) => {
    const quantity = list.reduce((s, r) => s + Number(r.quantity || 0), 0)
    const t = totalsOf(list, opts)
    return {
      code,
      name: String(list[0]?.stock_name || list[0]?.ticker || list[0]?.symbol || code),
      quantity,
      avgPrice: quantity > 0 && t.invested > 0 ? t.invested / quantity : null,
      rows: list,
      ...t,
    }
  })
}
