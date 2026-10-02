/**
 * 실계좌 보유 종목 대응 — 사용자가 직접 산 개별 종목을 막을 순 없으니, 샀다면 그 종목마다 할 일을 한 줄로 알려준다.
 * 종목이 오를지는 판단하지 않는다(종목 선별에는 우위가 없었다). 비중·손익·세금 비용만 근거로 삼는다.
 * 단일 종목 비중 한도(안전형 5% · 균형형 10%)는 검증값이 아니라 보수적 가정이다.
 */
import { INDEX_ETF_CODES } from './indexEtf'

export type Holding = { code: string; name: string; quantity: number; avgPrice: number; currentPrice: number }
export type AdviceAction = 'keep' | 'trim' | 'redirect'
export type HoldingAdvice = {
  code: string; name: string; weightPct: number; pnlPct: number; action: AdviceAction
  headline: string; detail: string; trimAmount: number
}

export const SINGLE_STOCK_LIMIT_PCT = { safe: 5, balanced: 10 } as const
const LOSS_REDIRECT_PCT = -15
const GAIN_REVIEW_PCT = 30

const won = (v: number) => `${Math.round(v).toLocaleString('ko-KR')}원`

export function adviseHoldings(input: {
  holdings: Holding[]
  level: 'safe' | 'balanced'
  /** 종목을 팔 때 드는 비용(%) — 수수료·거래세 */
  sellCostPct: (code: string) => number
}): HoldingAdvice[] {
  const rows = input.holdings.filter((h) => h.quantity > 0 && h.currentPrice > 0 && h.avgPrice > 0)
  const total = rows.reduce((a, h) => a + h.quantity * h.currentPrice, 0)
  if (!(total > 0)) return []
  const limit = SINGLE_STOCK_LIMIT_PCT[input.level]

  return rows.map((h): HoldingAdvice => {
    const value = h.quantity * h.currentPrice
    const weightPct = (value / total) * 100
    const pnlPct = (h.currentPrice / h.avgPrice - 1) * 100
    const base = { code: h.code, name: h.name, weightPct, pnlPct, trimAmount: 0 }

    if (INDEX_ETF_CODES.includes(h.code)) {
      return { ...base, action: 'keep', headline: '그대로 보유', detail: '지수 ETF는 팔지 않고 계속 들고 갑니다. 이번 달 적립도 여기에 넣으세요.' }
    }
    if (weightPct > limit) {
      const trimAmount = Math.round(((weightPct - limit) / 100) * total)
      const cost = trimAmount * (input.sellCostPct(h.code) / 100)
      const gain = pnlPct >= GAIN_REVIEW_PCT ? ` 평단보다 ${pnlPct.toFixed(0)}% 오른 구간이라 비싸게 들고 있는 셈입니다.` : ''
      return {
        ...base, action: 'trim', trimAmount,
        headline: `${won(trimAmount)}어치 줄여 KODEX 200으로`,
        detail: `한 종목이 계좌의 ${weightPct.toFixed(0)}%라 한도(${limit}%)를 넘습니다.${gain} 팔 때 비용은 약 ${won(cost)}으로 추정합니다.`,
      }
    }
    if (pnlPct <= LOSS_REDIRECT_PCT) {
      return {
        ...base, action: 'redirect',
        headline: '지금 팔지 말고 추가 매수만 멈추기',
        detail: `평단보다 ${Math.abs(pnlPct).toFixed(0)}% 내려 있어 팔면 손실이 확정됩니다. 물타기 대신 이번 달 적립은 KODEX 200에 넣고, 이 종목은 반등을 기다릴지 정리할지 정해 두세요.`,
      }
    }
    return {
      ...base, action: 'keep',
      headline: '보유하되 추가 매수는 지수로',
      detail: `비중 ${weightPct.toFixed(0)}%로 한도 안입니다. 새로 넣을 돈은 이 종목이 아니라 KODEX 200에 넣으세요.`,
    }
  }).sort((a, b) => b.weightPct - a.weightPct)
}
