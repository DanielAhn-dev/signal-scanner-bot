import React, { lazy, Suspense, useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import Header from './components/Header'
import { ToastProvider, useToast } from './components/ToastProvider'
import Portfolio from './features/portfolio'
import ScanPage from './features/scan'
import { preloadStocks } from './lib/stockCache'
import { isSupabaseConfigured } from './lib/supabase'
import { isReviewMode } from './lib/review-mode'
import { useAuthStore } from './stores/authStore'
import { useProfileStore } from './stores/profileStore'

const CHUNK_RELOAD_KEY = '__ssb_chunk_reload_once__'

function lazyWithRecovery<T extends React.ComponentType<any>>(
  importer: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      const mod = await importer()
      if (typeof window !== 'undefined') {
        sessionStorage.removeItem(CHUNK_RELOAD_KEY)
      }
      return mod
    } catch (error: any) {
      const message = String(error?.message || error || '')
      const isChunkLoadError = /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError/i.test(message)
      if (isChunkLoadError && typeof window !== 'undefined') {
        const hasRetried = sessionStorage.getItem(CHUNK_RELOAD_KEY) === '1'
        if (!hasRetried) {
          sessionStorage.setItem(CHUNK_RELOAD_KEY, '1')
          window.location.reload()
          return new Promise<never>(() => {})
        }
      }
      throw error
    }
  })
}

const Dashboard = lazyWithRecovery(() => import('./features/dashboard'))
const Trades = lazyWithRecovery(() => import('./features/trades'))
const Settings = lazyWithRecovery(() => import('./features/settings'))
const AnalyzePage = lazyWithRecovery(() => import('./features/analyze'))
const WatchlistPage = lazyWithRecovery(() => import('./features/watchlist'))
const AlertsPage = lazyWithRecovery(() => import('./features/alerts'))
const ReportsPage = lazyWithRecovery(() => import('./features/reports'))
const MarketPage = lazyWithRecovery(() => import('./features/market'))
const EconomyPage = lazyWithRecovery(() => import('./features/economy'))
const FeedPage = lazyWithRecovery(() => import('./features/feed'))
const NewsPage = lazyWithRecovery(() => import('./features/news'))
const ProfilePage = lazyWithRecovery(() => import('./features/profile'))
const DBViewPage = lazyWithRecovery(() => import('./features/dbView'))
const SectorsPage = lazyWithRecovery(() => import('./features/sectors'))
const AdminUsersPage = lazyWithRecovery(() => import('./features/admin-users'))
const OperationsPage = lazyWithRecovery(() => import('./features/operations'))
const StrategyPage = lazyWithRecovery(() => import('./features/strategy'))
const HighlightsPage = lazyWithRecovery(() => import('./features/highlights'))
const SimulatorPage = lazyWithRecovery(() => import('./features/simulator'))
const DiscoveryPage = lazyWithRecovery(() => import('./features/discovery'))
const BacktestPage = lazyWithRecovery(() => import('./features/backtest'))
const PositionMaintenancePage = lazyWithRecovery(() => import('./features/position-maintenance'))

export default function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  )
}

