import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch, invalidateCache } from '../../../lib/api'
import { useSyncedSettings } from '../../../lib/userState'

const DEFAULT_INITIAL_CAPITAL = 10_000_000

export function useInvestmentPrefs() {
  const [initialCapital, setInitialCapital] = useState<number>(DEFAULT_INITIAL_CAPITAL)
  const [dbSeedCapital, setDbSeedCapital] = useState<number | null>(null)
  const [dbVirtualCash, setDbVirtualCash] = useState<number | null>(null)
  const [assetAccordionOpen, setAssetAccordionOpen] = useState(false)

  useEffect(() => {
    apiFetch('/api/ui/investment-prefs', { cacheMs: 0, timeoutMs: 10_000 })
      .then((json: any) => {
        const seed = Number(json?.data?.virtual_seed_capital)
        const cash = Number(json?.data?.virtual_cash)
        if (Number.isFinite(seed) && seed > 0) {
          setDbSeedCapital(seed)
          setInitialCapital(seed)
        }
        if (Number.isFinite(cash) && cash >= 0) setDbVirtualCash(cash)
      })
      .catch(() => {/* ignore */})
  }, [])

  useSyncedSettings(
    'assetOverview',
    { initialCapital, assetAccordionOpen },
    { initialCapital: DEFAULT_INITIAL_CAPITAL, assetAccordionOpen: false },
    (saved) => {
      const capital = Number(saved.initialCapital)
      if (Number.isFinite(capital) && capital > 0) setInitialCapital(capital)
      if (typeof saved.assetAccordionOpen === 'boolean') setAssetAccordionOpen(saved.assetAccordionOpen)
    },
  )

  return {
    initialCapital,
    dbSeedCapital,
    dbVirtualCash,
  }
}
