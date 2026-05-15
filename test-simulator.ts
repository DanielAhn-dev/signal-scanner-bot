import type { HighlightPlanItem } from './web/src/features/simulator/planStore'

// 계산 함수들 (복사해서 테스트)
function calcExpectedValue(item: HighlightPlanItem) {
  const invested = item.amount
  const targetProfit = invested * (item.targetPct / 100)
  const stopLoss = invested * (item.stopPct / 100)
  return invested > 0
    ? targetProfit * (item.winProb / 100) - stopLoss * (1 - item.winProb / 100)
    : 0
}

function calcRR(item: HighlightPlanItem): number {
  if (item.stopPct <= 0) return 0
  return item.targetPct / item.stopPct
}

function calcKelly(item: HighlightPlanItem): number {
  const w = item.winProb / 100
  const rr = calcRR(item)
  if (rr <= 0 || w <= 0) return 0
  const fullKelly = w - (1 - w) / rr
  const halfKelly = fullKelly * 0.5
  return Math.max(0, Math.min(25, halfKelly * 100))
}

function getTradeGrade(item: HighlightPlanItem): 'A' | 'B' | 'C' | 'D' {
  const rr = calcRR(item)
  const w = item.winProb / 100
  const ev = calcExpectedValue(item)
  if (ev <= 0) return 'D'
  if (rr >= 2.5 && w >= 0.58) return 'A'
  if (rr >= 2.0 && w >= 0.52) return 'B'
  if (rr >= 1.5 && ev > 0) return 'C'
  return 'D'
}

function calcRequiredAnnualReturn(monthlyProfitKrw: number, totalCapitalKrw: number): number {
  if (totalCapitalKrw <= 0 || monthlyProfitKrw <= 0) return 0
  const annualProfit = monthlyProfitKrw * 12
  return (annualProfit / totalCapitalKrw) * 100
}

function calcAllocationWeight(item: HighlightPlanItem): number {
  const rr = calcRR(item)
  const ev = calcExpectedValue(item)
  
  if (rr < 1.5 || item.winProb < 50 || ev <= 0) return 0
  
  const kelly = calcKelly(item)
  const gradeFactor = getTradeGrade(item) === 'A' ? 1.0 : getTradeGrade(item) === 'B' ? 0.8 : 0.5
  
  return (kelly / 25) * gradeFactor
}

function recommendPortfolio(
  candidates: HighlightPlanItem[],
  totalCapitalKrw: number,
  monthlyProfitKrw: number,
): HighlightPlanItem[] {
  if (candidates.length === 0 || totalCapitalKrw <= 0 || monthlyProfitKrw <= 0) {
    return []
  }

  const withWeights = candidates
    .map(item => ({
      ...item,
      weight: calcAllocationWeight(item),
    }))
    .filter(x => x.weight > 0)
    .sort((a, b) => b.weight - a.weight)

  if (withWeights.length === 0) {
    return []
  }

  const totalWeight = withWeights.reduce((acc, x) => acc + x.weight, 0)
  const normalized = withWeights.map(x => ({
    ...x,
    allocRatio: x.weight / totalWeight,
  }))

  const topCandidates = normalized.slice(0, 5)
  const topTotalWeight = topCandidates.reduce((acc, x) => acc + x.allocRatio, 0)

  const recommended = topCandidates.map(x => ({
    ...x,
    amount: Math.round((x.allocRatio / topTotalWeight) * totalCapitalKrw),
  }))

  const sumAllocated = recommended.reduce((acc, x) => acc + x.amount, 0)
  if (sumAllocated !== totalCapitalKrw && recommended.length > 0) {
    const lastIdx = recommended.length - 1
    recommended[lastIdx].amount += totalCapitalKrw - sumAllocated
  }

  return recommended
}

// 테스트 데이터
const testCandidates: HighlightPlanItem[] = [
  {
    code: '005930',
    name: '삼성전자',
    sector_id: null,
    amount: 1_000_000,
    targetPct: 8,
    stopPct: 3,
    winProb: 62,
    split1: 40,
    split2: 35,
    split3: 25,
  },
  {
    code: '000660',
    name: 'SK하이닉스',
    sector_id: null,
    amount: 1_000_000,
    targetPct: 10,
    stopPct: 4,
    winProb: 58,
    split1: 40,
    split2: 35,
    split3: 25,
  },
  {
    code: '035720',
    name: '카카오',
    sector_id: null,
    amount: 1_000_000,
    targetPct: 12,
    stopPct: 5,
    winProb: 55,
    split1: 40,
    split2: 35,
    split3: 25,
  },
  {
    code: '012345',
    name: '저품질 종목',
    sector_id: null,
    amount: 1_000_000,
    targetPct: 3,
    stopPct: 2,
    winProb: 48, // 50% 미만 = 제외
    split1: 40,
    split2: 35,
    split3: 25,
  },
]

const totalCapital = 10_000_000
const monthlyProfit = 500_000

console.log('=== 시뮬레이터 추천 알고리즘 테스트 ===\n')

console.log(`총 투자금: ${totalCapital.toLocaleString()}원`)
console.log(`월 수익 목표: ${monthlyProfit.toLocaleString()}원`)
console.log(`필요 연간 수익률: ${calcRequiredAnnualReturn(monthlyProfit, totalCapital).toFixed(2)}%\n`)

console.log('── 후보 종목 분석 ──')
for (const cand of testCandidates) {
  const rr = calcRR(cand)
  const kelly = calcKelly(cand)
  const ev = calcExpectedValue(cand)
  const grade = getTradeGrade(cand)
  const weight = calcAllocationWeight(cand)
  
  console.log(`\n${cand.code} ${cand.name}`)
  console.log(`  R:R: ${rr.toFixed(2)}:1 | Kelly: ${kelly.toFixed(2)}% | Grade: ${grade}`)
  console.log(`  EV: ${ev.toLocaleString('ko-KR')}원 | Weight: ${weight.toFixed(4)}`)
  console.log(`  목표/손절/승률: ${cand.targetPct}% / ${cand.stopPct}% / ${cand.winProb}%`)
}

console.log('\n\n── 추천 포트폴리오 ──')
const recommended = recommendPortfolio(testCandidates, totalCapital, monthlyProfit)

if (recommended.length === 0) {
  console.log('추천 가능한 종목이 없습니다.')
} else {
  console.log(`추천 종목: ${recommended.length}개\n`)
  let totalRecommended = 0
  for (const rec of recommended) {
    const rr = calcRR(rec)
    const ev = calcExpectedValue(rec)
    const pct = (rec.amount / totalCapital) * 100
    totalRecommended += rec.amount
    console.log(`${rec.code} ${rec.name}`)
    console.log(`  배분액: ${rec.amount.toLocaleString()}원 (${pct.toFixed(1)}%)`)
    console.log(`  R:R: ${rr.toFixed(2)}:1 | EV: ${ev.toLocaleString('ko-KR')}원`)
  }
  console.log(`\n합계: ${totalRecommended.toLocaleString()}원`)
}

console.log('\n=== 테스트 완료 ===')
