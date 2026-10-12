import { useCallback, useState } from 'react'
import { userScopedKey } from '../../../lib/userState'

/** 최근 검색 종목을 localStorage에 저장/관리 (최대 5개) */
export function useRecentSearches(): [
  Array<{ code: string; name: string }>,
  (stock: { code: string; name: string }) => void,
] {
  // 사용자별 키 — 로그인 전(키 없음)에는 저장하지 않는다
  const KEY = userScopedKey('analyze.recentSearches')
  const [list, setList] = useState<Array<{ code: string; name: string }>>(() => {
    try {
      const raw = KEY ? localStorage.getItem(KEY) : null
      return raw ? (JSON.parse(raw) as Array<{ code: string; name: string }>) : []
    } catch {
      return []
    }
  })
  const push = useCallback((stock: { code: string; name: string }) => {
    setList(prev => {
      const filtered = prev.filter(s => s.code !== stock.code)
      const next = [stock, ...filtered].slice(0, 5)
      try { if (KEY) localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* ignore */ }
      return next
    })
  }, [])
  return [list, push]
}
