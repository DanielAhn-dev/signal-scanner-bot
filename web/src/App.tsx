import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import Header from './components/Header'
import { ToastProvider } from './components/ToastProvider'
import Portfolio from './features/portfolio'
import ScanPage from './features/scan'
import { preloadStocks } from './lib/stockCache'
import {
  getApiBase,
  getCurrentUserChatId,
  isAllowedChatId,
  normalizeChatId,
  saveApiBase,
  saveProfile,
} from './lib/userContext'

const Dashboard = lazy(() => import('./features/dashboard'))
const Trades = lazy(() => import('./features/trades'))
const Settings = lazy(() => import('./features/settings'))
const AnalyzePage = lazy(() => import('./features/analyze'))
const WatchlistPage = lazy(() => import('./features/watchlist'))
const AlertsPage = lazy(() => import('./features/alerts'))
const ReportsPage = lazy(() => import('./features/reports'))
const MarketPage = lazy(() => import('./features/market'))
const EconomyPage = lazy(() => import('./features/economy'))
const FeedPage = lazy(() => import('./features/feed'))
const ProfilePage = lazy(() => import('./features/profile'))
const DBViewPage = lazy(() => import('./features/dbView'))
const SectorsPage = lazy(() => import('./features/sectors'))

const COMPONENTS = {
  dashboard: Dashboard,
  portfolio: Portfolio,
  trades: Trades,
  settings: Settings,
  scan: ScanPage,
  analyze: AnalyzePage,
  watchlist: WatchlistPage,
  alerts: AlertsPage,
  reports: ReportsPage,
  market: MarketPage,
  economy: EconomyPage,
  feed: FeedPage,
  profile: ProfilePage,
  sectors: SectorsPage,
  dbview: DBViewPage,
} as const

type RouteKey = keyof typeof COMPONENTS

export default function App() {
  const configuredApiBase = getApiBase()
  const envApiBase = String(import.meta.env.VITE_API_BASE || '').trim()
  const hasEnvApiBase = !!envApiBase

  const initialChatId = getCurrentUserChatId()
  const initialAccess = !!configuredApiBase && !!initialChatId && isAllowedChatId(initialChatId)

  const getInitialRoute = (): RouteKey => {
    try {
      const hash = window.location.hash?.replace('#', '')
      if (hash && (hash in COMPONENTS)) return hash as RouteKey
    } catch {
      // ignore (SSR/undefined window)
    }
    return 'dashboard'
  }

  const [route, setRoute] = useState<RouteKey>(getInitialRoute)
  const [accessGranted, setAccessGranted] = useState(initialAccess)
  const [chatIdInput, setChatIdInput] = useState(initialChatId)
  const [apiBaseInput, setApiBaseInput] = useState(configuredApiBase)
  const [accessError, setAccessError] = useState('')

  const allowedHint = useMemo(() => {
    const raw = String(
      import.meta.env.VITE_ALLOWED_CHAT_IDS
      || import.meta.env.VITE_ALLOWED_CHAT_ID
      || import.meta.env.VITE_DEFAULT_TELEGRAM_CHAT_ID
      || '',
    )
    return raw.trim() ? '허용된 Chat ID만 접근할 수 있습니다.' : '허용 Chat ID 설정이 없어 현재는 입력된 Chat ID를 허용합니다.'
  }, [])

  useEffect(() => {
    if (!accessGranted) return
    preloadStocks()
  }, [accessGranted])

  useEffect(() => {
    if (!accessGranted) return

    const onHash = () => {
      try {
        const hash = window.location.hash?.replace('#', '')
        if (hash && (hash in COMPONENTS)) setRoute(hash as RouteKey)
      } catch {
        // ignore
      }
    }

    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [accessGranted])

  const Active = COMPONENTS[route]

  const handleNavigate = (r: string) => {
    setRoute(r as RouteKey)
    try { window.location.hash = r } catch { /* ignore */ }
  }

  const handleUnlock = () => {
    setAccessError('')

    const normalizedChatId = normalizeChatId(chatIdInput)
    if (!normalizedChatId) {
      setAccessError('Chat ID를 숫자로 입력해 주세요.')
      return
    }

    if (!isAllowedChatId(normalizedChatId)) {
      setAccessError('허용되지 않은 Chat ID입니다.')
      return
    }

    if (!hasEnvApiBase) {
      const trimmed = String(apiBaseInput || '').trim().replace(/\/$/, '')
      if (!trimmed) {
        setAccessError('API Base URL이 필요합니다. 예: https://your-backend.vercel.app')
        return
      }
      if (!/^https?:\/\//.test(trimmed)) {
        setAccessError('API Base URL은 http:// 또는 https://로 시작해야 합니다.')
        return
      }
      saveApiBase(trimmed)
    }

    saveProfile({ telegramId: normalizedChatId })
    setAccessGranted(true)
  }

  return (
    <ToastProvider>
      <div className="min-h-screen bg-slate-50 text-slate-900">
        {accessGranted ? (
          <>
            <Header onNavigate={handleNavigate} activeRoute={route} />
            <main className="p-4">
              <Suspense fallback={<div>Loading...</div>}>
                {Active
                  ? route === 'dashboard'
                    ? <Dashboard onNavigate={handleNavigate} />
                    : <Active />
                  : null}
              </Suspense>
            </main>
          </>
        ) : (
          <div className="modal-overlay" role="dialog" aria-modal="true" aria-label="접근 제한">
            <div className="modal card" style={{ maxWidth: 560, width: '92vw' }}>
              <h2 className="title-lg" style={{ marginBottom: 8 }}>접근 확인</h2>
              <p className="muted" style={{ marginBottom: 10 }}>
                이 웹은 허용된 텔레그램 Chat ID 사용자만 사용할 수 있습니다.
              </p>
              <p className="muted" style={{ marginBottom: 14 }}>
                {allowedHint}
              </p>

              <label className="profile-field-label" htmlFor="access-chat-id">Chat ID</label>
              <input
                id="access-chat-id"
                className="ui-text"
                placeholder="예: 8311154094"
                inputMode="numeric"
                value={chatIdInput}
                onChange={(e) => setChatIdInput(e.target.value)}
              />

              {!hasEnvApiBase && (
                <>
                  <label className="profile-field-label" htmlFor="access-api-base" style={{ marginTop: 12 }}>
                    API Base URL
                  </label>
                  <input
                    id="access-api-base"
                    className="ui-text"
                    placeholder="예: https://signal-scanner-bot.vercel.app"
                    value={apiBaseInput}
                    onChange={(e) => setApiBaseInput(e.target.value)}
                  />
                  <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
                    VITE_API_BASE가 배포 환경에 없어서 런타임 입력이 필요합니다.
                  </p>
                </>
              )}

              {accessError && (
                <p className="profile-verify-msg profile-verify-msg--err" style={{ marginTop: 12 }}>
                  {accessError}
                </p>
              )}

              <div className="profile-actions" style={{ marginTop: 16 }}>
                <button className="ui-button ui-btn-primary" onClick={handleUnlock}>
                  입장
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </ToastProvider>
  )
}
