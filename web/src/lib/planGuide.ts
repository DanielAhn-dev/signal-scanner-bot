/**
 * 계획 점검 계산 — 감내 낙폭→주식 비중 상한, 일시금 대 분할, 필요 월 적립액, 은퇴 인출 가이드.
 * 표 값은 docs/research-retirement-and-starting-2026-10-03.md의 검증 결과(미국 1926~2023 실질, 겹치는 창)이고,
 * 필요 월 적립액은 임베드한 미국 주식 실질 월수익률로 화면에서 직접 계산한다. 순수 함수만 둔다.
 */
import { CHILD_LONGRUN_REAL_MONTHLY as R } from '../data/childLongRunData'
import { SAVINGS_REAL_ANNUAL } from './childProjection'
import { CHILD_LONGRUN_START } from '../data/childLongRunData'
import { CHECKING_TABLE, INCOME_YIELD, SLEEVE_COST_DATA, SPLIT_TABLE, TOLERANCE_TABLE, WITHDRAWAL_TABLE } from '../data/researchFacts'
import { netCashPlan } from './retirementCash'

/** 주식 비중별 "시작 후 5년 안 최대 낙폭" 나쁜 10% 값(%, 미국 주식+합성 10년 국채) */
export const BAD10_DRAWDOWN: ReadonlyArray<{ stock: number; bad10: number; worst: number }> = TOLERANCE_TABLE

export type StockCap = { cap: number; recommended: number; bad10AtCap: number }

/** 버틸 수 있는 낙폭(%)에서 주식 비중 상한. 기본 제안은 한 칸(20%p) 낮게 — 자기 감내를 높게 잡는 쪽이 비용이 크다 */
export function stockCapFor(tolerancePct: number): StockCap {
  const t = Math.max(0, tolerancePct)
  let cap = 0
  for (const row of BAD10_DRAWDOWN) if (row.bad10 <= t) cap = row.stock
  const recommended = Math.max(0, cap - 20)
  return { cap, recommended, bad10AtCap: BAD10_DRAWDOWN.find((r) => r.stock === cap)?.bad10 ?? 0 }
}

/** 100% 주식, 시작 후 5년 — 일시금 대비 비교(1.0 = 넣은 돈) */
export const SPLIT_OPTIONS: ReadonlyArray<{ months: number; label: string; avgCostPct: number; firstYearLowBad10: number; firstYearLowWorst: number }> = SPLIT_TABLE

/** 확인 주기별 "원금 아래 화면"을 본 횟수(3년 보유, 중앙값) — 코스피·S&P500 */
export const CHECK_FREQUENCY: ReadonlyArray<{ label: string; kospi: number; sp500: number }> = CHECKING_TABLE

function quantile(sorted: number[], q: number): number {
  const i = (sorted.length - 1) * q
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo)
}

export type RequiredSaving = {
  /** 적금(실질 연 0.5%)만으로 닿는 월 적립액 */
  savings: number
  /** 시작 시점이 보통일 때 */
  median: number
  /** 10번 중 8번 닿으려면 / 9번 닿으려면 */
  eightOfTen: number
  nineOfTen: number
  /** 시작 시대(20년 단위 묶음)별 중앙값의 최소·최대 — 같은 '보통'도 시대에 따라 이만큼 갈린다 */
  eraMedianMin: number
  eraMedianMax: number
  windows: number
}

/** 오늘 가치 목표 금액에 닿기 위한 월 적립액 — 월초 입금, 월말 수익, 미국 주식 100% 실질 수익률의 모든 시작월 */
export function requiredMonthly(targetWon: number, years: number): RequiredSaving | null {
  const months = Math.round(years * 12)
  if (!(targetWon > 0) || months < 60 || months > R.length) return null
  const need: number[] = []
  for (let s = 0; s + months <= R.length; s += 1) {
    // 월 1원씩 넣었을 때의 미래가치 계수
    let f = 0
    for (let t = 0; t < months; t += 1) f = (f + 1) * (1 + R[s + t])
    need.push(targetWon / f)
  }
  const eraMeds: number[] = []
  const eraSize = 240
  for (let a = 0; a < need.length; a += eraSize) {
    const part = need.slice(a, a + eraSize)
    if (part.length >= 120) eraMeds.push(quantile([...part].sort((x, y) => x - y), 0.5))
  }
  need.sort((a, b) => a - b)
  const m = (1 + SAVINGS_REAL_ANNUAL) ** (1 / 12) - 1
  let sf = 0
  for (let t = 0; t < months; t += 1) sf = (sf + 1) * (1 + m)
  return { savings: targetWon / sf, median: quantile(need, 0.5), eightOfTen: quantile(need, 0.8), nineOfTen: quantile(need, 0.9), eraMedianMin: Math.min(...eraMeds), eraMedianMax: Math.max(...eraMeds), windows: need.length }
}

