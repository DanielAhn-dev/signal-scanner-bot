import type { SignalTone } from '../types'

export function toneStyle(tone: SignalTone): { bg: string; color: string; border: string } {
  if (tone === 'positive') return { bg: 'var(--color-success-bg)', color: 'var(--color-success)', border: 'rgba(0,180,147,0.2)' }
  if (tone === 'negative') return { bg: 'var(--color-error-bg)', color: 'var(--color-error)', border: 'rgba(240,68,82,0.2)' }
  if (tone === 'warning') return { bg: 'var(--color-warning-bg)', color: 'var(--color-warning)', border: 'rgba(200,140,0,0.2)' }
  return { bg: 'var(--color-bg-sunken)', color: 'var(--color-text-secondary)', border: 'var(--color-border-default)' }
}

export function scoreColor(score: number | null): string {
  if (score == null) return 'var(--color-text-tertiary)'
  if (score >= 70) return 'var(--color-success)'
  if (score >= 50) return 'var(--color-warning)'
  return 'var(--color-error)'
}

export function advisorStatusStyle(status?: string): { background: string; color: string } {
  if (!status) return { background: 'var(--color-bg-sunken)', color: 'var(--color-text-secondary)' }
  const s = status.toLowerCase()
  if (s === 'strong_buy' || s === 'buy') {
    return { background: 'var(--color-success-bg)', color: 'var(--color-success)' }
  }
  if (s.includes('partial') || s === 'watch') {
    return { background: 'var(--color-warning-bg)', color: 'var(--color-warning)' }
  }
  return { background: 'var(--color-error-bg)', color: 'var(--color-error)' }
}

export function regimeLabel(regime?: string): string {
  const r = String(regime || '').toLowerCase()
  if (r === 'risk_on') return '리스크온'
  if (r === 'risk_off') return '리스크오프'
  if (r === 'hold') return '중립/HOLD'
  return '—'
}

export function twoStageActionStyle(action?: string): { background: string; color: string } {
  const a = String(action || '').toLowerCase()
  if (a === 'aggressive_buy' || a === 'pilot_buy') {
    return { background: 'var(--color-success-bg)', color: 'var(--color-success)' }
  }
  if (a === 'reduce' || a === 'hold') {
    return { background: 'var(--color-warning-bg)', color: 'var(--color-warning)' }
  }
  return { background: 'var(--color-error-bg)', color: 'var(--color-error)' }
}
