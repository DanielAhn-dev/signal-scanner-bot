import React, { lazy, Suspense, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import Header from './components/Header'
import { ToastProvider, useToast } from './components/ToastProvider'
import Portfolio from './features/portfolio'
import ScanPage from './features/scan'
import { preloadStocks } from './lib/stockCache'
import { loadProfileFromServer, readProfile, saveProfile } from './lib/userContext'
import { isSupabaseConfigured, supabase } from './lib/supabase'

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
const AdminUsersPage = lazy(() => import('./features/admin-users'))

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
  'admin-users': AdminUsersPage,
} as const

type RouteKey = keyof typeof COMPONENTS
const AUTH_RETURN_HASH_KEY = 'supabase-auth-return-hash'
const AUTH_ERROR_KEY = 'supabase-auth-last-error'
const AUTH_OPEN_PROFILE_MODAL_KEY = 'supabase-open-profile-modal'

const decodeAuthValue = (value: string) => {
  let current = value
  for (let index = 0; index < 2; index += 1) {
    try {
      const decoded = decodeURIComponent(current.replace(/\+/g, ' '))
      if (decoded === current) break
      current = decoded
    } catch {
      break
    }
  }
  return current
}

const readAuthErrorFromLocation = () => {
  if (typeof window === 'undefined') return ''

  const query = new URLSearchParams(window.location.search)
  const hash = window.location.hash.startsWith('#')
    ? new URLSearchParams(window.location.hash.slice(1))
    : new URLSearchParams()

  const error = query.get('error') || hash.get('error') || ''
  const description = query.get('error_description') || hash.get('error_description') || ''
  const code = query.get('error_code') || hash.get('error_code') || ''

  if (!error && !description && !code) return ''

  const message = decodeAuthValue(description || error || 'Google 로그인 처리 중 오류가 발생했습니다.')
  if (code) return `${message} (${decodeAuthValue(code)})`
  return message
}

export default function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  )
}

