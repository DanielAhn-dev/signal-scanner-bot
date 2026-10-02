import { KODEX200_DAILY_CLOSE, KODEX200_DAILY_DATES } from '../data/behaviorData'

export type GapMode = 'lump' | 'dca'
export type Reentry = 'months6' | 'rebound' | 'recover'

export type GapParams = {
  mode: GapMode
  years: number
  /** 고점 대비 이만큼 떨어지면 판다 (0.2 = -20%) */
  trigger: number
  reentry: Reentry
  /** 팔고 있는 동안 현금의 연 수익률 */
  cashAnnual: number
}

export type GapSummary = {
  starts: number
  /** 실제로 팔게 된 시작점 수 */
  touched: number
  hold: { median: number; p10: number }
  sell: { median: number; p10: number }
  /** 판 쪽이 보유보다 나았던 비율(0~1) */
  sellWins: number
  /** 판 쪽/보유 비율의 최악·최고와 그 시작월 */
  worstRatio: number
  bestRatio: number
  worstStart: string
  bestStart: string
}

const REBOUND = 0.2
/** "6개월 뒤" 재매수 = 거래일 125일 */
const OUT_DAYS = 125
const TRADING_DAYS_PER_YEAR = 250

/**
 * 한 시작점에서 보유와 "기계적으로 팔고 다시 산 사람"의 최종 배율.
 * 판정은 종가로 하고 체결은 다음 거래일 종가다. 한 번에 투자(lump)는 시작 가치 1 대비 배율,
 * 적립(dca)은 매월 첫 거래일에 1씩 넣은 총납입 대비 배율이다. 팔고 있는 동안 납입금은 현금으로 쌓았다가 재매수 때 한 번에 넣는다.
 * 비용·세금은 넣지 않았다(넣으면 판 쪽이 더 불리).
 */
export function simulateGap(
  close: number[],
  dates: string[],
  i0: number,
  p: GapParams,
): { hold: number; sell: number; sold: boolean } | null {
  const i1 = i0 + Math.round(p.years * TRADING_DAYS_PER_YEAR)
  if (i1 >= close.length) return null
  const cd = (1 + p.cashAnnual) ** (1 / TRADING_DAYS_PER_YEAR) - 1
  let holdShares = 0
  let shares = 0
  let cash = 0
  let paid = 0
  let inMarket = true
  let peak = close[i0]
  let low = 0
  let priorPeak = 0
  let soldAt = 0
  let sold = false
  let pending: 'sell' | 'buy' | null = null
  for (let i = i0; i <= i1; i++) {
    if (i > i0) cash *= 1 + cd
    const monthStart = i === i0 || dates[i].slice(0, 6) !== dates[i - 1].slice(0, 6)
    if (p.mode === 'dca' ? monthStart : i === i0) {
      paid += 1
      holdShares += 1 / close[i]
      if (inMarket) shares += 1 / close[i]
      else cash += 1
    }
    if (pending === 'sell') {
      cash += shares * close[i]
      shares = 0
      inMarket = false
      sold = true
      low = close[i]
      soldAt = i
      pending = null
      continue
    }
    if (pending === 'buy') {
      shares += cash / close[i]
      cash = 0
      inMarket = true
      peak = close[i]
      pending = null
      continue
    }
    if (inMarket) {
      peak = Math.max(peak, close[i])
      if (close[i] / peak - 1 <= -p.trigger && i < i1) {
        priorPeak = peak
        pending = 'sell'
      }
    } else {
      low = Math.min(low, close[i])
      const back =
        p.reentry === 'months6' ? i - soldAt >= OUT_DAYS
          : p.reentry === 'rebound' ? close[i] / low - 1 >= REBOUND
            : close[i] >= priorPeak
      if (back && i < i1) pending = 'buy'
    }
  }
  return { hold: (holdShares * close[i1]) / paid, sell: (shares * close[i1] + cash) / paid, sold }
}

const q = (sorted: number[], f: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * f))]

/** 모든 월의 첫 거래일을 시작점으로 삼아, 실제로 팔게 된 시작점들의 결과를 모은다. */
export function summarizeGap(
  p: GapParams,
  close: number[] = KODEX200_DAILY_CLOSE,
  dates: string[] = KODEX200_DAILY_DATES,
): GapSummary | null {
  const rows: Array<{ ym: string; hold: number; sell: number }> = []
  let starts = 0
  for (let i0 = 0; i0 < close.length; i0++) {
    if (!(i0 === 0 || dates[i0].slice(0, 6) !== dates[i0 - 1].slice(0, 6))) continue
    const r = simulateGap(close, dates, i0, p)
    if (!r) continue
    starts += 1
    if (r.sold) rows.push({ ym: dates[i0].slice(0, 6), hold: r.hold, sell: r.sell })
  }
  if (!rows.length) return null
  const holds = rows.map((r) => r.hold).sort((a, b) => a - b)
  const sells = rows.map((r) => r.sell).sort((a, b) => a - b)
  const ratios = rows.map((r) => ({ ym: r.ym, v: r.sell / r.hold })).sort((a, b) => a.v - b.v)
  return {
    starts, touched: rows.length,
    hold: { median: q(holds, 0.5), p10: q(holds, 0.1) },
    sell: { median: q(sells, 0.5), p10: q(sells, 0.1) },
    sellWins: rows.filter((r) => r.sell > r.hold).length / rows.length,
    worstRatio: ratios[0].v, bestRatio: ratios[ratios.length - 1].v,
    worstStart: ratios[0].ym, bestStart: ratios[ratios.length - 1].ym,
  }
}
