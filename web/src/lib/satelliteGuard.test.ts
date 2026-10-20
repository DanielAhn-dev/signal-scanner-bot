import { describe, expect, it } from 'vitest'
import { satelliteStatus } from './satelliteGuard'

const etf = (value: number) => ({ code: '069500', name: 'KODEX 200', quantity: 1, avgPrice: value, currentPrice: value })
const stock = (avg: number, cur: number) => ({ code: '007660', name: '이수페타시스', quantity: 1, avgPrice: avg, currentPrice: cur })

describe('satelliteStatus', () => {
  it('서버 상품 유형이 있으면 이름보다 먼저 — 브랜드 목록에 없는 새 운용사 ETF도 지수 쪽으로 센다', () => {
    const newBrandEtf = { code: '999990', name: '새운용 코스피200', quantity: 1, avgPrice: 900, currentPrice: 900, productType: 'etf' }
    expect(satelliteStatus([newBrandEtf, stock(100, 100)])!.weightPct).toBeCloseTo(10)
    // 상품 유형을 모르면 이름으로 판정해 개별주로 센다
    expect(satelliteStatus([{ ...newBrandEtf, productType: null }, stock(100, 100)])!.weightPct).toBeCloseTo(100)
  })

  it('개별주가 없으면 null', () => {
    expect(satelliteStatus([etf(1000)])).toBeNull()
    expect(satelliteStatus([])).toBeNull()
  })

  it('개별주 비중 10% 이하면 경고 없음', () => {
    const s = satelliteStatus([etf(900), stock(100, 100)])!
    expect(s.weightPct).toBeCloseTo(10)
    expect(s.overWeight).toBe(false)
    expect(s.trimAmount).toBe(0)
  })

  it('10~20%는 팔지 않는다 — 추가매수만 멈추고 새 돈은 지수로', () => {
    const s = satelliteStatus([etf(800), stock(200, 200)])!
    expect(s.weightPct).toBeCloseTo(20)
    expect(s.overWeight).toBe(true)
    expect(s.overSellBand).toBe(false)
    expect(s.trimAmount).toBe(0)
  })

  it('20%를 넘으면 목표 10%까지 줄일 금액을 낸다', () => {
    const s = satelliteStatus([etf(700), stock(300, 300)])!
    expect(s.overWeight).toBe(true)
    expect(s.overSellBand).toBe(true)
    // 300 - x = 0.1 × (1000 - x) → x = 222
    expect(s.trimAmount).toBe(222)
  })

  it('개별주 묶음 평가손실 -15% 이하면 손실 한도 경고', () => {
    expect(satelliteStatus([etf(900), stock(100, 85)])!.overLoss).toBe(true)
    expect(satelliteStatus([etf(900), stock(100, 86)])!.overLoss).toBe(false)
  })

  it('현재가가 없으면 평단으로 평가', () => {
    const s = satelliteStatus([etf(900), { ...stock(100, 0) }])!
    expect(s.pnlPct).toBe(0)
  })
})
