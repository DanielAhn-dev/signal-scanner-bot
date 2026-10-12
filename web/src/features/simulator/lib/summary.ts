import type { HighlightPlanItem } from '../planStore'
import {
  calcExpectedValue,
  calcKelly,
  calcMaxPortfolioLoss,
  calcRR,
  calcScenarioNet,
  calcSplitInvested,
  getTradeGrade,
} from '../telegramFormat'
import { SCENARIOS } from '../constants'

export function calcSummary(input: { items: HighlightPlanItem[]; fillRatePct: number; feePct: number; taxPct: number; totalCapital: number }) {
  const { items, fillRatePct, feePct, taxPct, totalCapital } = input
  const allocated = items.reduce((acc, row) => acc + Number(row.amount || 0), 0)
  const splitInvested = items.reduce((acc, row) => acc + calcSplitInvested(row, fillRatePct), 0)
  const ev = items.reduce((acc, row) => acc + calcExpectedValue(row), 0)
  const feeTax = splitInvested * ((feePct + taxPct) / 100)
  const maxLoss = calcMaxPortfolioLoss(items)
  return {
    allocated,
    splitInvested,
    ev,
    evAfterCost: ev - feeTax,
    feeTax,
    remaining: totalCapital - allocated,
    maxLoss,
  }
}

export function calcScenarioRows(items: HighlightPlanItem[], fillRatePct: number, feePct: number, taxPct: number) {
  return SCENARIOS.map((pct) => ({
    pct,
    net: calcScenarioNet(items, pct, fillRatePct, feePct, taxPct),
  }))
}

export function calcItemMeta(items: HighlightPlanItem[], fillRatePct: number) {
  return items.map((item) => ({
    rr: calcRR(item),
    kelly: calcKelly(item),
    grade: getTradeGrade(item),
    ev: calcExpectedValue(item),
    splitInvested: calcSplitInvested(item, fillRatePct),
  }))
}
