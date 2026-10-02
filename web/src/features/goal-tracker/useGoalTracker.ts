import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { useCurrentChatId } from '../../stores/profileStore'

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
  schedule: Array<{ month: string; months: number; contribution: number; isTarget: boolean }>
  normalRange: { plusMonthsPct: number; p10: number; worst: number; maxLosingStreak: number; source: string }
  contributionLinked?: boolean
  progress?: {
    principal: number
    growth: number
    growthPct: number
    crossover: { monthlyExpected: number; contribution: number; ratioPct: number; months: number | null; month: string | null } | null
  }
}

export const man = (v: number) => `${Math.round(v / 10_000).toLocaleString('ko-KR')}만원`
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
