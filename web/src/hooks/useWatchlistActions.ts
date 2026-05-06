import { useCallback, useState } from 'react'
import { apiFetch } from '../lib/api'

export type WatchlistAddResult = 'added' | 'exists' | 'invalid' | 'in-flight'
export type WatchlistRemoveResult = 'removed' | 'not-found' | 'invalid' | 'in-flight'

function normalizeCode(code: string) {
  return String(code || '').trim()
}

export default function useWatchlistActions() {
  const [watchlistCodes, setWatchlistCodes] = useState<Set<string>>(new Set())
  const [addingCodes, setAddingCodes] = useState<Set<string>>(new Set())
  const [removingCodes, setRemovingCodes] = useState<Set<string>>(new Set())

  const replaceWatchedCodes = useCallback((codes: string[]) => {
    setWatchlistCodes(new Set(codes.map((code) => normalizeCode(code)).filter(Boolean)))
  }, [])

  const loadWatchlistCodes = useCallback(async () => {
    const params = new URLSearchParams({
      page: '1',
      pageSize: '500',
      positionType: 'interest',
      includeLots: '0',
    })
    const res = await apiFetch(`/api/ui/positions?${params.toString()}`, {
      cacheMs: 60_000,
      timeoutMs: 12_000,
      retries: 1,
    })
    const nextCodes = (res?.data ?? [])
      .map((row: any) => normalizeCode(row?.code))
      .filter(Boolean)
    replaceWatchedCodes(nextCodes)
    return nextCodes
  }, [replaceWatchedCodes])

  const isWatched = useCallback((code: string) => watchlistCodes.has(normalizeCode(code)), [watchlistCodes])
  const isAdding = useCallback((code: string) => addingCodes.has(normalizeCode(code)), [addingCodes])
  const isRemoving = useCallback((code: string) => removingCodes.has(normalizeCode(code)), [removingCodes])

  const addToWatchlist = useCallback(async (code: string): Promise<WatchlistAddResult> => {
    const normalized = normalizeCode(code)
    if (!normalized) return 'invalid'
    if (watchlistCodes.has(normalized)) return 'exists'
    if (addingCodes.has(normalized)) return 'in-flight'

    setAddingCodes((prev) => {
      const next = new Set(prev)
      next.add(normalized)
      return next
    })

    try {
      const res = await apiFetch('/api/ui/watchlist', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 12_000,
        body: JSON.stringify({ code: normalized }),
      })
      if (res?.error) throw new Error(String(res.error))
      setWatchlistCodes((prev) => {
        const next = new Set(prev)
        next.add(normalized)
        return next
      })
      return 'added'
    } catch (e: any) {
      const msg = String(e?.message || e)
      if (/already|duplicate|unique|이미/.test(msg.toLowerCase())) {
        setWatchlistCodes((prev) => {
          const next = new Set(prev)
          next.add(normalized)
          return next
        })
        return 'exists'
      }
      throw e
    } finally {
      setAddingCodes((prev) => {
        const next = new Set(prev)
        next.delete(normalized)
        return next
      })
    }
  }, [addingCodes, watchlistCodes])

  const removeFromWatchlist = useCallback(async (code: string): Promise<WatchlistRemoveResult> => {
    const normalized = normalizeCode(code)
    if (!normalized) return 'invalid'
    if (removingCodes.has(normalized)) return 'in-flight'

    setRemovingCodes((prev) => {
      const next = new Set(prev)
      next.add(normalized)
      return next
    })

    try {
      const res = await apiFetch('/api/ui/watchlist', {
        method: 'DELETE',
        cacheMs: 0,
        timeoutMs: 12_000,
        body: JSON.stringify({ code: normalized }),
      })
      if (res?.error) throw new Error(String(res.error))
      setWatchlistCodes((prev) => {
        const next = new Set(prev)
        next.delete(normalized)
        return next
      })
      return 'removed'
    } catch (e: any) {
      const msg = String(e?.message || e)
      if (/not found|없음|존재하지/.test(msg.toLowerCase())) {
        setWatchlistCodes((prev) => {
          const next = new Set(prev)
          next.delete(normalized)
          return next
        })
        return 'not-found'
      }
      throw e
    } finally {
      setRemovingCodes((prev) => {
        const next = new Set(prev)
        next.delete(normalized)
        return next
      })
    }
  }, [removingCodes])

  return {
    watchlistCodes,
    isWatched,
    isAdding,
    isRemoving,
    addToWatchlist,
    removeFromWatchlist,
    replaceWatchedCodes,
    loadWatchlistCodes,
  }
}