import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../../../lib/api'
import { sortPreRallyPatterns } from '../lib/preRally'
import type { PreRallyReport, PreRallySortKey } from '../types'

export function usePreRallyReport() {
  const [report, setReport] = useState<PreRallyReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [horizon, setHorizon] = useState<20 | 40 | 60>(40)
  const [sortKey, setSortKey] = useState<PreRallySortKey>('lift')
  const [investManwon, setInvestManwon] = useState<number>(500)

  const load = async (h: number = horizon) => {
    setLoading(true)
    try {
      const res = await apiFetch(`/api/ui/pre-rally-patterns?horizon=${h}`, { cacheMs: 60_000, timeoutMs: 20_000 })
      setReport((res?.data ?? null) as PreRallyReport | null)
    } catch {
      setReport(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load(horizon)
  }, [horizon])

  const sortedPatterns = useMemo(
    () => sortPreRallyPatterns(report?.stablePatterns ?? [], sortKey),
    [report, sortKey],
  )

  return { report, loading, horizon, setHorizon, sortKey, setSortKey, investManwon, setInvestManwon, sortedPatterns, load }
}
