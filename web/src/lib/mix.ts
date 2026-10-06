import { MIX_ASSETS, type MixAsset } from '../data/mixData'

export type Weights = Record<string, number>
export type Rebalance = 'month' | 'year' | 'none'

export type MixResult = {
  from: string
  to: string
  months: number
  /** 월별 평가금(시작=1) */
  curve: number[]
  yms: string[]
  cagr: number
  mdd: number
  /** 어떤 1년을 잡아도 이만큼은 잃었다 */
  worstYear: number
  /** 5년 보유 롤링 연환산 수익률: 최저 / 하위10% / 중앙 */
  rolling5: { min: number; p10: number; median: number } | null
}

const COST_PER_TURNOVER = 0.001

export const MIX_PRESETS: Array<{ key: string; label: string; weights: Weights; note: string }> = [
  { key: 'kospi', label: '코스피200만', weights: { kospi200: 100 }, note: '기준선' },
  { key: 'kospi-bond', label: '코스피200 60 · 국고채 40', weights: { kospi200: 60, kbond10: 40 }, note: '국내 자산만 섞은 안정형' },
  { key: 'domestic-aw', label: '코스피200 40 · 국고채 40 · 금 20', weights: { kospi200: 40, kbond10: 40, gold: 20 }, note: '국내형 올웨더 근사' },
  { key: 'mix4', label: '코스피 30 · 나스닥 30 · 국고채 25 · 금 15', weights: { kospi200: 30, nasdaq100: 30, kbond10: 25, gold: 15 }, note: '한국 상장 4종' },
  { key: 'half', label: '코스피200 50 · 나스닥100 50', weights: { kospi200: 50, nasdaq100: 50 }, note: '주식만 반반' },
  { key: 'nps', label: '국민연금형(근사) 코스피200 20.8 · S&P500 34.7 · 국고채 23.1 · 미국장기채 7.4', weights: { kospi200: 20.8, sp500: 34.7, kbond10: 23.1, usbond20: 7.4 }, note: '2026년 목표 비중 중 대체투자(약 14%)는 뺀 근사. 채권 만기·환헤지는 실제와 다름' },
  { key: 'us-aw', label: '미국 올웨더 근사', weights: { sp500: 30, usbond20: 55, gold: 15 }, note: '주식 30 · 장기채 55 · 금 15 (원자재 제외)' },
]

export function normalize(w: Weights): Weights {
  const total = Object.values(w).reduce((s, v) => s + Math.max(0, v), 0)
  if (total <= 0) return {}
  const out: Weights = {}
  for (const [k, v] of Object.entries(w)) if (v > 0) out[k] = v / total
  return out
}

function monthlyReturns(asset: MixAsset): Map<string, number> {
  const out = new Map<string, number>()
  const drag = asset.dragPct / 100 / 12
  for (let i = 1; i < asset.monthly.length; i++) {
    out.set(asset.monthly[i][0], asset.monthly[i][1] / asset.monthly[i - 1][1] - 1 - drag)
  }
  return out
}

/** 비중>0인 자산이 모두 있는 달만 쓴다. 그래서 가장 짧은 이력이 전체 기간을 정한다. */
export function simulateMix(weights: Weights, rebalance: Rebalance, assets: MixAsset[] = MIX_ASSETS): MixResult | null {
  const w = normalize(weights)
  const ids = Object.keys(w)
  if (!ids.length) return null
  const rets = ids.map((id) => {
    const a = assets.find((x) => x.id === id)
    return a ? monthlyReturns(a) : null
  })
  if (rets.some((r) => !r)) return null
  const months = [...(rets[0] as Map<string, number>).keys()].filter((ym) => rets.every((r) => (r as Map<string, number>).has(ym))).sort()
  if (months.length < 12) return null
  const target = ids.map((id) => w[id])
  let cur = [...target]
  let value = 1
  const curve = [1]
  for (let i = 0; i < months.length; i++) {
    const ym = months[i]
    const grown = cur.map((c, k) => c * (1 + (rets[k] as Map<string, number>).get(ym)!))
    const sum = grown.reduce((s, v) => s + v, 0)
    value *= sum
    cur = grown.map((g) => g / sum)
    const lastOfYear = i === months.length - 1 || months[i + 1].slice(0, 4) !== ym.slice(0, 4)
    if (rebalance === 'month' || (rebalance === 'year' && lastOfYear)) {
      const turn = cur.reduce((s, c, k) => s + Math.abs(c - target[k]), 0)
      value *= 1 - turn * COST_PER_TURNOVER
      cur = [...target]
    }
    curve.push(value)
  }
  const years = months.length / 12
  let peak = 1
  let mdd = 0
  for (const v of curve) { peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1) }
  let worstYear = Infinity
  for (let i = 12; i < curve.length; i++) worstYear = Math.min(worstYear, curve[i] / curve[i - 12] - 1)
  let rolling5: MixResult['rolling5'] = null
  if (curve.length > 61) {
    const vals: number[] = []
    for (let i = 60; i < curve.length; i++) vals.push((curve[i] / curve[i - 60]) ** (1 / 5) - 1)
    vals.sort((a, b) => a - b)
    rolling5 = { min: vals[0], p10: vals[Math.floor(vals.length * 0.1)], median: vals[Math.floor(vals.length / 2)] }
  }
  return {
    from: months[0], to: months[months.length - 1], months: months.length, curve, yms: ['', ...months],
    cagr: curve[curve.length - 1] ** (1 / years) - 1, mdd, worstYear: Number.isFinite(worstYear) ? worstYear : 0, rolling5,
  }
}

