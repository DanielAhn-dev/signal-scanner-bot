/**
 * 따라 샀어요 결산 — 실계좌 체결을 봇 체결과 견줘 "가격 차이"와 "내 선택 차이"를 따로 보여 준다.
 *
 *   - 따라 한 거래: 실계좌 체결 메모에 봇 거래 번호(follow:<id>)가 붙은 것. 봇 가격으로 체결했다면 얼마였을지 계산한다.
 *   - 내 맘대로 한 거래: 봇 거래 번호가 없는 체결. 봇 가격이라는 기준이 없으므로 가격 차이는 0으로 두고 수익만 따로 센다.
 *   - 놓친 신호: 실계좌를 쓰기 시작한 뒤 봇이 샀는데 따라 하지 않은 매수. 지금까지의 등락률만 참고로 보여 준다.
 *
 * 수수료·세금은 빼고 체결 단가 기준으로만 계산한다(봇과 내 계좌의 수수료율이 달라 비교를 흐리지 않기 위해).
 * 체결 기록 구조는 기존 virtual_trades를 그대로 쓰고 따라 한 표시는 memo로 남긴다(DB 변경 없음).
 */

export type FollowTrade = {
  id: string | number
  code: string
  name?: string | null
  side: 'BUY' | 'SELL'
  price: number
  quantity: number
  tradedAt: string
  memo?: string | null
}

const FOLLOW_RE = /(?:^|\s)follow:([A-Za-z0-9_-]+)/

export function buildFollowMemo(botTradeId: string | number, note?: string): string {
  const base = `follow:${botTradeId}`
  const extra = (note ?? '').trim()
  return extra ? `${base} ${extra}` : base
}

export function parseFollowMemo(memo: string | null | undefined): string | null {
  const m = FOLLOW_RE.exec(String(memo ?? ''))
  return m ? m[1] : null
}

type Lot = { qty: number; price: number; botPrice: number | null; followed: boolean }

export type Chunk = {
  code: string
  name: string | null
  qty: number
  buyPrice: number
  sellPrice: number
  /** 따라 한 매수라면 봇 매수가, 아니면 내 체결가 */
  botBuyPrice: number
  botSellPrice: number
  /** 매수·매도 모두 따라 했는가 (아직 팔지 않은 보유분은 매수만 본다) */
  followed: boolean
  realized: boolean
  actualPnl: number
  botPricePnl: number
}

export type GroupSummary = {
  chunks: number
  invested: number
  actualPnl: number
  botPricePnl: number
  returnPct: number | null
}

export type SlippageRow = {
  tradeId: string | number
  code: string
  name: string | null
  side: 'BUY' | 'SELL'
  quantity: number
  botPrice: number
  fillPrice: number
  /** 내게 불리한 만큼 +: 매수는 더 비싸게, 매도는 더 싸게 체결 */
  worsePct: number
  /** 이 거래 하나로 봇 가격 대비 더 낸(+) 또는 덜 받은(+) 금액 */
  costAmount: number
}

export type MissedSignal = { botTradeId: string | number; code: string; name: string | null; botPrice: number; currentPrice: number | null; returnPct: number | null }

export type FollowComparison = {
  followed: GroupSummary
  own: GroupSummary
  /** 전체: 내 체결 그대로 vs 모든 거래를 봇 가격으로 체결했다면 */
  actualPnl: number
  botPricePnl: number
  /** 가격 차이 효과 = 실제 − 봇 가격 기준. 마이너스면 체결가 때문에 그만큼 손해 */
  priceEffect: number
  slippage: SlippageRow[]
  missed: MissedSignal[]
  missedAvgReturnPct: number | null
  unpriced: number
  followedTradeCount: number
  ownTradeCount: number
}

const round = (v: number) => Math.round(v)

function summarize(chunks: Chunk[]): GroupSummary {
  const invested = chunks.reduce((s, c) => s + c.buyPrice * c.qty, 0)
  const actualPnl = chunks.reduce((s, c) => s + c.actualPnl, 0)
  const botPricePnl = chunks.reduce((s, c) => s + c.botPricePnl, 0)
  return {
    chunks: chunks.length,
    invested: round(invested),
    actualPnl: round(actualPnl),
    botPricePnl: round(botPricePnl),
    returnPct: invested > 0 ? (actualPnl / invested) * 100 : null,
  }
}

