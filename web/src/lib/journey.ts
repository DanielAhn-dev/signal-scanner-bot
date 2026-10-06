import { useEffect, useState } from 'react'
import { apiFetch } from './api'

/**
 * '다음 할 일' 길잡이 — 금융 지식이 없어도 순서대로 따라오면 적어도 큰 손실은 피하도록 이미 있는 화면을 한 줄로 잇는다.
 * 새 기능이 아니라 순서다. 각 단계가 끝났는지는 이미 저장된 값으로만 판단한다(따로 체크하게 하지 않는다).
 *
 *  1 내 돈 점검      지출을 나눠 실제 투자 가능액과 못 줄이는 생활비(비상자금 기준)를 안다      ← money_flow_checks
 *  2 시작하기        성향에 맞춰 가상 계좌로 시작한다(실제 돈 아님)                               ← 시드 + 성향 답
 *  3 매달 넣기       검증한 지수 ETF에 매달 같은 금액. 종목 고르기 아님                            ← 월 적립액
 *  4 떨어질 때 할 일  감내 낙폭과 '팔고 싶어지면 먼저 할 일'을 미리 적어 둔다(공포 매도 방지)        ← dropPlan
 *  5 한 달에 한 번    목표와 적립 진행만 확인. 매일 보지 않는다                                     ← 앞 단계를 다 마치면 계속
 *
 * 1은 건너뛸 수 있다(시작하기에서 대략 적은 사람). 그래도 끝나지 않은 단계로 남겨 언제든 돌아오게 한다.
 */
export type JourneyFacts = {
  hasCheck: boolean
  hasAccount: boolean
  hasProfile: boolean
  monthlyDeposit: number
  hasDropPlan: boolean
}

export type JourneyStepKey = 'money' | 'start' | 'monthly' | 'drop' | 'checkin'
export type JourneyStep = { key: JourneyStepKey; label: string; desc: string; why: string; route: string; done: boolean }

export function computeJourney(f: JourneyFacts): { steps: JourneyStep[]; next: JourneyStep; doneCount: number } {
  const steps: JourneyStep[] = [
    { key: 'money', label: '내 돈 점검', route: 'money-flow?tab=check', done: f.hasCheck,
      desc: '고정·변동 지출을 나눠 실제로 투자할 수 있는 금액을 압니다.', why: '쓸 돈까지 투자하면 떨어졌을 때 팔 수밖에 없습니다.' },
    { key: 'start', label: '시작하기', route: 'start', done: f.hasAccount && f.hasProfile,
      desc: '성향 질문에 답하고 가상 계좌로 시작합니다. 실제 돈은 들어가지 않습니다.', why: '내 성향에 맞는 주식 비중과 적립 기본값이 정해집니다.' },
    { key: 'monthly', label: '매달 넣기', route: 'accumulate', done: f.monthlyDeposit >= 10_000,
      desc: '검증한 지수 ETF에 매달 같은 날 같은 금액을 넣습니다. 종목을 고르지 않습니다.', why: '개별 종목 고르기는 검증에서 지수보다 나은 근거가 없었습니다.' },
    { key: 'drop', label: '떨어질 때 할 일', route: 'mix', done: f.hasDropPlan,
      desc: '얼마나 떨어지면 불안할지와, 팔고 싶어질 때 먼저 할 일을 미리 적어 둡니다.', why: '큰 손실은 대부분 떨어졌을 때 겁나서 파는 데서 생깁니다.' },
    { key: 'checkin', label: '한 달에 한 번 확인', route: 'goal-tracker', done: false,
      desc: '적립이 들어갔는지, 목표까지 어디쯤인지 한 달에 한 번만 봅니다.', why: '자주 볼수록 흔들려 사고팔게 됩니다.' },
  ]
  const next = steps.find((s) => !s.done)!
  return { steps, next, doneCount: steps.filter((s) => s.done).length }
}

/** 길잡이에 필요한 사실을 모은다. 조회가 실패한 항목은 '안 함'으로 본다(막지 않고 안내만 하므로 안전한 쪽) */
export function useJourney(enabled: boolean): ReturnType<typeof computeJourney> | null {
  const [facts, setFacts] = useState<JourneyFacts | null>(null)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
    const safe = (p: Promise<any>) => p.catch(() => null)
    Promise.all([
      safe(apiFetch('/api/ui/investment-prefs', { cacheMs: 0, retries: 0 })),
      safe(apiFetch('/api/ui/user-state', { cacheMs: 0, retries: 0 })),
      safe(apiFetch(`/api/ui/money-flow?from=${today}&to=${today}`, { cacheMs: 0, retries: 0 })),
    ]).then(([prefs, state, flow]) => {
      if (cancelled) return
      setFacts({
        hasCheck: Array.isArray(flow?.checks) && flow.checks.length > 0,
        hasAccount: Number(prefs?.data?.virtual_seed_capital) > 0,
        hasProfile: !!state?.data?.investorProfile?.value,
        monthlyDeposit: Number(prefs?.data?.monthly_deposit) || 0,
        hasDropPlan: !!state?.data?.dropPlan?.value,
      })
    })
    return () => { cancelled = true }
  }, [enabled])
  return facts ? computeJourney(facts) : null
}
