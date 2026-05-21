import React, { lazy, Suspense, useEffect, useState } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import ExcelShell from './components/ExcelShell'
import ProfileModal from './components/ProfileModal'
import MarketSidePanel from './components/panels/MarketSidePanel'
import NewsSidePanel from './components/panels/NewsSidePanel'
import { ToastProvider, useToast } from './components/ToastProvider'
import Portfolio from './features/portfolio'
import ScanPage from './features/scan'
import { preloadStocks } from './lib/stockCache'
import { isSupabaseConfigured } from './lib/supabase'
import { isReviewMode } from './lib/review-mode'
import { useAuthStore } from './stores/authStore'
import { useProfileStore } from './stores/profileStore'
import { onOpenProfileModal } from './lib/profileModal'

const CHUNK_RELOAD_KEY = '__ssb_chunk_reload_once__'

function lazyWithRecovery<T extends React.ComponentType<any>>(
  importer: () => Promise<{ default: T }>,
) {
  return lazy(async () => {
    try {
      const mod = await importer()
      if (typeof window !== 'undefined') sessionStorage.removeItem(CHUNK_RELOAD_KEY)
      return mod
    } catch (error: any) {
      const msg = String(error?.message || error || '')
      const isChunk = /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError/i.test(msg)
      if (isChunk && typeof window !== 'undefined') {
        const retried = sessionStorage.getItem(CHUNK_RELOAD_KEY) === '1'
        if (!retried) {
          sessionStorage.setItem(CHUNK_RELOAD_KEY, '1')
          window.location.reload()
          return new Promise<never>(() => {})
        }
      }
      throw error
    }
  })
}

const Dashboard            = lazyWithRecovery(() => import('./features/dashboard'))
const Trades               = lazyWithRecovery(() => import('./features/trades'))
const Settings             = lazyWithRecovery(() => import('./features/settings'))
const AnalyzePage          = lazyWithRecovery(() => import('./features/analyze'))
const WatchlistPage        = lazyWithRecovery(() => import('./features/watchlist'))
const AlertsPage           = lazyWithRecovery(() => import('./features/alerts'))
const ReportsPage          = lazyWithRecovery(() => import('./features/reports'))
const MarketPage           = lazyWithRecovery(() => import('./features/market'))
const EconomyPage          = lazyWithRecovery(() => import('./features/economy'))
const FeedPage             = lazyWithRecovery(() => import('./features/feed'))
const NewsPage             = lazyWithRecovery(() => import('./features/news'))
const ProfilePage          = lazyWithRecovery(() => import('./features/profile'))
const DBViewPage           = lazyWithRecovery(() => import('./features/dbView'))
const SectorsPage          = lazyWithRecovery(() => import('./features/sectors'))
const AdminUsersPage       = lazyWithRecovery(() => import('./features/admin-users'))
const OperationsPage       = lazyWithRecovery(() => import('./features/operations'))
const StrategyPage         = lazyWithRecovery(() => import('./features/strategy'))
const HighlightsPage       = lazyWithRecovery(() => import('./features/highlights'))
const SimulatorPage        = lazyWithRecovery(() => import('./features/simulator'))
const DiscoveryPage        = lazyWithRecovery(() => import('./features/discovery'))
const BacktestPage         = lazyWithRecovery(() => import('./features/backtest'))
const PositionMaintenancePage = lazyWithRecovery(() => import('./features/position-maintenance'))

export default function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  )
}

