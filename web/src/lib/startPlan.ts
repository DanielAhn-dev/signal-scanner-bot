/**
 * 시작 마법사 계산 — 수입·지출·대출로 월 투자 여유액을 구하고, 목표가 현실적인지 필요 연수익률로 되짚는다.
 * 순수 함수만 둔다(화면·서버 호출 없음). 목표 필요 시드는 목표 트래커와 같은 인출률 식을 쓴다.
 */
import { requiredSeed, DEFAULT_WITHDRAWAL_PCT } from '../../../src/services/goalTracker'

/** 지수 장기 평균(참고) — 이보다 높은 수익률을 요구하면 비현실적이라고 안내한다 */
export const REALISTIC_ANNUAL_PCT = 8
export const STRETCH_ANNUAL_PCT = 15

export type StartInputs = {
  income: number
  card: number
  otherFixed: number
  loanPayment: number
  /** 대출 연이율 % (모르면 null) */
  loanRatePct: number | null
  years: number
  /** 원하는 월 수입(투자로 받고 싶은 금액) */
  targetMonthly: number
  /** 시작할 때 넣을 금액 */
  initialSeed: number
  /** 매달 적립할 금액 */
  monthly: number
}

/** 월 수입 − 카드값 − 그 밖의 고정지출 − 대출 상환 */
export function monthlySurplus(i: Pick<StartInputs, 'income' | 'card' | 'otherFixed' | 'loanPayment'>): number {
  return Math.round(i.income - i.card - i.otherFixed - i.loanPayment)
}

/** 여유액의 절반을 1만원 단위로 내림 — 남는 돈을 전부 쓰지 않는 보수적 제안 */
export function suggestMonthly(surplus: number): number {
  if (!(surplus > 0)) return 0
  return Math.floor((surplus * 0.5) / 10_000) * 10_000
}

/** 월말 적립 복리 미래가치 */
export function futureValue(seed: number, monthly: number, years: number, annualPct: number): number {
  const n = Math.round(years * 12)
  if (n <= 0) return seed
  const m = (1 + annualPct / 100) ** (1 / 12) - 1
  if (m === 0) return seed + monthly * n
  const g = (1 + m) ** n
  return seed * g + (monthly * (g - 1)) / m
}

/** 필요한 총 시드 — 원금을 지키며 목표 월 수입을 꺼내 쓰는 규모 */
export function targetWealth(targetMonthly: number): number {
  return requiredSeed(targetMonthly, DEFAULT_WITHDRAWAL_PCT)
}

/**
 * 시작금·월 적립으로 기간 안에 목표 자산에 닿기 위한 연수익률(%).
 * 0%로도 닿으면 0, 200%로도 안 닿으면 null.
 */
export function requiredAnnualPct(input: { seed: number; monthly: number; years: number; target: number }): number | null {
  const { seed, monthly, years, target } = input
  if (!(target > 0)) return 0
  if (futureValue(seed, monthly, years, 0) >= target) return 0
  if (futureValue(seed, monthly, years, 200) < target) return null
  let lo = 0
  let hi = 200
  for (let k = 0; k < 60; k += 1) {
    const mid = (lo + hi) / 2
    if (futureValue(seed, monthly, years, mid) >= target) hi = mid
    else lo = mid
  }
  return hi
}

export type Realism = { level: 'ok' | 'stretch' | 'unrealistic'; text: string }

export function judgeRealism(requiredPct: number | null): Realism {
  if (requiredPct === null || requiredPct > STRETCH_ANNUAL_PCT) {
    return {
      level: 'unrealistic',
      text: requiredPct === null
        ? '이 조건으로는 어떤 수익률로도 닿기 어렵습니다.'
        : `연 ${requiredPct.toFixed(0)}%가 필요합니다. 지수의 장기 평균은 연 ${REALISTIC_ANNUAL_PCT}% 안팎이라 사실상 어려운 목표입니다.`,
    }
  }
  if (requiredPct > REALISTIC_ANNUAL_PCT) {
    return { level: 'stretch', text: `연 ${requiredPct.toFixed(1)}%가 필요합니다. 지수 장기 평균(연 ${REALISTIC_ANNUAL_PCT}% 안팎)보다 높아 빠듯한 목표입니다.` }
  }
  return { level: 'ok', text: `연 ${requiredPct.toFixed(1)}% 정도면 닿습니다. 지수 장기 평균 범위 안이라 현실적인 목표입니다.` }
}

/** 지금 조건 그대로 장기 평균 수익률(8%)이면 기간 뒤 얼마가 되고 월 수입은 얼마인가 */
export function realisticOutcome(i: Pick<StartInputs, 'initialSeed' | 'monthly' | 'years'>): { wealth: number; monthlyIncome: number } {
  const wealth = futureValue(i.initialSeed, i.monthly, i.years, REALISTIC_ANNUAL_PCT)
  return { wealth, monthlyIncome: (wealth * (DEFAULT_WITHDRAWAL_PCT / 100)) / 12 }
}

