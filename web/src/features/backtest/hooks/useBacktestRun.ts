import { useEffect, useState } from 'react'
import { apiFetch } from '../../../lib/api'
import type { Horizon } from '../constants'
import type { BacktestResponse } from '../types'

export function useBacktestRun() {
  const [horizon, setHorizon] = useState<Horizon>(20)
  const [lookbackDays, setLookbackDays] = useState(120)
  const [rallyPct, setRallyPct] = useState(20)
  const [topN, setTopN] = useState(30)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<BacktestResponse | null>(null)
  const [selectedRuleKey, setSelectedRuleKey] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const requestTs = Date.now()
      const q = new URLSearchParams({
        horizon: String(horizon),
        lookbackDays: String(lookbackDays),
        rallyPct: String(rallyPct),
        topN: String(topN),
      })
      q.set('_ts', String(requestTs))
      const res = await apiFetch(`/api/ui/backtest-risers?${q.toString()}`, {
        cacheMs: 0,
        timeoutMs: 30_000,
      })
      setData((res?.data ?? null) as BacktestResponse | null)
    } catch (e: any) {
      setError(e?.message || String(e))
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const candidates = data?.ruleCandidates ?? []
    if (candidates.length === 0) return

    setSelectedRuleKey((current) => {
      if (current && candidates.some((rule) => rule.key === current)) return current
      return candidates[0].key
    })
  }, [data])

  // 최초 마운트 시 자동 실행
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    horizon, setHorizon, lookbackDays, setLookbackDays, rallyPct, setRallyPct, topN, setTopN,
    loading, error, data, load, selectedRuleKey, setSelectedRuleKey,
  }
}