function AppContent() {
  const consumeOpenProfileModalFlag = () => {
    if (typeof window === 'undefined') return false
    try {
      const shouldOpen = window.sessionStorage.getItem(AUTH_OPEN_PROFILE_MODAL_KEY) === '1'
      if (shouldOpen) window.sessionStorage.removeItem(AUTH_OPEN_PROFILE_MODAL_KEY)
      return shouldOpen
    } catch {
      return false
    }
  }

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
  const [isSignedIn, setIsSignedIn] = useState(false)
  const [authReady, setAuthReady] = useState(false)
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [authEmail, setAuthEmail] = useState('')
  const [authName, setAuthName] = useState('')
  const [authError, setAuthError] = useState('')
  const [profileModalTrigger, setProfileModalTrigger] = useState(0)
  const toast = useToast()

  useEffect(() => {
    preloadStocks()
  }, [])

  useEffect(() => {
    try {
      const message = readAuthErrorFromLocation()
      if (!message) {
        const stored = window.sessionStorage.getItem(AUTH_ERROR_KEY) || ''
        if (stored) setAuthError(stored)
        return
      }

      setAuthError(message)
      window.sessionStorage.setItem(AUTH_ERROR_KEY, message)
      toast.show(`Google 로그인 실패: ${message}`, 5000)

      const returnHash = window.sessionStorage.getItem(AUTH_RETURN_HASH_KEY) || ''
      const nextUrl = `${window.location.pathname}${returnHash.startsWith('#') ? returnHash : ''}`
      window.history.replaceState({}, document.title, nextUrl)
    } catch {
      // ignore
    }
  }, [toast])

  useEffect(() => {
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
  }, [])

  useEffect(() => {
    if (!supabase || !isSupabaseConfigured) {
      setAuthReady(true)
      return
    }
    let disposed = false

    const applySession = async (session: Session | null, openProfileModal: boolean) => {
      const user = session?.user
      if (!user) {
        if (disposed) return
        setIsSignedIn(false)
        setAuthEmail('')
        setAuthName('')
        setAuthReady(true)
        return
      }

      const metadata = (user.user_metadata ?? {}) as Record<string, unknown>
      const name = String(metadata.full_name || metadata.name || metadata.preferred_username || '').trim()
      const email = String(user.email || '').trim()

      saveProfile({
        clientId: user.id,
        nickname: name || readProfile()?.nickname,
      })
      await loadProfileFromServer()

      if (disposed) return
      setIsSignedIn(true)
      setAuthEmail(email)
      setAuthName(name)
      setAuthReady(true)
      if (openProfileModal) setProfileModalTrigger((v) => v + 1)
    }

    void supabase.auth.getSession().then(({ data }) => applySession(data?.session ?? null, false))

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      const shouldOpenModal = event === 'SIGNED_IN' && consumeOpenProfileModalFlag()
      void applySession(session, shouldOpenModal)
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') setIsSigningIn(false)
    })

    return () => {
      disposed = true
      listener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!isSignedIn) return
    try {
      const returnHash = window.sessionStorage.getItem(AUTH_RETURN_HASH_KEY)
      if (!returnHash) return
      window.sessionStorage.removeItem(AUTH_RETURN_HASH_KEY)
      if (returnHash.startsWith('#') && returnHash !== window.location.hash) {
        window.location.hash = returnHash
      }
    } catch {
      // ignore
    }
  }, [isSignedIn])

  const Active = COMPONENTS[route]

  const handleNavigate = (r: string) => {
    setRoute(r as RouteKey)
    try { window.location.hash = r } catch { /* ignore */ }
  }

  const handleGoogleSignIn = async () => {
    try {
      if (!supabase || !isSupabaseConfigured) {
        toast.show('Supabase 인증 설정이 비어 있습니다. VITE_SUPABASE_URL과 VITE_SUPABASE_ANON_KEY를 확인해 주세요.')
        return
      }
      setIsSigningIn(true)
      setAuthError('')
      try {
        window.sessionStorage.removeItem(AUTH_ERROR_KEY)
        const currentHash = window.location.hash || '#dashboard'
        window.sessionStorage.setItem(AUTH_RETURN_HASH_KEY, currentHash)
        window.sessionStorage.setItem(AUTH_OPEN_PROFILE_MODAL_KEY, '1')
      } catch {
        // ignore
      }
      const redirectTo =
        (import.meta.env.VITE_SUPABASE_OAUTH_REDIRECT || import.meta.env.VITE_OAUTH_REDIRECT) ||
        `${window.location.origin}${window.location.pathname}`
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          queryParams: {
            prompt: 'select_account',
          },
        },
      })
      if (error) throw error
    } catch (error) {
      const detail = String((error as { message?: string; code?: string; error_code?: string } | null)?.message || '')
      const providerDisabled = /Unsupported provider/i.test(detail)
      if (providerDisabled) {
        toast.show('현재 Supabase 프로젝트에서 Google provider가 비활성화되어 있습니다. Supabase Authentication > Providers에서 Google을 활성화해 주세요.')
      } else {
        toast.show(detail ? `Google 로그인 실패: ${detail}` : 'Google 로그인에 실패했습니다.')
      }
      setIsSigningIn(false)
    }
  }

  const handleSignOut = async () => {
    try {
      if (!supabase || !isSupabaseConfigured) return
      await supabase.auth.signOut()
      setIsSignedIn(false)
      setAuthEmail('')
      setAuthName('')
    } catch {
      // ignore
    }
  }

  if (!authReady && isSupabaseConfigured) {
    return (
      <div className="layout-shell">
        <main className="auth-status-main">
          <section className="auth-status-card" aria-live="polite" aria-busy="true">
            <div className="auth-status-spinner" aria-hidden />
            <h1 className="auth-status-title">인증 상태 확인 중...</h1>
            <p className="auth-status-desc">세션을 안전하게 확인하고 있습니다. 잠시만 기다려 주세요.</p>
          </section>
        </main>
      </div>
    )
  }

  return (
    <div className="layout-shell">
      {!isSignedIn ? (
        <main className="auth-status-main">
          <section className="auth-status-card">
            <div className="access-required-icon" aria-hidden>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
                <polyline points="10 17 15 12 10 7"/>
                <line x1="15" y1="12" x2="3" y2="12"/>
              </svg>
            </div>
            <h1 className="auth-status-title">로그인이 필요합니다</h1>
            <p className="auth-status-desc" style={{ marginBottom: 'var(--space-6)' }}>
              Google 계정으로 로그인하면 대시보드와 모든 기능을 사용할 수 있습니다.
            </p>
            {!isSupabaseConfigured && (
              <p className="auth-status-desc" style={{ marginBottom: 'var(--space-3)', color: 'var(--color-warning)' }}>
                Supabase 설정이 없어 로그인을 진행할 수 없습니다.
              </p>
            )}
            {!!authError && (
              <p className="profile-verify-msg profile-verify-msg--err" style={{ marginBottom: 'var(--space-3)' }}>
                Google 로그인 실패: {authError}
              </p>
            )}
            <button
              className="ui-button ui-btn-primary"
              style={{ width: '100%' }}
              onClick={handleGoogleSignIn}
              disabled={!isSupabaseConfigured || isSigningIn}
            >
              {isSigningIn ? '로그인 중...' : 'Google로 로그인'}
            </button>
          </section>
        </main>
      ) : (
        <>
          <Header
            onNavigate={handleNavigate}
            activeRoute={route}
            isSignedIn={isSignedIn}
            isSigningIn={isSigningIn}
            authEmail={authEmail}
            authName={authName}
            onSignIn={handleGoogleSignIn}
            onSignOut={handleSignOut}
            profileModalTrigger={profileModalTrigger}
          />
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
      )}
    </div>
  )
}
