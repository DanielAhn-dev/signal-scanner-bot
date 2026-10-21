import { BUCKET_GROUP, BUCKET_LABEL, REBALANCE_BAND_PP, classifyHolding, type AssetBucket } from '../../../../../src/lib/incomeGuide'
import { COVERED_CALL_MAX_SHARE_PCT } from '../../../lib/holdingAction'
import { SATELLITE_MAX_WEIGHT_PCT, SATELLITE_SELL_WEIGHT_PCT } from '../../../lib/satelliteGuard'
import { accountLabel, holdingAccountKey, holdingValue } from './accountKey'
import { isRealRow } from './stockSizing'
import type { HoldingRow } from '../types'

/**
 * 실제 계좌 전체를 유형별로 한 번에 본다 — 개별주·커버드콜·국내 지수가 내 계획과 얼마나 다른지.
 * 상한은 다른 화면과 같은 값을 쓴다: 개별주 10%(팔아 줄일 선 20%, satelliteGuard), 커버드콜은 인컴의 1/3(holdingAction),
 * 국내 지수는 '내 계획' 구성의 코스피200 몫과 리밸런싱 밴드(10%p).
 * 가격이 없는 종목은 평가액을 원가로 두고(holdingValue) 따로 알린다 — 수익률이 0%로 보여 틀린 안심을 주지 않게.
 */
export type OverviewBucketRow = {
  bucket: AssetBucket
  label: string
  value: number
  cost: number
  pct: number
  returnPct: number | null
  note: string | null
}

export type OverviewAccountRow = {
  key: string
  label: string
  value: number
  returnPct: number | null
  /** 이 계좌에서 가장 큰 유형과 그 비중 */
  topLabel: string
  topPct: number
}

export type AccountOverview = {
  total: number
  cost: number
  returnPct: number | null
  buckets: OverviewBucketRow[]
  accounts: OverviewAccountRow[]
  /** 가격 자료가 없어 원가로 계산한 종목 */
  missingPrice: { code: string; name: string }[]
}

/** 내 계획 구성 중 코스피200 몫(%) — 구성을 안 정했으면 null */
export function planKrIndexPct(mix: { index: string; weight: number }[] | null | undefined): number | null {
  if (!mix || mix.length === 0) return null
  const sum = mix.reduce((s, e) => s + (Number(e.weight) || 0), 0)
  if (!(sum > 0)) return null
  const kr = mix.filter((e) => e.index === 'kospi200').reduce((s, e) => s + (Number(e.weight) || 0), 0)
  return (kr / sum) * 100
}

const pctOf = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0)
const returnOf = (value: number, cost: number) => (cost > 0 ? (value / cost - 1) * 100 : null)
const round0 = (n: number) => Math.round(n)

export function buildAccountOverview(rows: HoldingRow[], opts: { planKrPct: number | null } = { planKrPct: null }): AccountOverview {
  const byBucket = new Map<AssetBucket, { value: number; cost: number }>()
  const byAccount = new Map<string, { label: string; value: number; cost: number; buckets: Map<AssetBucket, number> }>()
  const missing = new Map<string, string>()
  let total = 0
  let cost = 0

  for (const r of rows) {
    const qty = Number(r.quantity || 0)
    if (!isRealRow(r) || !(qty > 0)) continue
    const code = String(r.code || '').trim()
    const name = String(r.stock_name || code)
    const bucket = classifyHolding(code, name, r.stock_product_type)
    const value = holdingValue(r)
    const rowCost = qty * Number(r.avg_price || 0)
    if (!(Number(r.stock?.close) > 0)) missing.set(code, name)

    total += value
    cost += rowCost
    const b = byBucket.get(bucket) ?? { value: 0, cost: 0 }
    byBucket.set(bucket, { value: b.value + value, cost: b.cost + rowCost })

    const key = holdingAccountKey(r)
    const a = byAccount.get(key) ?? { label: accountLabel(r.broker_name, r.account_name), value: 0, cost: 0, buckets: new Map() }
    a.value += value
    a.cost += rowCost
    a.buckets.set(bucket, (a.buckets.get(bucket) ?? 0) + value)
    byAccount.set(key, a)
  }

  const valueOf = (b: AssetBucket) => byBucket.get(b)?.value ?? 0
  const incomeValue = [...byBucket].filter(([b]) => BUCKET_GROUP[b] === 'income').reduce((s, [, x]) => s + x.value, 0)
  const growthValue = valueOf('kr_index') + valueOf('global_index')

  const noteFor = (bucket: AssetBucket, pct: number): string | null => {
    if (bucket === 'stock') {
      if (pct > SATELLITE_SELL_WEIGHT_PCT) return `상한 ${SATELLITE_MAX_WEIGHT_PCT}%·줄일 선 ${SATELLITE_SELL_WEIGHT_PCT}%를 넘었습니다`
      if (pct > SATELLITE_MAX_WEIGHT_PCT) return `상한 ${SATELLITE_MAX_WEIGHT_PCT}%를 넘었습니다 — 새 돈은 지수로`
      return null
    }
    if (bucket === 'covered_call' && incomeValue > 0) {
      const share = pctOf(valueOf('covered_call'), incomeValue)
      return share > COVERED_CALL_MAX_SHARE_PCT + 0.5 ? `인컴 중 ${round0(share)}% — 상한 33%라 더 사지 않습니다` : null
    }
    if (bucket === 'kr_index' && opts.planKrPct != null && growthValue > 0) {
      const share = pctOf(valueOf('kr_index'), growthValue)
      return Math.abs(share - opts.planKrPct) > REBALANCE_BAND_PP
        ? `지수 중 ${round0(share)}% — 내 계획 ${round0(opts.planKrPct)}%`
        : null
    }
    return null
  }

  const buckets: OverviewBucketRow[] = [...byBucket]
    .map(([bucket, x]) => {
      const pct = pctOf(x.value, total)
      return { bucket, label: BUCKET_LABEL[bucket], value: x.value, cost: x.cost, pct, returnPct: returnOf(x.value, x.cost), note: noteFor(bucket, pct) }
    })
    .sort((a, b) => b.value - a.value)

  const accounts: OverviewAccountRow[] = [...byAccount]
    .map(([key, a]) => {
      const [topBucket, topValue] = [...a.buckets].sort((x, y) => y[1] - x[1])[0]
      return { key, label: a.label, value: a.value, returnPct: returnOf(a.value, a.cost), topLabel: BUCKET_LABEL[topBucket], topPct: pctOf(topValue, a.value) }
    })
    .sort((a, b) => b.value - a.value)

  return {
    total,
    cost,
    returnPct: returnOf(total, cost),
    buckets,
    accounts,
    missingPrice: [...missing].map(([code, name]) => ({ code, name })),
  }
}
