import React from 'react'

type ToastContextType = {
  show: (msg: string, ms?: number) => void
}

const ToastContext = React.createContext<ToastContextType | null>(null)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = React.useState<string | null>(null)
  const hideTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = React.useCallback((msg: string, ms = 3500) => {
    setMessage(msg)
    // 앞 토스트의 타이머가 새 토스트를 일찍 지우지 않도록 교체한다
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
    hideTimerRef.current = setTimeout(() => setMessage(null), ms)
  }, [])

  React.useEffect(() => () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current)
  }, [])

  // 값 객체를 고정한다. 매 렌더 새 객체면 토스트가 뜨고 사라질 때마다 `[toast]`에 의존하는
  // 조회 효과들이 다시 돌고, 조회 실패 → 실패 토스트 → 재조회가 반복된다.
  const value = React.useMemo(() => ({ show }), [show])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {message && (
        <div style={{position: 'fixed', right: 16, bottom: 24, zIndex: 9999}}>
          <div style={{background: '#0f172a', color: 'white', padding: '0.75rem 1rem', borderRadius: 8, boxShadow: '0 6px 24px rgba(15,23,42,0.12)'}}>
            {message}
          </div>
        </div>
      )}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = React.useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