function AppContent() {
  const navigate  = useNavigate()
  const location  = useLocation()
  const toast     = useToast()

  const { isSignedIn, isSigningIn, authReady, authError, initAuth, signIn } = useAuthStore()
  const profileSyncError  = useProfileStore((s) => s.syncError)
  const hydrateFromServer = useProfileStore((s) => s.hydrateFromServer)

  const [profileOpen, setProfileOpen]         = useState(false)
  const [focusChatIdField, setFocusChatIdField] = useState(false)

  const isPublicAnalyze = location.pathname === '/analyze' && new URLSearchParams(location.search).has('code')
  const isReview = isReviewMode()

  const activeRoute = location.pathname.replace(/^\//, '') || 'dashboard'

  useEffect(() => {
    const cleanup = initAuth()
    return cleanup
  }, [initAuth])

  useEffect(() => {
    if (isReview) {
      useAuthStore.setState({
        isSignedIn: true,
        authReady: true,
        authEmail: 'review@example.com',
        authName: 'Review Mode',
        signIn: async () => {},
      })
    }
  }, [])

  useEffect(() => { preloadStocks() }, [])

  useEffect(() => {
    const WARM_KEY = '__api_warmed'
    if (sessionStorage.getItem(WARM_KEY)) return
    sessionStorage.setItem(WARM_KEY, '1')
    const base = (import.meta.env.VITE_API_BASE || '').replace(/\/$/, '')
    fetch(`${base}/api/ui?route=sectors&top=1&cacheMs=300000`, {
      signal: AbortSignal.timeout?.(8_000),
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (authError) toast.show(`Google 로그인 실패: ${authError}`, 5000)
  }, [authError, toast])

  useEffect(() => {
    if (profileSyncError && isSignedIn) toast.show(`프로필 동기화 오류: ${profileSyncError}`, 5000)
  }, [profileSyncError, isSignedIn, toast])

  useEffect(() => {
    const onNavGoto = (e: Event) => {
      const key = (e as CustomEvent<{ key: string }>).detail?.key
      if (key) navigate(`/${key}`)
    }
    window.addEventListener('nav:goto', onNavGoto)
    return () => window.removeEventListener('nav:goto', onNavGoto)
  }, [navigate])

  // 다른 컴포넌트에서 프로필 모달 열기 요청
  useEffect(() => {
    return onOpenProfileModal(() => {
      setProfileOpen(true)
      setFocusChatIdField(true)
    })
  }, [])

  const handleNavigate = (r: string) => navigate(`/${r}`)

  // ── 로딩 / 비로그인 상태 ─────────────────────────────────────────
  if (!authReady && isSupabaseConfigured && !isReview) {
    return (
      <div className="auth-status-main">
        <div className="auth-status-card">
          <div className="auth-status-spinner" aria-hidden />
          <h1 className="auth-status-title">인증 상태 확인 중</h1>
          <p className="auth-status-desc">세션을 안전하게 확인하고 있습니다.</p>
        </div>
      </div>
    )
  }

  if (!isSignedIn && !isPublicAnalyze && !isReview) {
    return (
      <div className="auth-status-main">
        <div className="auth-status-card">
          <h1 className="auth-status-title">Signal Scanner에 로그인</h1>
          <p className="auth-status-desc" style={{ marginBottom: 'var(--space-5)' }}>
            Microsoft 365 계정처럼 Google 계정으로 로그인하면<br />대시보드와 모든 기능을 사용할 수 있습니다.
          </p>
          {!isSupabaseConfigured && (
            <p className="auth-status-desc" style={{ color: 'var(--color-warning)', marginBottom: 'var(--space-3)' }}>
              Supabase 설정이 없어 로그인할 수 없습니다.
            </p>
          )}
          {!!authError && (
            <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-error)', marginBottom: 'var(--space-3)' }}>
              로그인 실패: {authError}
            </p>
          )}
          <button
            className="ui-button ui-btn-primary"
            style={{ width: '100%' }}
            onClick={signIn}
            disabled={!isSupabaseConfigured || isSigningIn}
          >
            {isSigningIn ? '로그인 중...' : 'Google 계정으로 로그인'}
          </button>
        </div>
      </div>
    )
  }

  // ── 메인 앱 ──────────────────────────────────────────────────────
  return (
    <>
      <ExcelShell
        activeRoute={activeRoute}
        onNavigate={handleNavigate}
        onOpenProfile={() => setProfileOpen(true)}
        leftPanel={<MarketSidePanel />}
        rightPanel={<NewsSidePanel />}
      >
        {/* 프로필 동기화 오류 알림 */}
        {isSignedIn && !!profileSyncError && (
          <div style={{ padding: 'var(--space-2) var(--space-4)', borderBottom: '1px solid var(--color-excel-grid-border)', background: 'var(--color-error-bg)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', fontSize: 'var(--font-size-xs)' }}>
            <span style={{ color: 'var(--color-error)' }}>프로필 동기화 오류: 저장된 정보가 최신 상태가 아닐 수 있습니다.</span>
            <button className="ui-button ui-btn-secondary" style={{ flexShrink: 0 }} onClick={() => void hydrateFromServer()}>
              다시 시도
            </button>
          </div>
        )}

        <Suspense fallback={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-tertiary)', fontSize: 'var(--font-size-sm)' }}>
            로딩 중...
          </div>
        }>
          <Routes>
            <Route path="/"                       element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard"              element={<Dashboard onNavigate={handleNavigate} />} />
            <Route path="/portfolio"              element={<Portfolio />} />
            <Route path="/trades"                 element={<Trades />} />
            <Route path="/settings"               element={<Settings />} />
            <Route path="/scan"                   element={<ScanPage onNavigate={handleNavigate} />} />
            <Route path="/analyze"                element={<AnalyzePage />} />
            <Route path="/watchlist"              element={<WatchlistPage />} />
            <Route path="/alerts"                 element={<AlertsPage />} />
            <Route path="/reports"                element={<ReportsPage />} />
            <Route path="/market"                 element={<MarketPage />} />
            <Route path="/economy"                element={<EconomyPage />} />
            <Route path="/feed"                   element={<FeedPage />} />
            <Route path="/news"                   element={<NewsPage />} />
            <Route path="/profile"                element={<ProfilePage />} />
            <Route path="/sectors"                element={<SectorsPage onNavigate={handleNavigate} />} />
            <Route path="/dbview"                 element={<DBViewPage />} />
            <Route path="/admin-users"            element={<AdminUsersPage />} />
            <Route path="/operations"             element={<OperationsPage />} />
            <Route path="/strategy"               element={<StrategyPage />} />
            <Route path="/highlights"             element={<HighlightsPage />} />
            <Route path="/simulator"              element={<SimulatorPage />} />
            <Route path="/discovery"              element={<DiscoveryPage />} />
            <Route path="/backtest"               element={<BacktestPage />} />
            <Route path="/position-maintenance"   element={<PositionMaintenancePage />} />
            <Route path="*"                       element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Suspense>
      </ExcelShell>

      {/* 프로필 모달 (ExcelShell 바깥에서 Portal로 렌더) */}
      {profileOpen && (
        <ProfileModal
          onClose={() => { setProfileOpen(false); setFocusChatIdField(false) }}
          focusChatIdField={focusChatIdField}
        />
      )}
    </>
  )
}