/** 지금 적립액으로 장기 평균 수익률이면 목표 자산까지 걸리는 햇수. 50년 넘으면 null */
export function yearsToTarget(i: Pick<StartInputs, 'initialSeed' | 'monthly'> & { target: number }): number | null {
  for (let months = 1; months <= 600; months += 1) {
    if (futureValue(i.initialSeed, i.monthly, months / 12, REALISTIC_ANNUAL_PCT) >= i.target) return Math.ceil(months / 12)
  }
  return null
}

/** 대출 이자가 기대수익(8%)보다 높으면 투자보다 상환이 먼저라는 안내 */
export function loanAdvice(loanRatePct: number | null): string | null {
  if (loanRatePct == null || !(loanRatePct > REALISTIC_ANNUAL_PCT)) return null
  return `대출 금리 연 ${loanRatePct}%는 투자 기대수익(연 ${REALISTIC_ANNUAL_PCT}% 안팎)보다 높습니다. 상환이 확실한 수익이라, 이 대출을 먼저 줄이는 쪽을 권합니다.`
}

export type LossReaction = 'sell' | 'hold' | 'buy'

export function lossReactionNote(reaction: LossReaction): string {
  if (reaction === 'sell') return '하락이 불안하면 종목 매매보다 지수(KODEX 200) 보유 방식이 맞고, 처음엔 적은 금액으로 가상 계좌에서 하락을 겪어 보는 걸 권합니다.'
  if (reaction === 'buy') return '하락을 기회로 보는 성향이라도 정해진 적립액을 넘겨 더 넣지는 마세요. 규칙대로만 넣는 게 행동 편향을 막습니다.'
  return '하락에도 버티는 성향이면 정기 적립과 잘 맞습니다. 그대로 규칙을 따르면 됩니다.'
}

export type InvestorProfile = { reaction: string; horizon: string; emergency: string; checking: string; experience: string }

export type ProfileQuestion = {
  key: keyof InvestorProfile
  question: string
  options: Array<{ value: string; label: string }>
  note: (value: string) => string
}

/** 성향 질문 — 답은 저장되고, 시작 시 적립액 기본값·주의 안내·알림 강도에 쓴다. 화면 한 장에 하나씩 보여준다 */
export const PROFILE_QUESTIONS: ProfileQuestion[] = [
  {
    key: 'reaction',
    question: '투자한 돈이 한 달 만에 20% 떨어졌다면?',
    options: [{ value: 'sell', label: '불안해서 팔 것 같다' }, { value: 'hold', label: '불안하지만 버틴다' }, { value: 'buy', label: '싸졌으니 더 사고 싶다' }],
    note: (v) => lossReactionNote(v as LossReaction),
  },
  {
    key: 'horizon',
    question: '이 돈을 얼마 동안 안 써도 되나요?',
    options: [{ value: 'short', label: '1년 안에 쓸 수 있다' }, { value: 'mid', label: '3~5년은 괜찮다' }, { value: 'long', label: '10년 이상 괜찮다' }],
    note: (v) => v === 'short' ? '1년 안에 쓸 돈은 주식에 맞지 않습니다. 하락 때 손실을 확정하고 나와야 할 수 있어요. 가상 계좌로 연습만 하는 걸 권합니다.' : v === 'mid' ? '3~5년이면 하락을 한 번 겪을 수 있는 기간입니다. 지수 중심이 맞습니다.' : '10년 이상이면 정기 적립이 가장 잘 맞는 기간입니다.',
  },
  {
    key: 'emergency',
    question: '생활비 3~6개월치 비상금이 따로 있나요?',
    options: [{ value: 'none', label: '없다' }, { value: 'some', label: '1~2개월치 정도' }, { value: 'enough', label: '3개월치 이상 있다' }],
    note: (v) => v === 'none' ? '비상금이 없으면 급할 때 하락장에서 팔게 됩니다. 매달 적립 기본값을 절반으로 낮추고, 비상금을 먼저 만드는 걸 권합니다.' : v === 'some' ? '조금 더 쌓아 두면 하락장에서 버티기 쉬워집니다.' : '비상금이 있어 하락을 버틸 여건이 됩니다.',
  },
  {
    key: 'checking',
    question: '계좌가 -10%일 때 얼마나 자주 들여다볼 것 같나요?',
    options: [{ value: 'often', label: '하루에도 여러 번' }, { value: 'weekly', label: '일주일에 한두 번' }, { value: 'rarely', label: '한 달에 한 번 정도' }],
    note: (v) => v === 'often' ? '자주 볼수록 흔들려서 규칙을 어기기 쉽습니다. 알림은 중요한 것만 받고, 확인은 주 1회로 정해 두세요.' : v === 'weekly' ? '주 1~2회 확인이면 적당합니다.' : '가끔만 보는 건 정기 적립에 가장 잘 맞는 습관입니다.',
  },
  {
    key: 'experience',
    question: '주식·펀드 투자 경험이 있나요?',
    options: [{ value: 'none', label: '처음이다' }, { value: 'some', label: '1~3년' }, { value: 'lots', label: '3년 이상' }],
    note: (v) => v === 'none' ? '처음이면 가상 계좌에서 몇 달 지켜본 뒤 실제 계좌로 넘어가세요. 화면 설명을 자세히 보여드립니다.' : v === 'some' ? '기본은 아시니 규칙을 지키는 연습에 집중하면 됩니다.' : '경험이 있어도 정해진 규칙대로만 넣는 것이 핵심입니다.',
  },
]

