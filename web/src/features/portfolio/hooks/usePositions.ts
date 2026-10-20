import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch, invalidateCache } from '../../../lib/api'
import type { AccountFolder } from '../types'
import { buildAccountKey } from '../lib/accountKey'
import type { HoldingRow } from '../types'

export function usePositions() {
  const [allRows, setAllRows] = useState<HoldingRow[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [serverTotal, setServerTotal] = useState<number | null>(null)
  const [loadMoreLoading, setLoadMoreLoading] = useState(false)
  const INITIAL_PAGE_SIZE = 20

  const load = useCallback(async ({ soft = false, force = false }: { soft?: boolean; force?: boolean } = {}) => {
    setRefreshing(true)
    if (!soft) setLoading(true)
    if (!soft) setError(null)
    try {
      // 초기 로드 pageSize를 20으로 제한 → 초기 응답 시간 8초에서 1초 이하로 단축
      const params = new URLSearchParams({ page: '1', pageSize: String(INITIAL_PAGE_SIZE), includeLots: '0', positionType: 'holding', withCount: '1' })
      if (force) params.set('cacheMs', '0')
      const json = await apiFetch(`/api/ui/positions?${params}`, { cacheMs: 3_000, timeoutMs: 15_000, retries: 1 })
      const rows = Array.isArray(json?.data) ? json.data : []
      setAllRows(rows)
      setServerTotal(json?.count != null ? Number(json.count) : null)
      setLastUpdatedAt(Date.now())
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      if (!soft) setLoading(false)
      setRefreshing(false)
    }
  }, [])

  const loadMore = useCallback(async () => {
    setLoadMoreLoading(true)
    try {
      const nextPage = Math.floor(allRows.length / INITIAL_PAGE_SIZE) + 1
      const params = new URLSearchParams({ page: String(nextPage), pageSize: String(INITIAL_PAGE_SIZE), includeLots: '0', positionType: 'holding', withCount: '1' })
      const json = await apiFetch(`/api/ui/positions?${params}`, { cacheMs: 3_000, timeoutMs: 15_000, retries: 1 })
      const newRows = json?.data ?? []
      setAllRows((prev) => [...prev, ...newRows])
      setServerTotal(json?.count != null ? Number(json.count) : null)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoadMoreLoading(false)
    }
  }, [allRows.length])

  useEffect(() => { load() }, [load])

  // 계좌 목록은 받은 전체 행에서 만든다. 서버 accounts는 그 페이지(첫 20건)만 센 것이라,
  // 첫 페이지가 한 계좌에 몰려 있으면 계좌가 1개로 보여 실제 계좌 서브 탭이 사라졌다.
  const accountFolders = useMemo<AccountFolder[]>(() => {
    const map = new Map<string, AccountFolder>()
    for (const row of allRows) {
      const brokerName = String(row?.broker_name || '').trim()
      const accountName = String(row?.account_name || '').trim()
      if (!brokerName && !accountName) continue
      const key = buildAccountKey(brokerName, accountName)
      map.set(key, { key, brokerName, accountName, count: (map.get(key)?.count ?? 0) + 1 })
    }
    return Array.from(map.values()).sort((x, y) =>
      `${x.brokerName} ${x.accountName}`.trim().localeCompare(`${y.brokerName} ${y.accountName}`.trim(), 'ko'))
  }, [allRows])

  // 초기 페이지(20건) 로드 후 나머지 페이지를 백그라운드로 이어서 불러와
  // 상단 요약(보유 종목 수/평가손익 합계 등)이 일부 데이터가 아닌 전체 보유 기준으로 계산되도록 함.
  // (대시보드의 /api/ui/portfolio-realtime는 항상 전체 포지션을 합산하므로, 이 페이지의 요약도 전체 기준이어야 두 값이 일치함)
  useEffect(() => {
    if (serverTotal == null) return
    if (allRows.length >= serverTotal) return
    if (loadMoreLoading) return
    loadMore()
  }, [serverTotal, allRows.length, loadMoreLoading, loadMore])

  return {
    allRows,
    loading,
    refreshing,
    error,
    lastUpdatedAt,
    serverTotal,
    loadMoreLoading,
    accountFolders,
    load,
    loadMore,
  }
}
