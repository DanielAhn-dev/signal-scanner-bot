import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch, invalidateCache } from '../../../lib/api'
import type { AdvisorPerformanceData } from '../types'

export function useAdvisorPerformance() {
  const [advisorPerf, setAdvisorPerf] = useState<AdvisorPerformanceData>(null)
  const [advisorPerfLoading, setAdvisorPerfLoading] = useState(false)

  const loadAdvisorPerformance = useCallback(async () => {
    setAdvisorPerfLoading(true)
    try {
      const json = await apiFetch('/api/ui/advisor-performance?windowDays=90', {
        cacheMs: 20_000,
        timeoutMs: 10_000,
        retries: 1,
      })
      setAdvisorPerf(json?.data ?? null)
    } catch {
      setAdvisorPerf(null)
    } finally {
      setAdvisorPerfLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAdvisorPerformance()
  }, [loadAdvisorPerformance])

  return {
    advisorPerf,
    advisorPerfLoading,
  }
}
