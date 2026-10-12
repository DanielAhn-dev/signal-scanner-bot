import { useEffect, useState } from 'react'
import { apiFetch } from '../../../lib/api'
import type { DecisionRow } from '../types'

export function useDecisions() {
  const [rows, setRows] = useState<DecisionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch('/api/ui/decisions?pageSize=200', { cacheMs: 5_000 })
      setRows((res?.data ?? []) as DecisionRow[])
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  return { rows, loading, error, load }
}