export function compareFollow(input: {
  real: FollowTrade[]
  bot: FollowTrade[]
  /** 종목코드 → 현재가(보유분 평가·놓친 신호 등락률용) */
  prices: Record<string, number | undefined>
}): FollowComparison {
  const botById = new Map(input.bot.map((t) => [String(t.id), t]))
  const real = [...input.real].sort((a, b) => a.tradedAt.localeCompare(b.tradedAt))

  const slippage: SlippageRow[] = []
  const referenced = new Set<string>()
  const lotsByCode = new Map<string, Lot[]>()
  const chunks: Chunk[] = []
  const names = new Map<string, string | null>()
  let followedTradeCount = 0
  let ownTradeCount = 0

  for (const trade of real) {
    names.set(trade.code, trade.name ?? names.get(trade.code) ?? null)
    const refId = parseFollowMemo(trade.memo)
    const bot = refId ? botById.get(refId) : undefined
    const followed = !!bot && bot.code === trade.code && bot.side === trade.side
    if (followed && bot) {
      referenced.add(String(bot.id))
      followedTradeCount += 1
      const diff = trade.side === 'BUY' ? trade.price - bot.price : bot.price - trade.price
      slippage.push({
        tradeId: trade.id, code: trade.code, name: trade.name ?? null, side: trade.side, quantity: trade.quantity,
        botPrice: bot.price, fillPrice: trade.price,
        worsePct: bot.price > 0 ? (diff / bot.price) * 100 : 0,
        costAmount: round(diff * trade.quantity),
      })
    } else {
      ownTradeCount += 1
    }
    const botPrice = followed && bot ? bot.price : null

    const lots = lotsByCode.get(trade.code) ?? []
    if (trade.side === 'BUY') {
      lots.push({ qty: trade.quantity, price: trade.price, botPrice, followed })
      lotsByCode.set(trade.code, lots)
      continue
    }
    let left = trade.quantity
    while (left > 0 && lots.length > 0) {
      const lot = lots[0]
      const take = Math.min(lot.qty, left)
      const botBuy = lot.botPrice ?? lot.price
      const botSell = botPrice ?? trade.price
      chunks.push({
        code: trade.code, name: names.get(trade.code) ?? null, qty: take,
        buyPrice: lot.price, sellPrice: trade.price, botBuyPrice: botBuy, botSellPrice: botSell,
        followed: lot.followed && followed, realized: true,
        actualPnl: (trade.price - lot.price) * take,
        botPricePnl: (botSell - botBuy) * take,
      })
      lot.qty -= take
      left -= take
      if (lot.qty === 0) lots.shift()
    }
  }

  let unpriced = 0
  for (const [code, lots] of lotsByCode) {
    const now = input.prices[code]
    for (const lot of lots) {
      if (!(Number(now) > 0)) { unpriced += 1; continue }
      const botBuy = lot.botPrice ?? lot.price
      chunks.push({
        code, name: names.get(code) ?? null, qty: lot.qty,
        buyPrice: lot.price, sellPrice: Number(now), botBuyPrice: botBuy, botSellPrice: Number(now),
        followed: lot.followed, realized: false,
        actualPnl: (Number(now) - lot.price) * lot.qty,
        botPricePnl: (Number(now) - botBuy) * lot.qty,
      })
    }
  }

  const start = real.length > 0 ? real[0].tradedAt : null
  const missed: MissedSignal[] = start
    ? input.bot
        .filter((t) => t.side === 'BUY' && t.tradedAt >= start && !referenced.has(String(t.id)))
        .map((t) => {
          const now = Number(input.prices[t.code])
          return {
            botTradeId: t.id, code: t.code, name: t.name ?? null, botPrice: t.price,
            currentPrice: now > 0 ? now : null,
            returnPct: now > 0 && t.price > 0 ? ((now - t.price) / t.price) * 100 : null,
          }
        })
    : []
  const priced = missed.filter((m) => m.returnPct != null)

  const followedChunks = chunks.filter((c) => c.followed)
  const ownChunks = chunks.filter((c) => !c.followed)
  const actualPnl = round(chunks.reduce((s, c) => s + c.actualPnl, 0))
  const botPricePnl = round(chunks.reduce((s, c) => s + c.botPricePnl, 0))

  return {
    followed: summarize(followedChunks),
    own: summarize(ownChunks),
    actualPnl,
    botPricePnl,
    priceEffect: actualPnl - botPricePnl,
    slippage,
    missed,
    missedAvgReturnPct: priced.length > 0 ? priced.reduce((s, m) => s + (m.returnPct as number), 0) / priced.length : null,
    unpriced,
    followedTradeCount,
    ownTradeCount,
  }
}
