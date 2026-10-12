import type { AutoPickItem, AutoPickTier, ReturnProfileKey, StockIndicators } from '../types'
import { isBuySignal } from './signal'

export function evaluateAutoPick(indicator: StockIndicators): { tier: AutoPickTier; coreMatchCount: number; edgeScore: number } | null {
  const score = Number(indicator.total_score ?? 0)
  const rsi = indicator.rsi14
  const signal = String(indicator.signal || '').toUpperCase()
  
  // 기본 필터: 강한 SELL만 제외
  if (signal.includes('STRONG_SELL')) return null
  
  // 핵심: RSI 범위를 현실적으로 완화 (하락장에서는 저RSI 회복이 일반적)
  const rsiIdeal = rsi != null && rsi >= 40 && rsi <= 70  // 45-65 대신 40-70
  const rsiGood = rsi != null && rsi >= 30 && rsi <= 75   // 40-70 대신 30-75
  const rsiBroad = rsi != null && rsi >= 20 && rsi <= 85  // 30-80 대신 20-85
  
  // 신호 품질
  const buyMatch = isBuySignal(indicator.signal)
  const notSellMatch = !signal.includes('SELL')
  
  // 점수 (선택적)
  const scoreMatch = score >= 50
  const scoreGood = score >= 35
  
  // 매칭 카운트: RSI는 거의 필수, 신호/점수는 추가 보너스
  let coreMatchCount = 0
  if (rsiIdeal) coreMatchCount += 2  // RSI 이상적이면 가중치 높음
  if (rsiGood && !rsiIdeal) coreMatchCount += 1
  if (buyMatch) coreMatchCount += 1
  if (scoreMatch) coreMatchCount += 1

  const warn = String(indicator.warn_grade || '').toUpperCase()

  let tier: AutoPickTier | null = null
  // 즉시 매수: RSI 이상적 + (BUY 또는 점수 50+)
  if (rsiIdeal && (buyMatch || scoreMatch)) {
    tier = 'now'
  // 반등 준비: RSI 좋음 + (점수 35+)
  } else if (rsiGood && scoreGood) {
    tier = 'prepare'
  // 관찰: RSI 넓은 범위 + SELL 신호 아님
  } else if (rsiBroad && notSellMatch) {
    tier = 'watch'
  }
  if (!tier) return null

  const scoreComponent = Math.max(0, Math.min(45, score - 40))
  const rsiCenterBonus = rsi == null ? 0 : Math.max(0, 14 - Math.abs(rsi - 55))
  const buyBonus = buyMatch ? 14 : 0
  const warnPenalty = warn === 'WARN' ? 18 : warn === 'WATCH' ? 8 : 0
  const edgeScore = scoreComponent + rsiCenterBonus + buyBonus + coreMatchCount * 7 - warnPenalty

  return { tier, coreMatchCount, edgeScore: Number(edgeScore.toFixed(1)) }
}


export function estimateExpectedReturnPct(input: {
  baseReturnPct: number
  coreMatchCount: number
  ruleMatched: boolean
  score: number
  shortMomentumPct: number
  tier: AutoPickTier
  profile: ReturnProfileKey
}): number {
  // 예전엔 "급등 종목들의 평균 수익(최소 5%)"에 등급·점수·모멘텀 가산 계수를 곱해 1.5~40%로 만들었다.
  // 급등한 종목만 모은 평균은 결과를 알고 고른 값이라 기대수익이 될 수 없다. 이제 규칙에 맞은 모든 과거 사례의
  // 평균(규칙 미충족이면 전체 사례 평균)을 그대로 쓴다. 가산 계수는 근거가 없어 쓰지 않는다.
  return Number(input.baseReturnPct.toFixed(1))
}


export function bucketAutoPicks(autoPicks: AutoPickItem[]) {
  return {
    now: autoPicks.filter((row) => row.tier === 'now'),
    prepare: autoPicks.filter((row) => row.tier === 'prepare'),
    watch: autoPicks.filter((row) => row.tier === 'watch'),
  }
}
