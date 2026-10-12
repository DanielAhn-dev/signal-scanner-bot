import type { OhlcvCandle } from '../../../lib/types'

/** 서버 series를 OhlcvCandle로 정규화: 날짜 없음·비정상 가격·고저 불일치 행은 버리고 날짜순 정렬 */
export function normalizeCandles(rawData: any[]): OhlcvCandle[] {
  return rawData
    .map((r: any) => ({
      date: String(r.date || r.Date || ''),
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume ?? 0),
    }))
    .filter((c) => {
      if (!c.date) return false
      if (![c.open, c.high, c.low, c.close].every(Number.isFinite)) return false
      if (c.open <= 0 || c.high <= 0 || c.low <= 0 || c.close <= 0) return false
      return c.high >= Math.max(c.open, c.close, c.low) && c.low <= Math.min(c.open, c.close, c.high)
    })
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** 최근 20봉 기준 지지(최저 저가)·저항(최고 고가) */
export function calcChartHud(candles: OhlcvCandle[]) {
  if (!candles.length) {
    return {
      support: null as number | null,
      resistance: null as number | null,
    }
  }

  const recent = [...candles].sort((a, b) => a.date.localeCompare(b.date)).slice(-20)
  const lows = recent.map((c) => Number(c.low)).filter((v) => Number.isFinite(v))
  const highs = recent.map((c) => Number(c.high)).filter((v) => Number.isFinite(v))

  return {
    support: lows.length ? Math.min(...lows) : null,
    resistance: highs.length ? Math.max(...highs) : null,
  }
}
