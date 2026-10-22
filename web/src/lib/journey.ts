import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from './api'

/**
 * '다음 할 일' 길잡이 — 금융 지식이 없어도 순서대로 따라오면 적어도 큰 손실은 피하도록 이미 있는 화면을 한 줄로 잇는다.
 * 새 기능이 아니라 순서다. 각 단계가 끝났는지는 이미 저장된 값으로만 판단한다(따로 체크하게 하지 않는다).
 *
 * 들어오는 길이 둘이다(2026-10-16). 처음 시작하는 사람은 투자할 돈을 찾는 게 곧 내 문제라 지출 점검이 먼저,
 * 이미 투자 중인 사람은 지금 계좌가 고민이라 계좌부터 — 진단에서 "새 돈부터 옮겨요"를 본 뒤에 지출 점검이 자연스럽다.
 * 두 길은 '새 돈은 지수로'부터 같아진다.
 *
 *  처음 시작해요 (start)                          이미 투자하고 있어요 (invested)
 *  1 내 돈 점검      ← money_flow_checks           1 지금 계좌 넣기     ← 실계좌 보유 1건 이상
 *  2 시작하기        ← 시드 + 성향 답(가상 계좌)     2 계좌 진단·할 일    ← 리밸런싱 가이드에서 직접 남긴 점검 기록(자동 기록 제외)
 *  3 매달 넣기       ← 가상 계좌 월 적립액           3 내 돈 점검         ← money_flow_checks
 *  4 떨어질 때 할 일  ← dropPlan                    4 새 돈은 지수로      ← 적립 기록(accumulate.deposits) 1건 이상
 *  5 한 달에 한 번    ← 앞 단계를 다 마치면 계속       5 떨어질 때 할 일 / 6 한 달에 한 번(계좌 건강)
 *
 * 가상 계좌는 이미 투자 중인 길에서 단계가 아니라 옆길이다('새 돈은 지수로' 카드의 링크).
 * 길을 고르지 않았으면 실계좌가 있으면 invested, 시드가 있으면 start로 본다. 둘 다 없으면 홈에서 고르게 한다.
 */
export type EntryPath = 'start' | 'invested'

export type JourneyFacts = {
  hasCheck: boolean
  hasAccount: boolean
  hasProfile: boolean
  monthlyDeposit: number
  hasDropPlan: boolean
  /** 사용자가 고른 길(user-state entryPath). 없으면 아래 사실로 추정 */
  entryPath?: EntryPath | null
  hasRealHoldings?: boolean
  hasManualCheck?: boolean
  hasRealDeposit?: boolean
}

export type JourneyStepKey = 'money' | 'start' | 'monthly' | 'drop' | 'checkin' | 'holdings' | 'review'
export type JourneyStep = {
  key: JourneyStepKey
  label: string
  desc: string
  why: string
  route: string
  done: boolean
  /** 단계는 아니지만 함께 보여 줄 옆길 */
  side?: { label: string; route: string }
}

export type Journey = {
  steps: JourneyStep[]
  next: JourneyStep
  doneCount: number
  /** 실제로 쓰는 길. null이면 아직 고르지 않았고 추정할 근거도 없다 */
  path: EntryPath | null
}

export function resolveEntryPath(f: JourneyFacts): EntryPath | null {
  if (f.entryPath === 'start' || f.entryPath === 'invested') return f.entryPath
  if (f.hasRealHoldings) return 'invested'
  if (f.hasAccount) return 'start'
  return null
}