function AppContent() {
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()

  const { isSignedIn, isSigningIn, authReady, authEmail, authName, authError, initAuth, signIn, signOut } = useAuthStore()
  const profileSyncError = useProfileStore((state) => state.syncError)
  const hydrateFromServer = useProfileStore((state) => state.hydrateFromServer)

  const isPublicAnalyze = location.pathname === '/analyze' && new URLSearchParams(location.search).has('code')
  const isReview = isReviewMode()

  // Supabase 인증 초기화
  useEffect(() => {
    const cleanup = initAuth()
    return cleanup
  }, [initAuth])

  // Review mode: bypass authentication (only once on mount)
  useEffect(() => {
    if (isReview) {
      useAuthStore.setState({
        isSignedIn: true,
        authReady: true,
        authEmail: 'review@example.com',
        authName: 'Review Mode',
        signIn: async () => { /* no-op in review mode */ },
      })
      console.log('[Review Mode] Authentication bypassed')
    }
  }, [])

  // 주식 캐시 프리로드
  useEffect(() => { preloadStocks() }, [])

  // Vercel cold start warm-up
  useEffect(() => {
    const WARM_KEY = '__api_warmed'
    if (sessionStorage.getItem(WARM_KEY)) return
    sessionStorage.setItem(WARM_KEY, '1')
    const base = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '')
    fetch(`${base}/api/ui?route=sectors&top=1&cacheMs=300000`, {
      method: 'GET',
      signal: AbortSignal.timeout?.(8_000),
    }).catch(() => {})
  }, [])

  // 인증 오류 Toast 표시
  useEffect(() => {
    if (authError) toast.show(`Google 로그인 실패: ${authError}`, 5000)
  }, [authError, toast])

  useEffect(() => {
    if (profileSyncError && isSignedIn) {
      toast.show(`프로필 동기화 오류: ${profileSyncError}`, 5000)
    }
  }, [profileSyncError, isSignedIn, toast])

  // nav:goto 커스텀 이벤트 (기존 코드 호환)
  useEffect(() => {
    const onNavGoto = (e: Event) => {
      const key = (e as CustomEvent<{ key: string }>).detail?.key
      if (key) navigate(`/${key}`)
    }
    window.addEventListener('nav:goto', onNavGoto)
    return () => window.removeEventListener('nav:goto', onNavGoto)
  }, [navigate])

  const handleNavigate = (r: string) => navigate(`/${r}`)

  if (!authReady && isSupabaseConfigured && !isReview) {
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

  if (!isSignedIn && !isPublicAnalyze && !isReview) {
    return (
      <div className="layout-shell">
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
              onClick={signIn}
              disabled={!isSupabaseConfigured || isSigningIn}
            >
              {isSigningIn ? '로그인 중...' : 'Google로 로그인'}
            </button>
          </section>
        </main>
      </div>
    )
  }

  return (
    <div className="layout-shell">
      {isSignedIn && (
        <Header
          onNavigate={handleNavigate}
          activeRoute={location.pathname.replace(/^\//, '') || 'dashboard'}
        />
      )}
      {isSignedIn && !!profileSyncError && (
        <div style={{ padding: '0 var(--space-4)' }}>
          <div
            className="profile-verify-msg profile-verify-msg--err"
            style={{
              maxWidth: 'var(--container-max, 1200px)',
              margin: 'var(--space-3) auto 0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--space-3)',
            }}
          >
            <span>프로필을 서버에서 다시 불러오지 못했습니다. 저장된 Chat ID와 닉네임이 최신 상태가 아닐 수 있습니다.</span>
            <button
              className="ui-button ui-btn-secondary"
              onClick={() => { void hydrateFromServer() }}
            >
              다시 시도
            </button>
          </div>
        </div>
      )}
      <main>
        <Suspense fallback={<div>Loading...</div>}>
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard onNavigate={handleNavigate} />} />
            <Route path="/portfolio" element={<Portfolio />} />
            <Route path="/trades" element={<Trades />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/scan" element={<ScanPage onNavigate={handleNavigate} />} />
            <Route path="/analyze" element={<AnalyzePage />} />
            <Route path="/watchlist" element={<WatchlistPage />} />
            <Route path="/alerts" element={<AlertsPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/market" element={<MarketPage />} />
            <Route path="/economy" element={<EconomyPage />} />
            <Route path="/feed" element={<FeedPage />} />
            <Route path="/news" element={<NewsPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/sectors" element={<SectorsPage onNavigate={handleNavigate} />} />
            <Route path="/dbview" element={<DBViewPage />} />
            <Route path="/admin-users" element={<AdminUsersPage />} />
            <Route path="/operations" element={<OperationsPage />} />
            <Route path="/strategy" element={<StrategyPage />} />
            <Route path="/highlights" element={<HighlightsPage />} />
            <Route path="/simulator" element={<SimulatorPage />} />
            <Route path="/discovery" element={<DiscoveryPage />} />
            <Route path="/backtest" element={<BacktestPage />} />
            <Route path="/position-maintenance" element={<PositionMaintenancePage />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  )
}
