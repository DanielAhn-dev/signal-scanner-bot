import { useCallback, useEffect, useState } from 'react'
import { formatKrwMan } from '../../lib/format'
import { apiFetch } from '../../lib/api'
import { useCurrentChatId } from '../../stores/profileStore'
import type { LifePlan } from '../../../../src/services/goalTracker'
import { seedExpenseTotal } from '../../../../src/lib/moneyFlow'

export type GoalView = {
  today: string
  settings: {
    startDate: string
    startEquity: number
    planAnnualPct: number
    withdrawalPct?: number
    targetMonthlyProfit: number
    monthlyContribution: number
    targetDate?: string
  }
  equity: number
  plan: { monthsElapsed: number; planValue: number; gapPct: number }
  target: { requiredSeed: number; progressPct: number; monthsToReach: number | null; etaMonth: string | null }
  thisMonth: {
    expectedProfit: number
    returnPct: number | null
    realizedSwing: number
    realizedSweep: number
    sells: number
    wins: number
    assessment: { level: string; text: string } | null
  }
  phase: { stage: 1 | 2; title: string; text: string }
  currentMonthlyProfit: number
  currentMonthlyWithdrawal: number
  schedule: Array<{ month: string; months: number; contribution: number; contributionLow?: number; isTarget: boolean; isRetire?: boolean }>
  life?: LifePlan | null
  normalRange: { plusMonthsPct: number; p10: number; worst: number; maxLosingStreak: number; source: string }
  contributionLinked?: boolean
  /** 월말 평가액 기록 — 배포 전 API에는 없다 */
  trail?: Array<{ date: string; total: number }>
  progress?: {
    principal: number
    growth: number
    growthPct: number
    crossover: { monthlyExpected: number; contribution: number; ratioPct: number; months: number | null; month: string | null } | null
  }
  /**
   * 목표 계산 기준 (서버 src/services/goalTracker.ts) — 자산은 [실제] 내 계좌(없으면 가상), 수익률은 내 구성 과거 이력(보통).
   * 계획선 대비·이번 달은 [가상] 봇 계좌(virtualEquity). 배포 전 API에는 없다
   */
  basis?: {
    assetSource: 'real' | 'virtual'
    ratePct: number
    rateSource: 'history' | 'assumed'
    rates: { typicalPct: number; lowPct: number; years: number; from: string; asOf: string; label: string } | null
    etaLowMonth: string | null
    etaAssumedMonth: string | null
    virtualEquity: number
  }
}

export const man = formatKrwMan
export const signed = (v: number) => `${v >= 0 ? '+' : ''}${man(v)}`

/**
 * 목표 트래커 데이터 — 계산은 src/services/goalTracker.ts (금요일 텔레그램 보고와 같은 값).
 * 프로필 스토어 hydration 전에 부르면 chat_id 없이 400이 나므로 chatId가 생긴 뒤에 읽는다.
 */
export function useGoalTracker() {
  const chatId = useCurrentChatId()
  const [view, setView] = useState<GoalView | null>(null)
  const [reason, setReason] = useState<string | null>(null)

  const load = useCallback(async (init?: { method: string; body: string }): Promise<boolean> => {
    try {
      const res = await apiFetch('/api/ui/goal-tracker', { cacheMs: 0, timeoutMs: 15_000, ...(init ?? {}) })
      setView(res?.data ?? null)
      setReason(res?.data ? null : res?.reason ?? res?.error ?? null)
      return Boolean(res?.data)
    } catch (e: unknown) {
      setReason(e instanceof Error ? e.message : String(e))
      return false
    }
  }, [])

  useEffect(() => {
    if (chatId) void load()
  }, [chatId, load])

  return { view, reason, load }
}

export type MonthlySurplus = { average: number; months: string[] }


/**
 * 우리 집 매달 남는 돈 = 고정 수입(본인 + 맞벌이 배우자) − 지출 − 예비비. 보너스·환급 같은 비정기 수입은 뺀다.
 * 시드 만들기의 달별 기록(seed-builder)에서 최근 3개월 평균. 기록이 없으면 null.
 * 시드 만들기 화면의 "여력"과 같은 식이다(그 화면은 같은 값에서 비정기 수입만 더한다).
 */
export function useMonthlySurplus(today: string | undefined): MonthlySurplus | null | undefined {
  const [value, setValue] = useState<MonthlySurplus | null | undefined>(undefined)
  useEffect(() => {
    if (!today) return
    let alive = true
    const year = Number(today.slice(0, 4))
    const get = (y: number) =>
      apiFetch(`/api/ui/seed-builder?year=${y}`, { cacheMs: 60_000, retries: 0 })
        .then((res) => (Array.isArray(res?.data) ? res.data : []))
        .catch(() => [])
    Promise.all([get(year - 1), get(year)]).then(([a, b]) => {
      if (!alive) return
      const rows = [...a, ...b]
        .filter((r: any) => r?.status !== 'skipped' && String(r?.month) <= today.slice(0, 7))
        .map((r: any) => {
          const income = (Number(r.ownIncome) || 0) + (r.household === 'dual-income' ? Number(r.partnerIncome) || 0 : 0)
          return { month: String(r.month), income, left: income - seedExpenseTotal(r.expenses) - (Number(r.reserve) || 0) }
        })
        .filter((r) => r.income > 0)
        .sort((x, y) => x.month.localeCompare(y.month))
        .slice(-3)
      setValue(rows.length ? { average: Math.round(rows.reduce((t, r) => t + r.left, 0) / rows.length), months: rows.map((r) => r.month) } : null)
    })
    return () => {
      alive = false
    }
  }, [today])
  return value
}