/** 미국 60/40, 월 실질 인출(시작 자산 대비 연 %) → 시작월 중 바닥난 비율(%) — 25년·30년 */
export const WITHDRAWAL_FAILURE: ReadonlyArray<{ ratePct: number; fail25: number; fail30: number }> = WITHDRAWAL_TABLE

/** 표 사이는 직선으로 잇는다. 표 밖은 끝 값(3.33% 아래는 0, 6.67% 위는 마지막 값 이상으로 본다) */
export function withdrawalFailure(ratePct: number, years: 25 | 30): number {
  const key = years === 25 ? 'fail25' : 'fail30'
  const t = WITHDRAWAL_FAILURE
  if (ratePct <= t[0].ratePct) return t[0][key]
  for (let i = 1; i < t.length; i += 1) {
    if (ratePct <= t[i].ratePct) {
      const a = t[i - 1]
      const b = t[i]
      return a[key] + ((b[key] - a[key]) * (ratePct - a.ratePct)) / (b.ratePct - a.ratePct)
    }
  }
  return t[t.length - 1][key]
}

/** 주식형 ETF 분배금 가정(연, 자산 대비) — 이 부분만 배당소득 과세·건보 금융소득으로 본다. 나머지 인출은 매도 차익(국내 주식형 ETF는 비과세) */
export const DISTRIBUTION_YIELD = 0.025

export type WithdrawalInput = {
  assetsWon: number
  /** 세금·건강보험료를 낸 뒤 손에 쥐고 싶은 월 합계(공적연금 포함) */
  targetNetMonthlyWon: number
  publicPensionMonthlyWon: number
  insurance: 'regional' | 'dependent'
  /** 재산세 과표 합계 — 모르면 0(집 없음과 같은 취급) */
  propertyBaseWon: number
}

export type WithdrawalPlan = {
  /** 계좌에서 꺼내야 하는 월 금액(세전). 연금만으로 충분하면 0 */
  withdrawMonthly: number
  ratePct: number
  fail25: number
  fail30: number
  leakageMonthly: number
  netMonthly: number
  dependentOk: boolean | null
  dependentReason: string
  /** 분배금이 연 1,000만원을 넘어 지역가입자 건보료가 뛰는 구간인가 */
  financialCliff: boolean
  /** 재산 과표 ±15% 가정 시 필요 인출액 범위 */
  withdrawRange: [number, number]
  /** 연 20% 인출로도 목표 실수령에 못 닿아 계산을 멈춘 경우 */
  unreachable: boolean
}

function solveWithdraw(i: WithdrawalInput, propertyBase: number): { w: number; plan: ReturnType<typeof netCashPlan> } {
  const step = 10_000
  const maxW = Math.max(0, (i.assetsWon * 0.2) / 12)
  let last = netCashPlan({ monthlyFromAssetsWon: 0, distributionAnnualWon: 0, publicPensionMonthlyWon: i.publicPensionMonthlyWon, propertyBaseWon: propertyBase, insurance: i.insurance })
  if (last.netMonthly >= i.targetNetMonthlyWon) return { w: 0, plan: last }
  for (let w = step; w <= maxW; w += step) {
    const plan = netCashPlan({ monthlyFromAssetsWon: w, distributionAnnualWon: Math.min(w * 12, i.assetsWon * DISTRIBUTION_YIELD), publicPensionMonthlyWon: i.publicPensionMonthlyWon, propertyBaseWon: propertyBase, insurance: i.insurance })
    last = plan
    if (plan.netMonthly >= i.targetNetMonthlyWon) return { w, plan }
  }
  return { w: maxW, plan: last }
}

