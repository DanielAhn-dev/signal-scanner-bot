/**
 * 실계좌 종목을 마지막 매수 뒤에 일부(또는 전부) 판 적이 있는가 — 보유 카드 "+20%면 절반을 지수로"(C54)를
 * 이미 따른 종목에 같은 안내를 반복하지 않기 위해 쓴다.
 *
 * 매도로 보는 것: SELL, 그리고 웹 보유 수정(ADJUST, memo `web-edit: 10@… → 5@…`)으로 수량을 줄인 기록.
 * 마지막 매수(BUY 또는 수량을 늘린 ADJUST)가 그 뒤에 있으면 새로 산 것으로 보고 false.
 */
export type TrimTradeRow = {
  side: string
  traded_at?: string | null
  created_at?: string | null
  memo?: string | null
}

const ADJUST_QTY = /web-edit:\s*(\d+)@[^→]*→\s*(\d+)@/

function kind(row: TrimTradeRow): 'buy' | 'sell' | null {
  const side = String(row.side || '').toUpperCase()
  if (side === 'BUY') return 'buy'
  if (side === 'SELL') return 'sell'
  if (side === 'ADJUST') {
    const m = String(row.memo || '').match(ADJUST_QTY)
    if (!m) return null
    const before = Number(m[1])
    const after = Number(m[2])
    if (after < before) return 'sell'
    if (after > before) return 'buy'
  }
  return null
}

function timeOf(row: TrimTradeRow): number {
  const t = Date.parse(String(row.traded_at || row.created_at || ''))
  return Number.isFinite(t) ? t : NaN
}

export function trimmedSinceLastBuy(rows: TrimTradeRow[]): boolean {
  let lastBuy = -Infinity
  let lastSell = -Infinity
  for (const row of rows) {
    const k = kind(row)
    const t = timeOf(row)
    if (!k || !Number.isFinite(t)) continue
    if (k === 'buy') lastBuy = Math.max(lastBuy, t)
    else lastSell = Math.max(lastSell, t)
  }
  return lastSell > lastBuy
}
