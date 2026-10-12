import type { RiskMode } from '../types'

export function applyRiskMode(v: number | null, mode: RiskMode, kind: 'target' | 'stop'): number | null {
  if (v == null) return null
  const targetFactor: Record<RiskMode, number> = {
    conservative: 0.85,
    neutral: 1,
    aggressive: 1.18,
  }
  const stopFactor: Record<RiskMode, number> = {
    conservative: 0.9,
    neutral: 1,
    aggressive: 1.15,
  }
  const factor = kind === 'target' ? targetFactor[mode] : stopFactor[mode]
  return Math.round(v * factor)
}

export function parseHoldDays(input: unknown): [number, number] | null {
  if (!Array.isArray(input) || input.length < 2) return null
  const a = Number(input[0])
  const b = Number(input[1])
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return [Math.max(1, Math.floor(a)), Math.max(1, Math.floor(b))]
}
