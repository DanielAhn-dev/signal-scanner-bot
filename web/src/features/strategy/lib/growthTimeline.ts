import { formatKstDateTime } from '../../../lib/format'
import type { DecisionRow } from '../types'
import { formatMarketRegimeLabel, formatTriggerLabel } from './labels'

export type GrowthEvent = { key: string; time: string; kind: 'version' | 'regime'; text: string; subtitle: string }

export function buildGrowthTimeline(rows: DecisionRow[]): GrowthEvent[] {
  const events: GrowthEvent[] = []
  let prevVersion = ''
  let prevRegime = ''

  for (const row of rows) {
    const created = formatKstDateTime(row.created_at)
    const version = String(row.strategy_version || '').trim()
    const regime = String(row.market_regime || '').trim()
    const action = String(row.action || '').toUpperCase()
    const code = row.stock_name || row.code || '-'
    const trigger = String(row.trigger_label || '').trim()

    if (version && version !== prevVersion) {
      events.push({
        key: `v-${row.id ?? Math.random()}`,
        time: created,
        kind: 'version',
        text: `전략 버전 전환 → ${version}`,
        subtitle: `${code} · ${action || '-'}`,
      })
      prevVersion = version
    }

    if (regime && regime !== prevRegime) {
      events.push({
        key: `r-${row.id ?? Math.random()}`,
        time: created,
        kind: 'regime',
        text: `시장 국면 전환 → ${formatMarketRegimeLabel(regime)}`,
        subtitle: `${code} · ${action || '-'}${trigger ? ` · ${formatTriggerLabel(trigger)}` : ''}`,
      })
      prevRegime = regime
    }
  }

  return events.slice(0, 30)
}