/** 실수령 목표 → 계좌에서 꺼내야 하는 돈 → 인출률과 바닥날 위험. 입력이 모자라면 null */
export function planWithdrawal(i: WithdrawalInput): WithdrawalPlan | null {
  if (!(i.assetsWon > 0) || !(i.targetNetMonthlyWon > 0)) return null
  const base = solveWithdraw(i, i.propertyBaseWon)
  const lo = solveWithdraw(i, i.propertyBaseWon * 0.85).w
  const hi = solveWithdraw(i, i.propertyBaseWon * 1.15).w
  const ratePct = ((base.w * 12) / i.assetsWon) * 100
  const dist = Math.min(base.w * 12, i.assetsWon * DISTRIBUTION_YIELD)
  return {
    withdrawMonthly: base.w,
    ratePct,
    fail25: withdrawalFailure(ratePct, 25),
    fail30: withdrawalFailure(ratePct, 30),
    leakageMonthly: base.plan.grossMonthly - base.plan.netMonthly,
    netMonthly: base.plan.netMonthly,
    dependentOk: base.plan.dependent ? base.plan.dependent.eligible : null,
    dependentReason: base.plan.dependent?.reason ?? '',
    financialCliff: i.insurance === 'regional' && dist > 10_000_000 * 0.9,
    withdrawRange: [Math.min(lo, hi), Math.max(lo, hi)],
    unreachable: base.plan.netMonthly < i.targetNetMonthlyWon,
  }
}

/** 인컴(커버드콜) 몫 비중별 지수 대비 끝 자산 비율(%) — 스크립트가 생성한 값(data/researchFacts.ts), 한국 강세장 4~5년이라 방향만 참고 */
export const SLEEVE_COST: ReadonlyArray<{ weight: number; endVsIndexPct: number }> = SLEEVE_COST_DATA

export function sleeveCost(weightPct: number): number {
  const t = SLEEVE_COST
  const w = Math.min(100, Math.max(0, weightPct))
  for (let i = 1; i < t.length; i += 1) {
    if (w <= t[i].weight) {
      const a = t[i - 1]
      const b = t[i]
      return a.endVsIndexPct + ((b.endVsIndexPct - a.endVsIndexPct) * (w - a.weight)) / (b.weight - a.weight)
    }
  }
  return t[t.length - 1].endVsIndexPct
}

/** 자료를 만든 지 이 일수가 넘으면 화면에 "다시 확인 필요"를 붙인다 */
export const FACT_STALE_DAYS = 180

/** generated가 날짜(YYYY-MM-DD)일 때 오래됐는지. 날짜가 아니면(화면 계산) false */
export function isFactStale(generated: string, today: Date = new Date()): boolean {
  const t = Date.parse(generated)
  if (!Number.isFinite(t)) return false
  return (today.getTime() - t) / 86_400_000 > FACT_STALE_DAYS
}

export type SavingQuantiles = { windows: number; rows: Array<{ label: string; monthly: number }> }

/**
 * 관리자 점검용 — 시작 연도 범위를 좁혀 필요 월 적립액의 분포 전체(최선~최악)를 본다. 시작월 인덱스는 임베드 시리즈(1926-02~)의 월 순서.
 * 일반 화면의 requiredMonthly와 같은 계산(월초 입금, 월말 수익, 미국 주식 100% 실질).
 */
