import { describe, expect, it } from 'vitest'
import { buildFollowMemo, compareFollow, parseFollowMemo, type FollowTrade } from '../src/services/followReport'

const bot = (id: number, side: 'BUY' | 'SELL', price: number, day: string, code = '069500'): FollowTrade =>
  ({ id, code, name: 'KODEX 200', side, price, quantity: 10, tradedAt: `2026-10-${day}T01:00:00Z` })
const mine = (id: number, side: 'BUY' | 'SELL', price: number, day: string, qty: number, memo: string | null, code = '069500'): FollowTrade =>
  ({ id, code, name: 'KODEX 200', side, price, quantity: qty, tradedAt: `2026-10-${day}T02:00:00Z`, memo })

describe('따라 샀어요 결산', () => {
  it('따라 한 표시를 메모로 만들고 읽는다', () => {
    expect(buildFollowMemo(12)).toBe('follow:12')
    expect(parseFollowMemo(buildFollowMemo(12, '장 마감 직전'))).toBe('12')
    expect(parseFollowMemo('web-edit')).toBeNull()
    expect(parseFollowMemo(null)).toBeNull()
  })

  it('따라 샀는데 더 비싸게 체결되면 가격 차이만큼 손해로 잡는다', () => {
    const r = compareFollow({
      bot: [bot(1, 'BUY', 10_000, '01')],
      real: [mine(100, 'BUY', 10_100, '01', 10, 'follow:1')],
      prices: { '069500': 11_000 },
    })
    expect(r.slippage[0]).toMatchObject({ botPrice: 10_000, fillPrice: 10_100, costAmount: 1_000 })
    expect(r.slippage[0].worsePct).toBeCloseTo(1, 5)
    expect(r.actualPnl).toBe((11_000 - 10_100) * 10)
    expect(r.botPricePnl).toBe((11_000 - 10_000) * 10)
    expect(r.priceEffect).toBe(-1_000)
    expect(r.followed.chunks).toBe(1)
    expect(r.own.chunks).toBe(0)
  })

  it('매도는 봇보다 싸게 팔면 불리하고, 둘 다 따라 한 왕복은 실현 손익으로 비교한다', () => {
    const r = compareFollow({
      bot: [bot(1, 'BUY', 10_000, '01'), bot(2, 'SELL', 11_000, '05')],
      real: [mine(100, 'BUY', 10_050, '01', 10, 'follow:1'), mine(101, 'SELL', 10_900, '05', 10, 'follow:2')],
      prices: {},
    })
    expect(r.slippage.find((s) => s.side === 'SELL')).toMatchObject({ costAmount: 1_000 })
    expect(r.actualPnl).toBe((10_900 - 10_050) * 10)
    expect(r.botPricePnl).toBe((11_000 - 10_000) * 10)
    expect(r.followed.returnPct).toBeCloseTo(((10_900 - 10_050) / 10_050) * 100, 5)
  })

  it('봇 거래 번호가 없는 체결은 내 맘대로로 따로 세고 가격 차이는 0이다', () => {
    const r = compareFollow({
      bot: [],
      real: [mine(200, 'BUY', 5_000, '02', 4, null, '005930')],
      prices: { '005930': 4_500 },
    })
    expect(r.ownTradeCount).toBe(1)
    expect(r.own.actualPnl).toBe(-2_000)
    expect(r.priceEffect).toBe(0)
    expect(r.followed.chunks).toBe(0)
  })

  it('따라 산 뒤 내 맘대로 판 왕복은 따라 한 거래가 아니라 내 맘대로로 센다', () => {
    const r = compareFollow({
      bot: [bot(1, 'BUY', 10_000, '01')],
      real: [mine(100, 'BUY', 10_000, '01', 10, 'follow:1'), mine(101, 'SELL', 9_000, '03', 10, null)],
      prices: {},
    })
    expect(r.followed.chunks).toBe(0)
    expect(r.own.actualPnl).toBe(-10_000)
  })

  it('봇이 샀는데 따라 하지 않은 매수는 놓친 신호로 등락률을 보여 준다', () => {
    const r = compareFollow({
      bot: [bot(1, 'BUY', 10_000, '01'), bot(2, 'BUY', 20_000, '02', '005930')],
      real: [mine(100, 'BUY', 10_000, '01', 10, 'follow:1')],
      prices: { '069500': 11_000, '005930': 22_000 },
    })
    expect(r.missed).toHaveLength(1)
    expect(r.missed[0].code).toBe('005930')
    expect(r.missedAvgReturnPct).toBeCloseTo(10, 5)
  })

  it('수량이 일부만 팔리면 선입선출로 나누고 현재가 없는 보유분은 평가에서 뺀다', () => {
    const r = compareFollow({
      bot: [],
      real: [mine(1, 'BUY', 100, '01', 10, null), mine(2, 'BUY', 120, '02', 10, null), mine(3, 'SELL', 130, '03', 15, null)],
      prices: {},
    })
    expect(r.own.actualPnl).toBe((130 - 100) * 10 + (130 - 120) * 5)
    expect(r.unpriced).toBe(1)
  })
})

describe('체결 알림 푸시 경로', () => {
  it('자동사이클 체결 알림만 따라 사기로 연결한다', async () => {
    const { pushPathForText } = await import('../src/services/webPush')
    expect(pushPathForText('[자동사이클 체결 알림] 일일 대응\n매수 1건')).toBe('/follow')
    expect(pushPathForText('시장 요약')).toBeUndefined()
  })
})
