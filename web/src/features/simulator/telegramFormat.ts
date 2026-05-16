import { formatKrw, formatNumber } from '../../lib/format'
import type { HighlightPlanItem } from './planStore'

export type TelegramFormat = 'simple' | 'detailed'

export function clampPercent(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min
  if (value < min) return min
  if (value > max) return max
  return value
}

export function calcExpectedValue(item: HighlightPlanItem) {
  const invested = item.amount
  const targetProfit = invested * (item.targetPct / 100)
  const stopLoss = invested * (item.stopPct / 100)
  return invested > 0
    ? targetProfit * (item.winProb / 100) - stopLoss * (1 - item.winProb / 100)
    : 0
}

export function calcSplitInvested(item: HighlightPlanItem, fillRatePct: number) {
  const splitRatio = (item.split1 + item.split2 + item.split3) / 100
  const fillRatio = clampPercent(fillRatePct, 0, 100) / 100
  return item.amount * splitRatio * fillRatio
}

/** 리스크/리워드 비율 (목표 / 손절) */
export function calcRR(item: HighlightPlanItem): number {
  if (item.stopPct <= 0) return 0
  return item.targetPct / item.stopPct
}

/**
 * 켈리 기준 추천 투자 비율 (%)
 * f* = W - (1-W)/R, R = 목표/손절
 * 보수적 적용을 위해 절반 켈리(half-kelly)로 계산, 최대 25% 캡
 */
export function calcKelly(item: HighlightPlanItem): number {
  const w = item.winProb / 100
  const rr = calcRR(item)
  if (rr <= 0 || w <= 0) return 0
  const fullKelly = w - (1 - w) / rr
  const halfKelly = fullKelly * 0.5
  return Math.max(0, Math.min(25, halfKelly * 100))
}

export type TradeGrade = 'A' | 'B' | 'C' | 'D'

/** 거래 품질 등급 — R:R + 승률 + 기대값 기반 */
export function getTradeGrade(item: HighlightPlanItem): TradeGrade {
  const rr = calcRR(item)
  const w = item.winProb / 100
  const ev = calcExpectedValue(item)
  if (ev <= 0) return 'D'
  if (rr >= 2.5 && w >= 0.58) return 'A'
  if (rr >= 2.0 && w >= 0.52) return 'B'
  if (rr >= 1.5 && ev > 0) return 'C'
  return 'D'
}

/** 전 종목 손절 시 최대 손실 금액 (음수 반환) */
export function calcMaxPortfolioLoss(items: HighlightPlanItem[]): number {
  return -items.reduce((acc, item) => acc + item.amount * (item.stopPct / 100), 0)
}

/** 특정 등락률 시나리오의 순수익 계산 */
export function calcScenarioNet(
  items: HighlightPlanItem[],
  changePct: number,
  fillRatePct: number,
  feePct: number,
  taxPct: number,
): number {
  return items.reduce((acc, item) => {
    const invested = calcSplitInvested(item, fillRatePct)
    const gross = invested * (changePct / 100)
    const fee = invested * (feePct / 100)
    const tax = changePct > 0 ? gross * (taxPct / 100) : 0
    return acc + gross - fee - tax
  }, 0)
}

export function buildTelegramMessage(params: {
  totalCapital: number
  fillRatePct: number
  feePct: number
  taxPct: number
  expectedAfterCost: number
  remaining: number
  items: HighlightPlanItem[]
  format: TelegramFormat
}) {
  if (params.format === 'simple') {
    const lines = [
      '[시뮬레이터 간단 요약]',
      `총 ${formatKrw(params.totalCapital)} · 기대손익 ${params.expectedAfterCost >= 0 ? '+' : ''}${formatKrw(params.expectedAfterCost)}`,
      '',
    ]
    for (const row of params.items.slice(0, 10)) {
      const ev = calcExpectedValue(row)
      lines.push(`- ${row.name || row.code} ${formatKrw(row.amount)} (${ev >= 0 ? '+' : ''}${formatKrw(ev)})`)
    }
    return lines.join('\n')
  }

  // detailed
  const lines = [
    '[웹 시뮬레이터 상세 계획]',
    `총 투자금: ${formatKrw(params.totalCapital)}`,
    `체결률: ${formatNumber(params.fillRatePct, 0)}% · 비용 ${formatNumber(params.feePct, 2)}% · 세금 ${formatNumber(params.taxPct, 2)}%`,
    `기대손익(비용차감): ${params.expectedAfterCost >= 0 ? '+' : ''}${formatKrw(params.expectedAfterCost)}`,
    `잔여/초과: ${params.remaining >= 0 ? '+' : ''}${formatKrw(params.remaining)}`,
    '',
    '종목별 집행안',
  ]
  for (const row of params.items.slice(0, 10)) {
    const ev = calcExpectedValue(row)
    lines.push(
      `- ${row.name || row.code}(${row.code}) ${formatKrw(row.amount)} | 목표 ${formatNumber(row.targetPct, 1)}% / 손절 ${formatNumber(row.stopPct, 1)}% / 승률 ${formatNumber(row.winProb, 0)}%`,
    )
    lines.push(
      `  분할 ${formatNumber(row.split1, 0)}/${formatNumber(row.split2, 0)}/${formatNumber(row.split3, 0)}% · 기대손익 ${ev >= 0 ? '+' : ''}${formatKrw(ev)}`,
    )
  }
  return lines.join('\n')
}

