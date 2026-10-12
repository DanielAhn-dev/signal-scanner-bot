import type { DecisionRow } from '../types'

export function summarizeDecisions(rows: DecisionRow[]) {
  const total = rows.length
  const autoCount = rows.filter((row) => !!row.is_auto).length
  const buyCount = rows.filter((row) => String(row.action || '').toUpperCase() === 'BUY').length
  const sellCount = rows.filter((row) => String(row.action || '').toUpperCase() === 'SELL').length

  const triggerCount = new Map<string, number>()
  const versionCount = new Map<string, number>()
  const regimeCount = new Map<string, number>()

  for (const row of rows) {
    const trigger = String(row.trigger_label || '').trim()
    const version = String(row.strategy_version || '').trim()
    const regime = String(row.market_regime || '').trim()

    if (trigger) triggerCount.set(trigger, (triggerCount.get(trigger) || 0) + 1)
    if (version) versionCount.set(version, (versionCount.get(version) || 0) + 1)
    if (regime) regimeCount.set(regime, (regimeCount.get(regime) || 0) + 1)
  }

  return {
    total,
    autoCount,
    buyCount,
    sellCount,
    autoRatio: total > 0 ? Math.round((autoCount / total) * 100) : 0,
    topTriggers: Array.from(triggerCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8),
    topVersions: Array.from(versionCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5),
    topRegimes: Array.from(regimeCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5),
  }
}