export function fmtYm(ym: string): string {
  return `${ym.slice(0, 4)}-${ym.slice(4)}`
}

export type AssetClass = 'equity' | 'bond' | 'gold'
export const ASSET_CLASS: Record<string, AssetClass> = {
  kospi200: 'equity', nasdaq100: 'equity', sp500: 'equity', kbond10: 'bond', usbond20: 'bond', gold: 'gold',
}
/** 자산군별 충격(소수, 예: -0.4). 비중 큰 자산에도 같은 충격을 준다 — 개별 차이는 모른다고 가정 */
export type Shocks = Record<AssetClass, number>

export const STRESS_PRESETS: Array<{ key: string; label: string; note: string; shocks: Shocks }> = [
  { key: 'crash', label: '일반 폭락', note: '주식만 -40%, 채권·금은 제자리', shocks: { equity: -0.4, bond: 0, gold: 0 } },
  { key: 'rate', label: '금리 급등형', note: '주식 -25%, 채권 -20% (2022년처럼 같이 하락)', shocks: { equity: -0.25, bond: -0.2, gold: 0 } },
  { key: 'stagflation', label: '인플레 충격형', note: '주식 -35%, 채권 -15%, 금 +10%', shocks: { equity: -0.35, bond: -0.15, gold: 0.1 } },
  { key: 'severe', label: '최악 가정', note: '주식 -55%, 채권 -10%, 금 -10%', shocks: { equity: -0.55, bond: -0.1, gold: -0.1 } },
]

export type StressResult = {
  /** 이 충격에서 내 조합의 손실(음수) */
  loss: number
  /** 같은 충격에서 주식(코스피200)만 가졌을 때 */
  equityOnly: number
  /** 원금으로 돌아오는 데 필요한 수익률 */
  recoveryNeeded: number
  /** 감내 손실 안에 들어오려면 주식군 비중의 상한(0~1). 방어 자산의 내부 비율은 그대로 */
  maxEquityShare: number | null
  equityShare: number
}

export function stressTest(weights: Weights, shocks: Shocks, tolerance: number): StressResult | null {
  const w = normalize(weights)
  const ids = Object.keys(w)
  if (!ids.length) return null
  let loss = 0
  let eqW = 0, eqLoss = 0, otherW = 0, otherLoss = 0
  for (const id of ids) {
    const cls = ASSET_CLASS[id]
    const s = shocks[cls]
    loss += w[id] * s
    if (cls === 'equity') { eqW += w[id]; eqLoss += w[id] * s } else { otherW += w[id]; otherLoss += w[id] * s }
  }
  // 주식군 평균 충격 eAvg, 나머지 oAvg: 비중 t일 때 손실 = t*eAvg + (1-t)*oAvg
  const eAvg = eqW > 0 ? eqLoss / eqW : shocks.equity
  const oAvg = otherW > 0 ? otherLoss / otherW : null
  let maxEquityShare: number | null = null
  if (eqW > 0 && eAvg < 0) {
    if (oAvg == null) maxEquityShare = Math.min(1, -tolerance / eAvg) // 방어 자산이 없으면 현금(0%)을 가정
    else if (oAvg >= eAvg) {
      const t = (-tolerance - oAvg) / (eAvg - oAvg)
      maxEquityShare = Math.max(0, Math.min(1, t))
    }
  }
  return {
    loss, equityOnly: shocks.equity, recoveryNeeded: loss < 0 ? 1 / (1 + loss) - 1 : 0,
    maxEquityShare, equityShare: eqW,
  }
}