/**
 * 월 목표 수익 달성에 필요한 연간 수익률 계산
 * 예: monthlyProfit=500k, totalCapital=10M → requiredAnnualReturnPct ≈ 6%
 */
export function calcRequiredAnnualReturn(
  monthlyProfitKrw: number,
  totalCapitalKrw: number,
): number {
  if (totalCapitalKrw <= 0 || monthlyProfitKrw <= 0) return 0
  const annualProfit = monthlyProfitKrw * 12
  return (annualProfit / totalCapitalKrw) * 100
}

/**
 * 종목의 Kelly 기반 배분 가중치 계산 (0~1 범위)
 * - Kelly가 높을수록, EV가 양수일수록 높은 가중치
 * - R:R < 1.5 또는 EV < 0이면 제외
 */
export function calcAllocationWeight(item: HighlightPlanItem, style: RecommendationStyle = 'stable'): number {
  return calcAllocationWeightByStyle(item, style)
}

export type RecommendationStyle = 'stable' | 'balanced' | 'aggressive'
export type RecommendationWeek = 1 | 2 | 3 | 4

function normalizeMarketLabel(market?: string): 'KOSPI' | 'KOSDAQ' | 'OTHER' {
  const m = String(market || '').toUpperCase()
  if (m.includes('KOSDAQ') || m.includes('KQ')) return 'KOSDAQ'
  if (m.includes('KOSPI') || m.includes('KS')) return 'KOSPI'
  return 'OTHER'
}

export function getWeeklyDeployRatio(style: RecommendationStyle, week: RecommendationWeek): number {
  const weekBase = week === 1 ? 0.55 : week === 2 ? 0.7 : week === 3 ? 0.85 : 1.0
  const styleFactor = style === 'stable' ? 0.85 : style === 'aggressive' ? 1.1 : 1.0
  return Math.max(0.35, Math.min(1, weekBase * styleFactor))
}

function calcAllocationWeightByStyle(item: HighlightPlanItem, style: RecommendationStyle): number {
  const rr = calcRR(item)
  const ev = calcExpectedValue(item)

  // 스타일별 품질 기준
  const rrMin = style === 'stable' ? 1.9 : style === 'aggressive' ? 1.4 : 1.6
  const winMin = style === 'stable' ? 54 : style === 'aggressive' ? 48 : 50
  if (rr < rrMin || item.winProb < winMin || ev <= 0) return 0

  const kelly = calcKelly(item)
  const grade = getTradeGrade(item)
  const gradeFactor = grade === 'A' ? 1.0 : grade === 'B' ? 0.8 : 0.55
  const styleFactor = style === 'stable' ? 0.9 : style === 'aggressive' ? 1.05 : 1.0
  const market = normalizeMarketLabel(item.market)
  const marketFactor = style === 'stable'
    ? (market === 'KOSDAQ' ? 0.82 : 1.0)
    : (style === 'balanced' && market === 'KOSDAQ' ? 0.92 : 1.0)
  const sourceFactor = item.source === 'scan-highlights' ? 1.08 : 1.0

  // kelly는 최대 25, 정규화
  return (kelly / 25) * gradeFactor * styleFactor * marketFactor * sourceFactor
}

