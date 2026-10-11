import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch, invalidateCache } from '../../../lib/api'
import { computeMacroRisk } from '../lib/macroRisk'

export function useMacroSnapshot() {
  const [macroLoading, setMacroLoading] = useState(false)
  const [macroSnapshot, setMacroSnapshot] = useState<any | null>(null)

  const loadMacroSnapshot = useCallback(async () => {
    setMacroLoading(true)
    try {
      const json = await apiFetch('/api/ui/market-overview', {
        cacheMs: 120_000,
        timeoutMs: 10_000,
        retries: 1,
      })
      if (json?.data) setMacroSnapshot(json.data)
    } catch {
      // ignore macro fetch failures
    } finally {
      setMacroLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadMacroSnapshot()
  }, [loadMacroSnapshot])

  const macroRiskLevel = useMemo(() => computeMacroRisk(macroSnapshot), [macroSnapshot])

  return {
    macroLoading,
    macroRiskLevel,
  }
}
