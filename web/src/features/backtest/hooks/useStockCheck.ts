import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '../../../lib/api'
import { searchStocks } from '../../../lib/stockCache'
import { BACKTEST_PENDING_CODE_KEY } from '../constants'
import type { BacktestTab, StockIndicators } from '../types'

/** 종목 패턴 점검 탭의 상태: 검색 → 선택 → 지표 조회 */
export function useStockCheck(setActiveTab: (tab: BacktestTab) => void) {
  const [checkSearch, setCheckSearch] = useState('')
  const [checkResults, setCheckResults] = useState<any[]>([])
  const [checkFocused, setCheckFocused] = useState(false)
  const [selectedStock, setSelectedStock] = useState<{ code: string; name: string } | null>(null)
  const [indicators, setIndicators] = useState<StockIndicators | null>(null)
  const [checkLoading, setCheckLoading] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const checkDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const checkWrapRef = useRef<HTMLDivElement>(null)

  const fetchIndicators = async (code: string) => {
    setCheckLoading(true)
    setIndicators(null)
    setCheckError(null)
    try {
      const res = await apiFetch(`/api/ui/stock-indicators?code=${encodeURIComponent(code)}`, {
        cacheMs: 0,
        timeoutMs: 12_000,
      })
      setIndicators((res?.data ?? null) as StockIndicators | null)
    } catch (e: any) {
      setCheckError(e?.message || '지표 조회 실패')
    } finally {
      setCheckLoading(false)
    }
  }

  const selectStock = (stock: { code: string; name: string }) => {
    setSelectedStock(stock)
    setCheckSearch(stock.name)
    setCheckResults([])
    void fetchIndicators(stock.code)
    setActiveTab('check')
  }

  // URL param 또는 sessionStorage로 전달된 종목 자동 로드
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const urlCode = params.get('code')?.trim()
    let pending: string | null = null
    try {
      pending = sessionStorage.getItem(BACKTEST_PENDING_CODE_KEY)
      if (pending) sessionStorage.removeItem(BACKTEST_PENDING_CODE_KEY)
    } catch { /* ignore */ }
    const initCode = urlCode || pending
    if (!initCode) return

    searchStocks(initCode, 1)
      .then((results) => {
        const name = results[0]?.name || initCode
        selectStock({ code: initCode, name })
      })
      .catch(() => selectStock({ code: initCode, name: initCode }))
  }, [])

  // 종목 검색 디바운스
  useEffect(() => {
    if (checkDebounceRef.current) clearTimeout(checkDebounceRef.current)
    const q = checkSearch.trim()
    if (q.length < 2) { setCheckResults([]); return }
    checkDebounceRef.current = setTimeout(async () => {
      try {
        const results = await searchStocks(q, 8)
        setCheckResults(results)
      } catch {
        setCheckResults([])
      }
    }, 150)
  }, [checkSearch])

  return {
    checkSearch, setCheckSearch, checkResults, setCheckResults, checkFocused, setCheckFocused,
    selectedStock, setSelectedStock, indicators, setIndicators, checkLoading, checkError, setCheckError,
    checkWrapRef, selectStock,
  }
}