/** 보유 포지션 현재 상태 타입 */
export type PositionStatus = 'take_profit' | 'near_profit' | 'hold' | 'near_stop' | 'stop_loss' | 'no_price'

export const POSITION_STATUS_LABEL: Record<PositionStatus, string> = {
  take_profit: '익절 신호',
  near_profit: '목표가 근접',
  hold: '보유 유지',
  near_stop: '손절가 근접',
  stop_loss: '손절 신호',
  no_price: '가격 미확인',
}

/**
 * 보유 포지션의 현재 상태 계산
 * - current_price vs buyPrice 비교
 * - targetPct / stopPct 기준으로 신호 판단
 */
export function calcPositionStatus(item: HighlightPlanItem): {
  status: PositionStatus
  changePct: number | null
  distToTarget: number | null
  distToStop: number | null
  unrealizedKrw: number | null
} {
  const currentPrice = item.current_price ?? 0
  const buyPrice = item.buyPrice ?? 0
  const shares = item.shares ?? 0

  if (!currentPrice || !buyPrice) {
    return { status: 'no_price', changePct: null, distToTarget: null, distToStop: null, unrealizedKrw: null }
  }

  const changePct = ((currentPrice - buyPrice) / buyPrice) * 100
  const distToTarget = item.targetPct - changePct   // 양수 = 목표까지 남은 거리
  const distToStop = changePct + item.stopPct       // 음수 = 이미 손절가 통과
  const unrealizedKrw = shares > 0 ? (currentPrice - buyPrice) * shares : null

  let status: PositionStatus
  if (changePct >= item.targetPct) {
    status = 'take_profit'
  } else if (distToStop <= 0) {
    status = 'stop_loss'
  } else if (distToTarget <= item.targetPct * 0.3) {
    status = 'near_profit'   // 목표까지 30% 이내 남음
  } else if (distToStop <= item.stopPct * 0.3) {
    status = 'near_stop'     // 손절까지 30% 이내 남음
  } else {
    status = 'hold'
  }

  return { status, changePct, distToTarget, distToStop, unrealizedKrw }
}

/**
 * 주간 사이클 기반 목표 달성 계획 계산
 * - buyPrice + shares가 있는 항목 = 실제 보유 포지션으로 취급
 * - 없으면 amount 기반으로 계산 (계획 모드)
 * - cyclesPerMonth: 월 사이클 수 (기본 4회, 주 1회 기준)
 */
export function calcWeeklyCyclePlan(
  items: HighlightPlanItem[],
  monthlyTarget: number,
  feePct: number,
  taxPct: number,
  cyclesPerMonth = 4,
): {
  perStock: Array<{
    code: string
    name: string
    targetGainNet: number
    stopLossNet: number
    ev: number
    winProb: number
    invested: number
    targetPct: number
    stopPct: number
  }>
  cycleMaxProfit: number
  cycleEV: number
  monthlyEV: number
  cyclesNeeded: number
  weeksNeeded: number
  progressPct: number
  gapToTarget: number
} {
  const tradeable = items.filter(i => i.code !== 'CASH')

  const perStock = tradeable.map(item => {
    // 실제 매수 주수 있으면 buyPrice*shares, 없으면 amount
    const invested = (item.buyPrice && item.shares)
      ? item.buyPrice * item.shares
      : (item.amount || 0)

    const targetGain = invested * (item.targetPct / 100)
    const stopLoss = invested * (item.stopPct / 100)
    const fee = invested * (feePct / 100) * 2  // 매수+매도 왕복
    const tax = targetGain * (taxPct / 100)
    const w = item.winProb / 100
    const targetGainNet = targetGain - fee - tax
    const stopLossNet = -(stopLoss + fee)
    const ev = targetGainNet * w + stopLossNet * (1 - w)

    return {
      code: item.code,
      name: item.name,
      targetGainNet,
      stopLossNet,
      ev,
      winProb: item.winProb,
      invested,
      targetPct: item.targetPct,
      stopPct: item.stopPct,
    }
  })

  const cycleMaxProfit = perStock.reduce((acc, s) => acc + s.targetGainNet, 0)
  const cycleEV = perStock.reduce((acc, s) => acc + s.ev, 0)
  const monthlyEV = cycleEV * cyclesPerMonth
  const cyclesNeeded = cycleEV > 0 ? Math.ceil(monthlyTarget / cycleEV) : Infinity
  const weeksNeeded = cyclesNeeded
  const progressPct = (monthlyTarget > 0 && monthlyEV > 0)
    ? Math.min(100, (monthlyEV / monthlyTarget) * 100)
    : 0
  const gapToTarget = monthlyTarget - monthlyEV

  return { perStock, cycleMaxProfit, cycleEV, monthlyEV, cyclesNeeded, weeksNeeded, progressPct, gapToTarget }
}

