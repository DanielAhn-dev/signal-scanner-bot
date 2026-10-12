import { useEffect, useState } from 'react'
import { apiFetch } from '../../../lib/api'
import type { AdaptiveInsights } from '../types'

export function useAdaptiveInsights() {
  const [insights, setInsights] = useState<AdaptiveInsights | null>(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/api/ui/strategy-adaptive', { cacheMs: 60_000, timeoutMs: 20_000 })
      setInsights((res?.data ?? null) as AdaptiveInsights | null)
    } catch {
      setInsights(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  return { insights, loading, load }
}
