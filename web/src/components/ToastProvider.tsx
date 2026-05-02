import React from 'react'

type ToastContextType = {
  show: (msg: string, ms?: number) => void
}

const ToastContext = React.createContext<ToastContextType | null>(null)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = React.useState<string | null>(null)

  const show = React.useCallback((msg: string, ms = 3500) => {
    setMessage(msg)
    setTimeout(() => setMessage(null), ms)
  }, [])

  return (
    <ToastContext.Provider value={{ show }}>
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
