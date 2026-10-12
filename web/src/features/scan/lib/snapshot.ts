import { SCAN_SIGNAL_HISTORY_KEY, SCAN_SNAPSHOT_KEY } from '../constants'
import type { ConfirmPromotionTrendMeta, MarketPhase, ScanCandidate, SignalHistoryMap } from '../types'
import { uniqueSortedDateKeys } from './dateKeys'

export function readSignalHistory(): SignalHistoryMap {
  try {
    const raw = sessionStorage.getItem(SCAN_SIGNAL_HISTORY_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    const next: SignalHistoryMap = {}
    for (const [code, value] of Object.entries(parsed as Record<string, any>)) {
      if (!value || typeof value !== 'object') continue
      next[code] = {
        seenDates: uniqueSortedDateKeys(Array.isArray(value.seenDates) ? value.seenDates.map(String) : [], 20),
        strictQuickDates: uniqueSortedDateKeys(Array.isArray(value.strictQuickDates) ? value.strictQuickDates.map(String) : [], 20),
        quickLiteDates: uniqueSortedDateKeys(Array.isArray(value.quickLiteDates) ? value.quickLiteDates.map(String) : [], 20),
      }
    }
    return next
  } catch {
    return {}
  }
}

export function writeSignalHistory(payload: SignalHistoryMap) {
  try {
    sessionStorage.setItem(SCAN_SIGNAL_HISTORY_KEY, JSON.stringify(payload))
  } catch {
    // ignore
  }
}

export function readScanSnapshot() {
  try {
    const raw = sessionStorage.getItem(SCAN_SNAPSHOT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.candidates)) return null
    return {
      candidates: parsed.candidates as ScanCandidate[],
      total: Number(parsed.total || 0),
      latestDate: parsed.latestDate ? String(parsed.latestDate) : null,
      marketPhase: parsed.marketPhase === 'intraday' ? 'intraday' : 'after-close',
      realtimeAppliedCount: Number(parsed.realtimeAppliedCount || 0),
      confirmPromotionTrend: parsed.confirmPromotionTrend ?? null,
    }
  } catch {
    return null
  }
}

export function writeScanSnapshot(payload: {
  candidates: ScanCandidate[]
  total: number
  latestDate: string | null
  marketPhase: MarketPhase
  realtimeAppliedCount: number
  confirmPromotionTrend: ConfirmPromotionTrendMeta | null
}) {
  try {
    sessionStorage.setItem(SCAN_SNAPSHOT_KEY, JSON.stringify(payload))
  } catch {
    // ignore
  }
}

export function buildCandidateSignature(items: ScanCandidate[]): string {
  if (!Array.isArray(items) || items.length === 0) return 'empty'
  return items
    .slice(0, 30)
    .map((item) => {
      const score = Number(item.adaptive_score ?? (item.entry_score ?? 0) * 20 - (item.warn_score ?? 0) * 3)
      return `${item.code}:${Number.isFinite(score) ? score.toFixed(1) : '0.0'}`
    })
    .join('|')
}
