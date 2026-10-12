import React, { useCallback, useState } from 'react'

/** 차트 토글 상태를 localStorage에 영속 저장하는 훅 */
export function useLocalStorageBool(
  key: string,
  defaultValue: boolean,
): [boolean, React.Dispatch<React.SetStateAction<boolean>>] {
  const [value, setValue] = useState<boolean>(() => {
    try {
      const stored = localStorage.getItem(key)
      return stored !== null ? stored === 'true' : defaultValue
    } catch {
      return defaultValue
    }
  })
  const set = useCallback((next: React.SetStateAction<boolean>) => {
    setValue((prev) => {
      const resolved = typeof next === 'function' ? (next as (v: boolean) => boolean)(prev) : next
      try { localStorage.setItem(key, String(resolved)) } catch { /* ignore */ }
      return resolved
    })
  }, [key])
  return [value, set]
}
