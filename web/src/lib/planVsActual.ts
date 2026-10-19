/**
 * 따라 사기 화면 '계획 vs 실제' — 달마다 [가상] 계좌가 계획대로 산 것과 [실제] 내 계좌에서 한 일을 나란히 놓는다.
 * 제품 가치는 수익 우위가 아니라 "계획을 지켰나"이므로 지킨 달 수를 먼저 센다(2026-10-19).
 *
 *   - 실제: 홈 '이번 달 할 일' 답(user-state 'accumulate'.tasks, lib/monthTask.ts). 답이 없어도 실계좌 거래 메모
 *     'month-task:YYYY-MM'이 있으면 산 달로 본다.
 *   - 계획: 가상 계좌가 그달 산 지수 ETF(봇 거래 메모 전략이 지수 보유·유휴현금 스윕)가 있으면 그 수량,
 *     없으면 계획 금액(plan.monthly)을 그달 가격으로 나눈 '살 수 있었던 주수'(buyQuantity).
 *   - 'later'(다음 달부터 시작)는 아직 시작 전이라 지킴/건너뜀 분모에서 뺀다.
 *   - 구성(여러 지수)으로 답한 달은 줄마다(lines): 계획은 그 줄 금액 ÷ 그달 가격, 실제는 산 주수(0이면 그 지수는 건너뜀).
 *     한 줄이라도 샀으면 그달은 지킴으로 센다.
 */
import { buyQuantity, type MonthTaskRecord } from './monthTask'
import { parseStrategyMemo } from '../../../src/lib/strategyMemo'

export type PlanTrade = { code: string; name?: string | null; side: 'BUY' | 'SELL'; price: number; quantity: number; tradedAt: string; memo?: string | null }

export type PlanVsActualResult = 'kept' | 'skipped' | 'notStarted'

export type PlanVsActualLine = { name: string; qty: number | null }

export type PlanVsActualRow = {
  ym: string
  plan: { name: string | null; qty: number | null; amount: number; source: 'virtual' | 'estimate'; lines?: PlanVsActualLine[] }
  actual: { status: MonthTaskRecord['status']; name: string | null; qty: number | null; price: number | null; lines?: PlanVsActualLine[] }
  result: PlanVsActualResult
}

export type PlanVsActualSummary = { rows: PlanVsActualRow[]; kept: number; counted: number }

/** 가상 계좌가 계획대로 산 지수 ETF 거래 — 종목 봇 거래는 계획 매수가 아니다 */
const PLAN_STRATEGY_IDS = new Set(['index-hold.v1', 'index-lev15.v1', 'cash-sweep.v1'])
const MONTH_TASK_RE = /(?:^|\s)month-task:(\d{4}-\d{2})/

/** KST 기준 YYYY-MM */
const kstYm = (iso: string) => {
  const t = Date.parse(iso)
  return Number.isFinite(t) ? new Date(t + 9 * 3_600_000).toISOString().slice(0, 7) : iso.slice(0, 7)
}

export function parseMonthTaskMemo(memo: string | null | undefined): string | null {
  const m = MONTH_TASK_RE.exec(String(memo ?? ''))
  return m ? m[1] : null
}

export function buildPlanVsActual(input: {
  tasks: Record<string, MonthTaskRecord> | undefined
  monthly: number
  bot: PlanTrade[]
  real: PlanTrade[]
}): PlanVsActualSummary {
  const tasks = input.tasks ?? {}

  // 답이 없어도 '이번 달 할 일'로 산 실계좌 거래가 있으면 그달은 산 달
  const realByYm = new Map<string, { name: string | null; qty: number; cost: number; code: string }>()
  for (const t of input.real) {
    const ym = parseMonthTaskMemo(t.memo)
    if (!ym || t.side !== 'BUY') continue
    const cur = realByYm.get(ym) ?? { name: t.name ?? null, qty: 0, cost: 0, code: t.code }
    cur.qty += t.quantity
    cur.cost += t.quantity * t.price
    realByYm.set(ym, cur)
  }

  const botByYm = new Map<string, { name: string | null; qty: number }>()
  for (const t of input.bot) {
    if (t.side !== 'BUY' || !PLAN_STRATEGY_IDS.has(parseStrategyMemo(t.memo).strategyId)) continue
    const ym = kstYm(t.tradedAt)
    const cur = botByYm.get(ym) ?? { name: t.name ?? null, qty: 0 }
    cur.qty += t.quantity
    botByYm.set(ym, cur)
  }

  const months = [...new Set([...Object.keys(tasks), ...realByYm.keys()])].sort((a, b) => b.localeCompare(a))
  const rows: PlanVsActualRow[] = months.map((ym) => {
    const rec = tasks[ym]
    const trade = realByYm.get(ym)
    const status: MonthTaskRecord['status'] = rec?.status ?? 'bought'
    const actualPrice = rec?.price ?? (trade && trade.qty > 0 ? trade.cost / trade.qty : null)
    const actual = status === 'bought'
      ? { status, name: rec?.name ?? trade?.name ?? rec?.code ?? trade?.code ?? null, qty: rec?.qty ?? trade?.qty ?? null, price: actualPrice }
      : { status, name: null, qty: null, price: null }

    const multi = status === 'bought' && rec?.lines && rec.lines.length > 1 ? rec.lines : null
    if (multi) (actual as PlanVsActualRow['actual']).lines = multi.map((l) => ({ name: l.name, qty: l.qty }))

    const bot = botByYm.get(ym)
    // 가상 계좌는 아직 코스피200만 산다 — 구성으로 답한 달은 계획도 줄마다 계획 금액으로 살 수 있었던 주수
    const plan: PlanVsActualRow['plan'] = multi
      ? { name: null, qty: null, amount: input.monthly, source: 'estimate', lines: multi.map((l) => ({ name: l.name, qty: buyQuantity(l.planAmount ?? 0, l.price).qty })) }
      : bot
        ? { name: bot.name, qty: bot.qty, amount: input.monthly, source: 'virtual' }
        : { name: actual.name, qty: buyQuantity(input.monthly, actualPrice).qty, amount: input.monthly, source: 'estimate' }

    const result: PlanVsActualResult = status === 'bought' ? 'kept' : status === 'skipped' ? 'skipped' : 'notStarted'
    return { ym, plan, actual, result }
  })

  const counted = rows.filter((r) => r.result !== 'notStarted').length
  const kept = rows.filter((r) => r.result === 'kept').length
  return { rows, kept, counted }
}
