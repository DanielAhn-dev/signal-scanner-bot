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
    addDebounceRef.current = setTimeout(async () => {
      try {
        const results = await searchStocks(q, 8)
        setAddResults(results)
      } catch {
        setAddResults([])
      }
    }, 100)
  }, [addSearch])

  const showAddDropdown = addFocused && addSearch.trim().length >= 2

  return { addSearch, setAddSearch, addResults, setAddResults, addFocused, setAddFocused, addWrapRef, showAddDropdown }
}
