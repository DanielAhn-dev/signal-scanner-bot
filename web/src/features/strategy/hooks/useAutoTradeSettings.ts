import { useEffect, useState } from 'react'
import { apiFetch } from '../../../lib/api'
import type { AutoTradeSettings } from '../types'

export function useAutoTradeSettings() {
  const [settings, setSettings] = useState<AutoTradeSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await apiFetch('/api/ui/settings', { cacheMs: 0, timeoutMs: 10_000 })
      setSettings(res?.data ?? null)
    } catch {
      setSettings(null)
    } finally {
      setLoading(false)
    }
  }

  const save = async () => {
    if (!settings) return
    setSaving(true)
    setSaveStatus(null)
    try {
      const res = await apiFetch('/api/ui/settings', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 10_000,
        body: JSON.stringify(settings),
      })
      if (res?.error) setSaveStatus(`오류: ${res.error}`)
      else {
        setSettings(res?.data ?? settings)
        setSaveStatus('저장 완료')
      }
    } catch (e: any) {
      setSaveStatus(`오류: ${e?.message || String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  return { settings, setSettings, loading, saving, saveStatus, load, save }
}