export const emergencyMonthlyFactor = (emergency: string): number => (emergency === 'none' ? 0.5 : 1)

export function profileComplete(p: InvestorProfile): boolean {
  return PROFILE_QUESTIONS.every((q) => q.options.some((o) => o.value === p[q.key]))
}

export type AutoTradePreset = {
  monday_buy_slots: number; max_positions: number; min_buy_score: number
  take_profit_pct: number; stop_loss_pct: number; long_term_ratio: number; selected_strategy: string
}

export type PersonalSetup = {
  /** 'index_hold'는 종목 선별 없이 코스피200 ETF를 정기 적립 — 10년·30년 검증에서 종목 봇이 지수를 못 이겨 모두에게 기본으로 둔다 */
  strategyMode: 'index_hold' | 'stock'
  level: 'safe' | 'balanced'
  preset: AutoTradePreset
  /** 사용자에게 보여줄 "이렇게 맞춰 두었어요" 목록 */
  summary: string[]
}

// 서비스의 buildDefaultSettingForChat(safe / balanced)과 같은 값 — 종목 봇으로 바꿀 때 바로 쓸 수 있게 미리 맞춰 둔다
const SAFE_PRESET: AutoTradePreset = { monday_buy_slots: 2, max_positions: 6, min_buy_score: 70, take_profit_pct: 8, stop_loss_pct: 4, long_term_ratio: 75, selected_strategy: 'HOLD_SAFE' }
const BALANCED_PRESET: AutoTradePreset = { monday_buy_slots: 2, max_positions: 8, min_buy_score: 72, take_profit_pct: 9, stop_loss_pct: 4, long_term_ratio: 65, selected_strategy: 'SWING' }

/** 성향 답 → 실제 설정. 초보가 설정 화면을 찾아다니지 않도록 시작할 때 한 번에 적용한다 */
export function personalSetup(p: InvestorProfile, monthly: number): PersonalSetup {
  const score = (['sell', 'hold', 'buy'].indexOf(p.reaction))
    + (['short', 'mid', 'long'].indexOf(p.horizon))
    + (['none', 'some', 'enough'].indexOf(p.emergency))
    + (['often', 'weekly', 'rarely'].indexOf(p.checking))
    + (['none', 'some', 'lots'].indexOf(p.experience))
  // 1년 안에 쓸 돈이거나 점수가 낮으면 보수적으로 — 균형형도 지수 보유 모드에서는 차이가 없고, 종목 봇으로 바꿀 때만 쓰인다
  const level: PersonalSetup['level'] = p.horizon === 'short' || score <= 4 ? 'safe' : 'balanced'
  const summary = [
    '자동매매 방식: 종목을 고르지 않고 코스피200 ETF를 매달 적립해 보유 (검증에서 종목 매매가 지수를 이기지 못했습니다)',
    `매달 가상 적립: ${Math.round(monthly).toLocaleString('ko-KR')}원${p.emergency === 'none' ? ' (비상금이 없어 기본 제안을 절반으로 낮췄습니다)' : ''}`,
    `종목 봇으로 바꿀 때의 기본값: ${level === 'safe' ? '안전형 (손절 4%, 최대 6종목)' : '균형형 (손절 4%, 최대 8종목)'}`,
  ]
  if (p.checking === 'often') summary.push('자주 확인하는 편이라 하락 때 팔지 않도록 규칙 안내를 크게 보여드립니다')
  if (p.experience === 'none') summary.push('처음이라 화면 설명을 자세히 보여드립니다')
  return { strategyMode: 'index_hold', level, preset: level === 'safe' ? SAFE_PRESET : BALANCED_PRESET, summary }
}