/**
 * 추천 포트폴리오 생성
 * - 관심종목 후보에서 품질 좋은 종목 선택
 * - Kelly + Expected Value 기반 가중치 배분
 * - 월 수익 목표 달성 가능하도록 종목/금액 구성
 */
export function recommendPortfolio(
  candidates: HighlightPlanItem[],
  totalCapitalKrw: number,
  monthlyProfitKrw: number,
  options?: {
    style?: RecommendationStyle
  },
): HighlightPlanItem[] {
  if (candidates.length === 0 || totalCapitalKrw <= 0 || monthlyProfitKrw <= 0) {
    console.log('[recommendPortfolio] 입력 검증 실패:', { candidates: candidates.length, totalCapitalKrw, monthlyProfitKrw })
    return []
  }

  const style: RecommendationStyle = options?.style ?? 'stable'
  // 주차 제거 - 스타일별 고정 배분 비율 (더 높게 설정)
  const baseDeployRatio = style === 'stable' ? 0.75 : style === 'balanced' ? 0.78 : 0.80
  const baseDeployBudget = Math.round(totalCapitalKrw * baseDeployRatio)
  const maxKosdaqRatio = style === 'stable' ? 0.30 : style === 'balanced' ? 0.45 : 0.70
  const minKospiRatio = style === 'stable' ? 0.45 : style === 'balanced' ? 0.30 : 0.15
  const perStockCapRatio = style === 'stable' ? 0.28 : style === 'balanced' ? 0.35 : 0.45
  const maxStocks = style === 'stable' ? 4 : style === 'balanced' ? 5 : 6
  const poolSize = style === 'stable' ? 12 : style === 'balanced' ? 16 : 20

  // 1. 각 종목의 배분 가중치 계산
  const withWeights = candidates
    .map(item => ({
      ...item,
      weight: calcAllocationWeightByStyle(item, style),
      sourceRank: Number(item.signal_rank ?? 9999),
      sourceScore: Number(item.signal_score ?? 0),
    }))
    .filter(x => x.weight > 0) // 품질 기준 통과 종목만
    .sort((a, b) => {
      const w = b.weight - a.weight
      if (Math.abs(w) > 0.0001) return w
      const rankDiff = a.sourceRank - b.sourceRank
      if (rankDiff !== 0) return rankDiff
      return b.sourceScore - a.sourceScore
    })

  console.log('[recommendPortfolio] 품질 통과 종목:', withWeights.length, '개')
  withWeights.slice(0, 3).forEach(w => console.log(`  - ${w.code}(${w.name}): weight=${w.weight.toFixed(3)}, RR=${calcRR(w).toFixed(2)}, EV=${calcExpectedValue(w).toLocaleString('ko-KR')} 원`))

  if (withWeights.length === 0) {
    console.log('[recommendPortfolio] 품질 기준 통과 종목 없음')
    return [] // 추천할 종목 없음
  }

  // 2. 가중치 정규화
  const totalWeight = withWeights.reduce((acc, x) => acc + x.weight, 0)
  const normalized = withWeights.map(x => ({
    ...x,
    allocRatio: x.weight / totalWeight, // 배분 비율
  }))

  // 3. 총 자본 배분 (상위 N개 종목)
  const topCandidates = normalized.slice(0, poolSize)
  const topTotalWeight = topCandidates.reduce((acc, x) => acc + x.allocRatio, 0)

  // 3-1. 월 목표 수익 기반으로 필요한 집행 예산을 역산 (주 1사이클, 월 4사이클)
  const weightedCycleYield = topTotalWeight > 0
    ? topCandidates.reduce((acc, x) => {
        const baseAmount = Math.max(1, Number(x.amount || 1_000_000))
        const evRatio = calcExpectedValue(x) / baseAmount
        const w = x.allocRatio / topTotalWeight
        return acc + evRatio * w
      }, 0)
    : 0
  const requiredCycleProfit = Math.max(0, monthlyProfitKrw / 4)
  const targetDeployBudget = weightedCycleYield > 0
    ? Math.ceil(requiredCycleProfit / weightedCycleYield)
    : baseDeployBudget
  // 월 목표 달성을 위해 배분액을 충분하게 확보 (최대 85%)
  const deployBudget = Math.max(
    baseDeployBudget,
    Math.min(Math.round(totalCapitalKrw * 0.85), targetDeployBudget),
  )

  // 4. 실제 매수 수량/금액 계산 및 현금 보유 반영
  let remain = totalCapitalKrw
  let remainingDeployBudget = deployBudget
  let kosdaqUsed = 0
  let kospiUsed = 0
  const kosdaqCapAmount = Math.round(deployBudget * maxKosdaqRatio)
  const kospiCandidates = topCandidates.filter(x => normalizeMarketLabel(x.market) === 'KOSPI').length
  const kospiFloorAmount = kospiCandidates > 0 ? Math.round(deployBudget * minKospiRatio) : 0
  const perStockCapAmount = Math.round(deployBudget * perStockCapRatio)
  const result: HighlightPlanItem[] = []
  console.log('[recommendPortfolio] 배분액 계산 시작', {
    style,
    baseDeployRatio,
    baseDeployBudget,
    deployBudget,
    requiredCycleProfit,
    weightedCycleYield,
    targetDeployBudget,
    maxKosdaqRatio,
    minKospiRatio,
    kospiCandidates,
  })
  for (const x of topCandidates) {
    if (result.length >= maxStocks || remainingDeployBudget <= 0) break

    // 장중이면 current_price, 아니면 close 사용
    const price = Number(x.current_price ?? x.close ?? 0)
    if (!price || price <= 0) {
      console.log(`  - ${x.code}: 가격 없음 (current_price=${x.current_price}, close=${x.close})`)
      continue
    }

    // 배분액 계산 (주차별 집행 예산 + 종목당 상한)
    let alloc = Math.round((x.allocRatio / topTotalWeight) * deployBudget)
    alloc = Math.min(alloc, perStockCapAmount, remainingDeployBudget)

    // 스타일별 코스닥 비중 상한
    const market = normalizeMarketLabel(x.market)
    if (market === 'KOSDAQ') {
      const kosdaqRemaining = Math.max(0, kosdaqCapAmount - kosdaqUsed)
      alloc = Math.min(alloc, kosdaqRemaining)
    }

    // KOSPI 최소 비중을 확보하기 위해, KOSPI가 아닌 종목은 예산 일부를 예약
    if (market !== 'KOSPI' && kospiFloorAmount > 0) {
      const kospiNeed = Math.max(0, kospiFloorAmount - kospiUsed)
      const nonKospiMaxAlloc = Math.max(0, remainingDeployBudget - kospiNeed)
      alloc = Math.min(alloc, nonKospiMaxAlloc)
    }

    if (alloc <= 0) continue

    // 실제 매수 가능 주수 (정수)
    const shares = Math.floor(alloc / price)
    if (shares <= 0) {
      console.log(`  - ${x.code}: 주수 부족 (alloc=${alloc.toLocaleString('ko-KR')} 원, price=${price.toLocaleString('ko-KR')} 원/주 → shares=${shares})`)
      continue
    }
    const buyAmount = shares * price
    remain -= buyAmount
    remainingDeployBudget -= buyAmount
    if (market === 'KOSDAQ') kosdaqUsed += buyAmount
    if (market === 'KOSPI') kospiUsed += buyAmount
    console.log(`  ✓ ${x.code}: ${shares}주 × ${price.toLocaleString('ko-KR')} = ${buyAmount.toLocaleString('ko-KR')} 원`)
    result.push({ ...x, amount: buyAmount, shares, buyPrice: price })
  }
  // 현금 보유 항목 추가 (1만원 이상 남으면)
  console.log(`[recommendPortfolio] 최종 결과: ${result.length}개 종목 + 현금 ${remain.toLocaleString('ko-KR')} 원`)
  if (remain > 10000) {
    result.push({
      id: 'cash',
      code: 'CASH',
      name: '현금 보유',
      amount: remain,
      targetPct: 0,
      stopPct: 0,
      winProb: 0,
      split1: 0,
      split2: 0,
      split3: 0,
    })
  }
  return result
}