export function computeJourney(f: JourneyFacts): Journey {
  const path = resolveEntryPath(f)
  const drop: JourneyStep = { key: 'drop', label: '떨어질 때 할 일', route: 'plan-sim#drop-plan', done: f.hasDropPlan,
    desc: '얼마나 떨어지면 불안할지와, 팔고 싶어질 때 먼저 할 일을 미리 적어 둡니다.', why: '큰 손실은 대부분 떨어졌을 때 겁나서 파는 데서 생깁니다.' }
  const steps: JourneyStep[] = path === 'invested'
    ? [
        { key: 'holdings', label: '지금 계좌 넣기', route: 'portfolio?account=real', done: !!f.hasRealHoldings,
          desc: '증권 계좌에 있는 종목과 수량을 넣습니다. 수익률이 아니라 지금 구조를 보려는 것입니다.', why: '무엇을 얼마나 들고 있는지 알아야 무엇부터 옮길지 정할 수 있습니다.' },
        { key: 'review', label: '계좌 진단·할 일', route: 'income-guide', done: !!f.hasManualCheck,
          desc: '쏠림·겹침·보수를 보고 할 일 3개를 확인합니다. 확인한 뒤 "오늘 비중 기록"을 눌러 두면 끝납니다.', why: '손실 난 종목을 억지로 팔지 않아요. 수익 난 몫과 새 돈부터 차근차근 옮겨요.' },
        { key: 'money', label: '내 돈 점검', route: 'budget', done: f.hasCheck,
          desc: '고정·변동 지출을 나눠 매달 새로 넣을 수 있는 금액을 압니다.', why: '옮길 새 돈은 쓰고 남는 데서 나옵니다. 쓸 돈까지 넣으면 떨어졌을 때 팔 수밖에 없습니다.' },
        { key: 'monthly', label: '새 돈은 지수로', route: 'accumulate', done: !!f.hasRealDeposit,
          desc: '매달 같은 날 같은 금액을 지수 ETF에 넣고 기록합니다. 개별 종목을 새로 사지 않습니다.', why: '개별 종목 고르기는 검증에서 지수보다 나은 근거가 없었습니다.',
          side: { label: '실제로 넣기 전에 가상으로 먼저 굴려 보기', route: 'start' } },
        drop,
        { key: 'checkin', label: '한 달에 한 번 확인', route: 'choices', done: false,
          desc: '처음 넣었을 때와 지금, 계좌 구조가 얼마나 바뀌었는지 한 달에 한 번만 봅니다.', why: '자주 볼수록 흔들려 사고팔게 됩니다.' },
      ]
    : [
        { key: 'money', label: '내 돈 점검', route: 'budget', done: f.hasCheck,
          desc: '고정·변동 지출을 나눠 실제로 투자할 수 있는 금액을 압니다.', why: '쓸 돈까지 투자하면 떨어졌을 때 팔 수밖에 없습니다.' },
        { key: 'start', label: '시작하기', route: 'start', done: f.hasAccount && f.hasProfile,
          desc: '성향 질문에 답하고 가상 계좌로 시작합니다. 실제 돈은 들어가지 않습니다.', why: '내 성향에 맞는 주식 비중과 적립 기본값이 정해집니다.' },
        { key: 'monthly', label: '매달 넣기', route: 'accumulate', done: f.monthlyDeposit >= 10_000,
          desc: '검증한 지수 ETF에 매달 같은 날 같은 금액을 넣습니다. 종목을 고르지 않습니다.', why: '개별 종목 고르기는 검증에서 지수보다 나은 근거가 없었습니다.' },
        drop,
        { key: 'checkin', label: '한 달에 한 번 확인', route: 'goal-tracker', done: false,
          desc: '적립이 들어갔는지, 목표까지 어디쯤인지 한 달에 한 번만 봅니다.', why: '자주 볼수록 흔들려 사고팔게 됩니다.' },
      ]
  const next = steps.find((s) => !s.done)!
  return { steps, next, doneCount: steps.filter((s) => s.done).length, path }
}

export type JourneyHandle = Journey & {
  /** 길을 서버에 저장한다. 저장이 확인된 뒤에만 화면을 바꾸고, 실패하면 false */
  choosePath: (path: EntryPath) => Promise<boolean>
}

/** 길잡이에 필요한 사실을 모은다. 조회가 실패한 항목은 '안 함'으로 본다(막지 않고 안내만 하므로 안전한 쪽) */
export function useJourney(enabled: boolean): JourneyHandle | null {
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
      safe(apiFetch('/api/ui/income-guide?summary=1', { cacheMs: 0, retries: 0 })),
    ]).then(([prefs, state, flow, guide]) => {
      if (cancelled) return
      const entry = state?.data?.entryPath?.value
      const deposits = state?.data?.accumulate?.value?.deposits
      setFacts({
        hasCheck: Array.isArray(flow?.checks) && flow.checks.length > 0,
        hasAccount: Number(prefs?.data?.virtual_seed_capital) > 0,
        hasProfile: !!state?.data?.investorProfile?.value,
        monthlyDeposit: Number(prefs?.data?.monthly_deposit) || 0,
        hasDropPlan: !!state?.data?.dropPlan?.value,
        entryPath: entry === 'start' || entry === 'invested' ? entry : null,
        hasRealHoldings: Number(guide?.data?.holdingCount) > 0,
        hasManualCheck: Number(guide?.data?.manualRecords) > 0,
        hasRealDeposit: Array.isArray(deposits) && deposits.length > 0,
      })
    })
    return () => { cancelled = true }
  }, [enabled])
  const choosePath = useCallback(async (path: EntryPath) => {
    try {
      const res = await apiFetch('/api/ui/user-state', { method: 'POST', body: JSON.stringify({ key: 'entryPath', value: path }), cacheMs: 0, retries: 0 })
      if (!res?.ok) return false
      setFacts((f) => (f ? { ...f, entryPath: path } : f))
      return true
    } catch {
      return false
    }
  }, [])
  return facts ? { ...computeJourney(facts), choosePath } : null
}
