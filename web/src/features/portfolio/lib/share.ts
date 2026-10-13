import { classifyHolding, type AssetBucket } from '../../../../../src/lib/incomeGuide'
import { formatKrwCompact } from '../../../lib/format'
import type { HoldingRow, PortfolioShareHistoryItem } from '../types'
import { accountLabel, holdingValue } from './accountKey'

export function pickLatestActiveShare(items: PortfolioShareHistoryItem[]): PortfolioShareHistoryItem | null {
  const now = Date.now()
  for (const item of items) {
    const expired = new Date(item.expiresAt).getTime() <= now
    if (!item.revokedAt && !expired) return item
  }
  return null
}

export type CopyGroupMode = 'role' | 'brand' | 'account' | 'plain'

export const COPY_GROUP_OPTIONS: { value: CopyGroupMode; label: string }[] = [
  { value: 'role', label: '역할별' },
  { value: 'brand', label: '브랜드별' },
  { value: 'account', label: '계좌별' },
  { value: 'plain', label: '묶지 않음' },
]

// 역할별 묶음 — 화면의 "이 종목 대응" 역할 이름과 같은 순서·이름을 쓴다
const ROLE_SECTIONS: { label: string; buckets: AssetBucket[] }[] = [
  { label: '성장 (지수)', buckets: ['kr_index', 'global_index'] },
  { label: '인컴 (배당)', buckets: ['dividend'] },
  { label: '인컴 (커버드콜)', buckets: ['covered_call'] },
  { label: '인컴 (리츠·인프라)', buckets: ['reit_infra'] },
  { label: '현금성', buckets: ['bond_cash'] },
  { label: '개별주', buckets: ['stock'] },
  { label: '테마 ETF', buckets: ['other_etf'] },
  { label: '레버리지·인버스', buckets: ['leveraged'] },
]

type CopyItem = { code: string; name: string; qty: number; cost: number; value: number }

function sectionOf(r: HoldingRow, mode: CopyGroupMode): string {
  const code = String(r.code || '')
  const name = String(r.stock_name || r.ticker || r.symbol || code)
  if (mode === 'role') {
    const bucket = classifyHolding(code, name)
    return ROLE_SECTIONS.find((sec) => sec.buckets.includes(bucket))?.label ?? '기타'
  }
  if (mode === 'brand') {
    const first = name.trim().split(/\s+/)[0] ?? ''
    return /^[A-Z0-9]+$/.test(first) ? first : '개별주·기타'
  }
  if (mode === 'account') return accountLabel(r.broker_name, r.account_name) || '계좌 미지정'
  return ''
}

/**
 * 보유 종목을 "종목코드 / 상품명 / 평단 / 수량" 한 줄씩의 텍스트로 만든다.
 * 같은 묶음 안에서 같은 종목은 수량 합산·평단 가중평균. 묶음 제목에는 종목 수·평가금액·비중(소계)을 붙인다.
 */
export function buildQuantityText(rows: HoldingRow[], mode: CopyGroupMode = 'role'): string {
  const sections = new Map<string, Map<string, CopyItem>>()
  let total = 0
  for (const r of rows) {
    const qty = Number(r.quantity || 0)
    if (!(qty > 0)) continue
    const code = String(r.code || '')
    const sec = sectionOf(r, mode)
    const items = sections.get(sec) ?? new Map<string, CopyItem>()
    const cur = items.get(code) ?? { code, name: String(r.stock_name || r.ticker || r.symbol || code), qty: 0, cost: 0, value: 0 }
    const value = holdingValue(r)
    cur.qty += qty
    cur.cost += qty * Number(r.avg_price || 0)
    cur.value += value
    total += value
    items.set(code, cur)
    sections.set(sec, items)
  }

  const line = (it: CopyItem) =>
    `${it.code} / ${it.name} / ${Math.round(it.cost / it.qty).toLocaleString('ko-KR')}원 / ${it.qty}주`
  const sorted = (items: Map<string, CopyItem>) => [...items.values()].sort((a, b) => b.value - a.value)

  if (mode === 'plain') {
    const items = sections.get('')
    return items ? sorted(items).map(line).join('\n') : ''
  }

  const sum = (items: Map<string, CopyItem>) => [...items.values()].reduce((acc, it) => acc + it.value, 0)
  const order = mode === 'role'
    ? [...ROLE_SECTIONS.map((sec) => sec.label), '기타']
    : [...sections.keys()].sort((a, b) => sum(sections.get(b)!) - sum(sections.get(a)!))

  const blocks: string[] = []
  for (const label of order) {
    const items = sections.get(label)
    if (!items) continue
    const value = sum(items)
    const pct = total > 0 ? ` · 비중 ${Math.round((value / total) * 100)}%` : ''
    blocks.push([`■ ${label} · ${items.size}종목 · ${formatKrwCompact(value)}${pct}`, ...sorted(items).map(line)].join('\n'))
  }
  if (blocks.length === 0) return ''
  blocks.push(`합계 ${formatKrwCompact(total)}`)
  return blocks.join('\n\n')
}
