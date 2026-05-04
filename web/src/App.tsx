import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import Header from './components/Header'
import { ToastProvider } from './components/ToastProvider'
import Portfolio from './features/portfolio'
import ScanPage from './features/scan'
import { preloadStocks } from './lib/stockCache'
import {
  getCurrentUserChatId,
  isAllowedChatId,
  normalizeChatId,
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
  const initialChatId = ''
  const initialAccess = false

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
  const [accessError, setAccessError] = useState('')
  const [signedIn, setSignedIn] = useState(false)

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

    saveProfile({ telegramId: normalizedChatId })
    setAccessGranted(true)
  }

  const handleGoogleSignIn = async () => {
    // simulated sign-in: ensure client id and try to load server profile
    try {
      setSignedIn(true)
      // ensure client id and load profile
      const { ensureClientId, loadProfileFromServer } = await import('./lib/userContext')
      const cid = ensureClientId()
      const serverProfile = await loadProfileFromServer()
      if (serverProfile && serverProfile.telegramId) {
        setChatIdInput(serverProfile.telegramId)
        // auto-apply access if allowed
        const normalized = normalizeChatId(serverProfile.telegramId)
        if (normalized && isAllowedChatId(normalized)) {
          setAccessGranted(true)
        }
      }
    } catch (e) {
      // ignore
    }
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
              <h2 className="title-lg" style={{ marginBottom: 8 }}>로그인 / 접근 확인</h2>

              {!signedIn ? (
                <>
                  <div style={{ marginBottom: 12 }}>
                    <button className="ui-button ui-btn-primary" onClick={handleGoogleSignIn}>구글로 계속</button>
                  </div>
                  <p className="muted" style={{ marginBottom: 10 }}>
                    이 웹은 허용된 텔레그램 Chat ID 사용자만 사용할 수 있습니다.
                  </p>
                  <p className="muted" style={{ marginBottom: 14 }}>
                    {allowedHint}
                  </p>
                </>
              ) : (
                <>
                  <p className="muted" style={{ marginBottom: 10 }}>
                    Google로 로그인되었습니다. 자신의 텔레그램 Chat ID를 입력해 프로필에 등록해주세요.
                  </p>
                </>
              )}

              <label className="profile-field-label" htmlFor="access-chat-id">Chat ID</label>
              <input
                id="access-chat-id"
                className="ui-text"
                placeholder={signedIn ? "" : "예: 0011154094"}
                inputMode="numeric"
                value={chatIdInput}
                onChange={(e) => setChatIdInput(e.target.value)}
              />

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
