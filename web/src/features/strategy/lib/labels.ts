import { MARKET_REGIME_LABEL_MAP, TRIGGER_LABEL_MAP } from '../constants'

export function formatTriggerLabel(value: string): string {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return '-'
  return TRIGGER_LABEL_MAP[normalized] || normalized.replace(/-/g, ' ')
}

export function formatMarketRegimeLabel(value: string): string {
  const normalized = String(value || '').trim().toLowerCase()
  if (!normalized) return '-'
  return MARKET_REGIME_LABEL_MAP[normalized] || value
}
