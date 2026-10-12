import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch } from '../../../lib/api'
import { useToast } from '../../../components/ToastProvider'
import { isQuickTradeCandidate, isQuickTradeLiteCandidate } from '../lib/candidateStage'
import { computeSignalAgeDays, getKstDateKey, normalizeDateKey, uniqueSortedDateKeys } from '../lib/dateKeys'
import { buildCandidateSignature, readScanSnapshot, readSignalHistory, writeScanSnapshot, writeSignalHistory } from '../lib/snapshot'
import type { ConfirmPromotionTrendMeta, MarketPhase, ScanCandidate, SignalAgeMeta, SignalHistoryMap } from '../types'

export function useScanCandidates() {
  const toast = useToast()

  const snapshot = readScanSnapshot()

  const [signalHistory, setSignalHistory] = useState<SignalHistoryMap>(() => readSignalHistory())
  const [candidates, setCandidates] = useState<ScanCandidate[]>(() => snapshot?.candidates ?? [])
  const [total, setTotal] = useState(() => snapshot?.total ?? 0)
  const [latestDate, setLatestDate] = useState<string | null>(() => snapshot?.latestDate ?? null)
  const [marketPhase, setMarketPhase] = useState<MarketPhase>(() => (
    snapshot?.marketPhase === 'intraday' ? 'intraday' : 'after-close'
  ))
  const [realtimeAppliedCount, setRealtimeAppliedCount] = useState<number>(() => snapshot?.realtimeAppliedCount ?? 0)
  const [confirmPromotionTrend, setConfirmPromotionTrend] = useState<ConfirmPromotionTrendMeta | null>(
    () => snapshot?.confirmPromotionTrend ?? null,
  )

  const [loading, setLoading] = useState(() => !snapshot)

  const [error, setError] = useState<string | null>(null)

  const toastRef = useRef(toast)
  const lastSignatureRef = useRef<string | null>(null)
  const hasFetchedRef = useRef(false)

  useEffect(() => {
    toastRef.current = toast
  }, [toast])

  const asOfDateKey = useMemo(() => normalizeDateKey(latestDate) ?? getKstDateKey(), [latestDate])
  const signalAgeByCode = useMemo(() => {
    const map = new Map<string, SignalAgeMeta>()

    for (const item of candidates) {
      const code = String(item.code || '').trim()
      if (!code) continue
      const strictAge = Number(item.quick_signal_age_days)
      const quickLiteAge = Number(item.quick_lite_signal_age_days)
      const hasStrictAge = Number.isFinite(strictAge) && strictAge >= 0
      const hasQuickLiteAge = Number.isFinite(quickLiteAge) && quickLiteAge >= 0
      if (hasStrictAge || hasQuickLiteAge) {
        map.set(code, {
          strictAgeDays: hasStrictAge ? strictAge : null,
          quickLiteAgeDays: hasQuickLiteAge ? quickLiteAge : null,
        })
      }
    }

    const entries = Object.entries(signalHistory)
    if (entries.length === 0) return map
    for (const [code, record] of entries) {
      if (map.has(code)) continue
      const strictDate = record.strictQuickDates[0] ?? null
      const quickLiteDate = record.quickLiteDates[0] ?? null
      map.set(code, {
        strictAgeDays: computeSignalAgeDays(strictDate, asOfDateKey),
        quickLiteAgeDays: computeSignalAgeDays(quickLiteDate, asOfDateKey),
      })
    }
    return map
  }, [asOfDateKey, candidates, signalHistory])

  const loadCandidates = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true)
    setError(null)
    try {
      const ts = Date.now()
      const res = await apiFetch(`/api/ui/scan-candidates?limit=80&cacheMs=0&_ts=${ts}`, {
        cacheMs: 0,
        timeoutMs: 25_000,
      })
      const nextCandidates = Array.isArray(res?.data) ? (res.data as ScanCandidate[]) : []
      const nextSignature = buildCandidateSignature(nextCandidates)
      const prevSignature = lastSignatureRef.current

      if (!options?.silent && hasFetchedRef.current) {
        if (prevSignature === nextSignature) {
          toastRef.current.show(`데이터 동일 · 기준일 ${res?.latestDate ?? '—'} · ${res?.marketPhase === 'intraday' ? '장중(현재가 반영 없음/미미)' : '종가 기준'}`)
        } else {
          toastRef.current.show(`데이터 업데이트 감지 · 기준일 ${res?.latestDate ?? '—'}`)
        }
      }

      lastSignatureRef.current = nextSignature
      hasFetchedRef.current = true

      setCandidates(nextCandidates)
      setTotal(res?.count ?? 0)
      setLatestDate(res?.latestDate ?? null)
      setMarketPhase(res?.marketPhase === 'intraday' ? 'intraday' : 'after-close')
      setRealtimeAppliedCount(Number(res?.realtimeAppliedCount ?? 0))
      setConfirmPromotionTrend(res?.confirmPromotionTrend ?? null)
      setSignalHistory((prev) => {
        const dateKey = normalizeDateKey(res?.latestDate) ?? getKstDateKey()
        const next: SignalHistoryMap = { ...prev }
        for (const item of nextCandidates) {
          const code = String(item.code || '').trim()
          if (!code) continue
          const current = next[code] ?? { seenDates: [], strictQuickDates: [], quickLiteDates: [] }
          next[code] = {
            seenDates: uniqueSortedDateKeys([...current.seenDates, dateKey], 20),
            strictQuickDates: uniqueSortedDateKeys(
              isQuickTradeCandidate(item) ? [...current.strictQuickDates, dateKey] : current.strictQuickDates,
              20,
            ),
            quickLiteDates: uniqueSortedDateKeys(
              isQuickTradeLiteCandidate(item) ? [...current.quickLiteDates, dateKey] : current.quickLiteDates,
              20,
            ),
          }
        }
        writeSignalHistory(next)
        return next
      })
      writeScanSnapshot({
        candidates: nextCandidates,
        total: res?.count ?? 0,
        latestDate: res?.latestDate ?? null,
        marketPhase: res?.marketPhase === 'intraday' ? 'intraday' : 'after-close',
        realtimeAppliedCount: Number(res?.realtimeAppliedCount ?? 0),
        confirmPromotionTrend: (res?.confirmPromotionTrend ?? null) as ConfirmPromotionTrendMeta | null,
      })
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      if (!options?.silent) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadCandidates()
  }, [loadCandidates])

  return {
    candidates,
    total,
    latestDate,
    marketPhase,
    realtimeAppliedCount,
    confirmPromotionTrend,
    loading,
    error,
    loadCandidates,
    signalAgeByCode,
  }
}
