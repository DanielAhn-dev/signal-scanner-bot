import { useEffect, useState } from 'react'
import { apiFetch } from '../../../lib/api'
import type { ActivityRow } from '../types'

export function useActivity() {
  const [rows, setRows] = useState<ActivityRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/api/ui/operations?view=activity', { cacheMs: 0, timeoutMs: 15_000 })
      setRows(Array.isArray(res?.data) ? (res.data as ActivityRow[]) : [])
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  return { rows, loading, load }
}
