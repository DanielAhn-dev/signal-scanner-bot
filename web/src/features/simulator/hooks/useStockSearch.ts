import { useEffect, useRef, useState } from 'react'
import { searchStocks } from '../../../lib/stockCache'

/** 종목 추가 검색창: 입력 → 100ms 디바운스 → 검색 결과 */
export function useStockSearch() {
  const [addSearch, setAddSearch] = useState('')
  const [addResults, setAddResults] = useState<any[]>([])
  const [addFocused, setAddFocused] = useState(false)
  const addDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const addWrapRef = useRef<HTMLDivElement>(null)

  // 주식 검색 디바운스
  useEffect(() => {
    if (addDebounceRef.current) clearTimeout(addDebounceRef.current)
    const q = addSearch.trim()
    if (q.length < 2) { setAddResults([]); return }
    // 입력이 바뀌거나 화면을 떠나면 이전 검색 응답은 버린다(늦게 온 옛 결과가 최신 결과를 덮어쓰지 않게)
    let stale = false
    addDebounceRef.current = setTimeout(async () => {
      try {
        const results = await searchStocks(q, 8)
        if (!stale) setAddResults(results)
      } catch {
        if (!stale) setAddResults([])
      }
    }, 100)
    return () => {
      stale = true
      if (addDebounceRef.current) clearTimeout(addDebounceRef.current)
    }
  }, [addSearch])

  const showAddDropdown = addFocused && addSearch.trim().length >= 2

  return { addSearch, setAddSearch, addResults, setAddResults, addFocused, setAddFocused, addWrapRef, showAddDropdown }
}