export function requiredMonthlyDetail(targetWon: number, years: number, fromYear: number, toYear: number): SavingQuantiles | null {
  const months = Math.round(years * 12)
  if (!(targetWon > 0) || months < 60 || months > R.length) return null
  const startYear = Number(CHILD_LONGRUN_START.slice(0, 4))
  const startMonth = Number(CHILD_LONGRUN_START.slice(4, 6))
  const need: number[] = []
  for (let s = 0; s + months <= R.length; s += 1) {
    const year = startYear + Math.floor((startMonth - 1 + s) / 12)
    if (year < fromYear || year > toYear) continue
    let f = 0
    for (let t = 0; t < months; t += 1) f = (f + 1) * (1 + R[s + t])
    need.push(targetWon / f)
  }
  if (need.length < 12) return null
  need.sort((a, b) => a - b)
  const rows = [['가장 유리한 시작', 0], ['상위 10%', 0.1], ['25%', 0.25], ['중앙값', 0.5], ['75%', 0.75], ['80%', 0.8], ['90%', 0.9], ['95%', 0.95], ['가장 불리한 시작', 1]] as const
  return { windows: need.length, rows: rows.map(([label, q]) => ({ label, monthly: quantile(need, q) })) }
}

export const DIVIDEND_TAX = 0.154

export type IncomeInput = { principalWon: number; ccSharePct: number; targetNetMonthlyWon: number }
type IncomeCase = { yieldPct: number; grossMonthly: number; netMonthly: number }
export type IncomePlan = {
  /** 낮은 해 / 보통 / 높은 해의 월 분배금(세전·세후) */
  low: IncomeCase
  typical: IncomeCase
  high: IncomeCase
  /** 낮은 해에 목표 실수령에 모자라는 비율(%) — 0이면 모자라지 않음 */
  shortfallLowPct: number
  /** 보통 해에 목표를 채우려면 필요한 원금 */
  principalForTarget: number
  annualGrossTypical: number
  /** 연 분배금(보통)이 금융소득 경계(1,000만·2,000만원)를 넘는가 */
  over10m: boolean
  over20m: boolean
}

/** 커버드콜·고배당을 섞은 인컴 계좌의 월 분배금 범위 — 12개월 분배율의 최저·중앙·최고(1세대형 한국 상품 실제 이력)를 비중대로 섞는다 */
export function incomePlan(i: IncomeInput): IncomePlan | null {
  if (!(i.principalWon > 0)) return null
  const w = Math.min(100, Math.max(0, i.ccSharePct)) / 100
  const mix = (cc: number, hd: number) => w * cc + (1 - w) * hd
  const build = (yieldPct: number): IncomeCase => {
    const gross = (i.principalWon * yieldPct) / 100 / 12
    return { yieldPct, grossMonthly: gross, netMonthly: gross * (1 - DIVIDEND_TAX) }
  }
  const low = build(mix(INCOME_YIELD.cc.min, INCOME_YIELD.hd.min))
  const typical = build(mix(INCOME_YIELD.cc.median, INCOME_YIELD.hd.median))
  const high = build(mix(INCOME_YIELD.cc.max, INCOME_YIELD.hd.max))
  const target = Math.max(0, i.targetNetMonthlyWon)
  const shortfallLowPct = target > 0 && low.netMonthly < target ? ((target - low.netMonthly) / target) * 100 : 0
  const principalForTarget = target > 0 ? (target * 12) / (1 - DIVIDEND_TAX) / (typical.yieldPct / 100) : 0
  const annualGrossTypical = typical.grossMonthly * 12
  return { low, typical, high, shortfallLowPct, principalForTarget, annualGrossTypical, over10m: annualGrossTypical > 10_000_000, over20m: annualGrossTypical > 20_000_000 }
}

export type RatesNowInput = { short: number; long: number; spread: number; shortChg12: number; longChg12: number }

/** 현재 금리 스냅샷을 연구 표의 환경 이름으로 옮긴다 — 단기(3개월물 12개월 ±1%p), 장기(10년물 12개월 ±0.5%p), 장단기 금리차 */
export function ratesLabels(n: RatesNowInput): { short: '인상기' | '횡보' | '인하기'; long: '상승' | '횡보' | '하락'; curve: '역전' | '평탄' | '정상' } {
  return {
    short: n.shortChg12 > 1 ? '인상기' : n.shortChg12 < -1 ? '인하기' : '횡보',
    long: n.longChg12 > 0.5 ? '상승' : n.longChg12 < -0.5 ? '하락' : '횡보',
    curve: n.spread < 0 ? '역전' : n.spread < 1 ? '평탄' : '정상',
  }
}
