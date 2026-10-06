import React, { lazy, Suspense, useEffect, useState } from 'react'
import { useUserStateAutoSync } from './lib/userState'
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
import { useProfileStore, useCurrentClientId } from './stores/profileStore'
import { useNeedsStart } from './lib/useStartGate'
import { onOpenProfileModal } from './lib/profileModal'
import { apiFetch } from './lib/api'
import { canSeeNav } from './navigation'
import InviteGate from './features/invites/InviteGate'
import { captureInviteFromUrl, readStashedCouple } from './lib/inviteStash'

// 초대 링크(?invite=CODE)로 들어온 코드는 로그인 왕복 전에 보관한다
captureInviteFromUrl()

type Membership =
  | { state: 'unknown' }
  | { state: 'member' }
  | { state: 'none'; request: 'pending' | 'approved' | 'rejected' | null; signupsOpen: boolean }

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
const ExecutionGuidePage   = lazyWithRecovery(() => import('./features/execution-guide'))
const WatchlistPage        = lazyWithRecovery(() => import('./features/watchlist'))
const AlertsPage           = lazyWithRecovery(() => import('./features/alerts'))
const ReportsPage          = lazyWithRecovery(() => import('./features/reports'))
const MarketPage           = lazyWithRecovery(() => import('./features/market'))
const EconomyPage          = lazyWithRecovery(() => import('./features/economy'))
const FeedPage             = lazyWithRecovery(() => import('./features/feed'))
const NewsPage             = lazyWithRecovery(() => import('./features/news'))
const ProfilePage          = lazyWithRecovery(() => import('./features/profile'))
const SectorsPage          = lazyWithRecovery(() => import('./features/sectors'))
const AdminUsersPage       = lazyWithRecovery(() => import('./features/admin-users'))
const StrategyPage         = lazyWithRecovery(() => import('./features/strategy'))
const HighlightsPage       = lazyWithRecovery(() => import('./features/highlights'))
const SimulatorPage        = lazyWithRecovery(() => import('./features/simulator'))
const FollowTradesPage     = lazyWithRecovery(() => import('./features/follow-trades'))
const StartWizardPage      = lazyWithRecovery(() => import('./features/start-wizard'))
const SeedBuilderPage      = lazyWithRecovery(() => import('./features/seed-builder'))
const MoneyFlowPage        = lazyWithRecovery(() => import('./features/money-flow'))
const FamilyPage           = lazyWithRecovery(() => import('./features/family'))
const IncomeGuidePage      = lazyWithRecovery(() => import('./features/income-guide'))
const GoalTrackerPage      = lazyWithRecovery(() => import('./features/goal-tracker'))
const ChoiceReviewPage     = lazyWithRecovery(() => import('./features/choice-review'))
const AccumulatePage       = lazyWithRecovery(() => import('./features/accumulate'))
const MixPage              = lazyWithRecovery(() => import('./features/mix'))
const ChildGiftPage        = lazyWithRecovery(() => import('./features/child-gift'))
const PlanCheckPage        = lazyWithRecovery(() => import('./features/plan-check'))
const DiscoveryPage        = lazyWithRecovery(() => import('./features/discovery'))
const BacktestPage         = lazyWithRecovery(() => import('./features/backtest'))
const ControlPage          = lazyWithRecovery(() => import('./features/control'))

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

  const { isSignedIn, isSigningIn, authReady, authError, authEmail, authName, initAuth, signIn, signOut } = useAuthStore()
  const profileSyncError  = useProfileStore((s) => s.syncError)
  const hydrateFromServer = useProfileStore((s) => s.hydrateFromServer)
  const [membership, setMembership] = useState<Membership>({ state: 'unknown' })
  const isMember = membership.state === 'member'
  useUserStateAutoSync(isSignedIn && isMember)

  const isAdmin      = useProfileStore((s) => s.isAdmin)
  const isAdminReady = useProfileStore((s) => s.isAdminReady)
  const setIsAdmin   = useProfileStore((s) => s.setIsAdmin)

  const clientIdForGate = useCurrentClientId()
  // 일반 사용자는 시작하기를 마치기 전엔 다른 화면으로 못 간다(프로필·설정 제외)
  const needsStart = useNeedsStart(isMember && isAdminReady && !isAdmin, clientIdForGate)

  const [profileOpen, setProfileOpen]         = useState(false)
  const [focusChatIdField, setFocusChatIdField] = useState(false)

  const isPublicAnalyze = location.pathname === '/analyze' && new URLSearchParams(location.search).has('code')
  const isReview = isReviewMode()

  const activeRoute = location.pathname.replace(/^\//, '') || 'dashboard'
  const contentMode = activeRoute === 'dashboard' ? 'native' : 'legacy'

  const saveActionLabelByRoute: Record<string, string> = {
    watchlist: '감시목록 내보내기',
    reports: '리포트 스냅샷 저장',
  }
  const quickSaveTooltip = saveActionLabelByRoute[activeRoute] || '리포트 페이지로 이동'

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

  // 가입 상태 — 초대 전용 모드에서 회원이 아니면 초대 코드 화면을 보여준다. 조회 실패 시 막지 않는다(서버가 거절한다).
  useEffect(() => {
    if (!isSignedIn || isReview) {
      setMembership({ state: 'unknown' })
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const res = await apiFetch('/api/ui/invites?mode=status', { cacheMs: 0, timeoutMs: 10_000 })
        const d = res?.data
        if (cancelled) return
        if (d && d.member === false) {
          setMembership({ state: 'none', request: d.request ?? null, signupsOpen: d.signupsOpen !== false })
        } else {
          setMembership({ state: 'member' })
        }
      } catch {
        if (!cancelled) setMembership({ state: 'member' })
      }
    })()
    return () => { cancelled = true }
  }, [isSignedIn, isReview])

  // 관리자 여부 — 메뉴 노출 범위를 정한다. 조회 실패 시 일반 사용자 화면으로 둔다.
  useEffect(() => {
    if (!isSignedIn && !isReview) return
    if (isSignedIn && !isReview && !isMember) return
    let cancelled = false
    void (async () => {
      try {
        const me = await apiFetch('/api/ui/access-users?mode=me', { cacheMs: 0, timeoutMs: 10_000 })
        if (!cancelled) setIsAdmin(!!me?.data?.is_admin)
      } catch {
        if (!cancelled) setIsAdmin(false)
      }
    })()
    return () => { cancelled = true }
  }, [isSignedIn, isReview, isMember, setIsAdmin])

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

  // 이미 회원인데 부부 연결 링크(?couple=)로 들어왔으면 부부 연결 화면에서 수락을 묻는다
  useEffect(() => {
    if (isMember && readStashedCouple() && location.pathname !== '/family') navigate('/family')
  }, [isMember]) // eslint-disable-line react-hooks/exhaustive-deps

  const runWatchlistExport = async () => {
    const res = await apiFetch('/api/ui/watchlist', { cacheMs: 0, timeoutMs: 15_000 })
    const items = Array.isArray(res?.data?.items) ? res.data.items : []
    const headers = ['stock_code', 'stock_name', 'buy_price', 'current_price', 'change_rate', 'buy_date', 'created_at', 'memo']
    const escapeCsv = (value: unknown) => {
      const text = String(value ?? '')
      const escaped = text.replace(/"/g, '""')
      return `"${escaped}"`
    }
    const rows = items.map((item: Record<string, unknown>) => headers.map((h) => escapeCsv(item[h])).join(','))
    const csv = [headers.join(','), ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    a.href = url
    a.download = `watchlist_export_${y}${m}${d}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const runReportSnapshot = async () => {
    const response = await apiFetch('/api/ui/report-snapshot', { method: 'POST', cacheMs: 0, timeoutMs: 20_000 })
    if (!response?.ok) {
      throw new Error(response?.error || response?.message || '스냅샷 저장 실패')
    }
  }

  const handleQuickSave = async ({ activeRoute: route }: { activeRoute: string; pageLabel: string }) => {
    try {
      if (route === 'watchlist') {
        await runWatchlistExport()
        toast.show('감시목록 CSV 내보내기 완료')
        return
      }
      if (route === 'reports') {
        await runReportSnapshot()
        toast.show('리포트 스냅샷 저장 완료')
        return
      }
      navigate('/reports')
      toast.show('현재 화면은 리포트 저장으로 이동합니다.')
    } catch (error: any) {
      toast.show(`저장 실패: ${error?.message || String(error)}`)
    }
  }

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
          <h1 className="auth-status-title">Nexora에 로그인</h1>
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

  if (isSignedIn && !isReview && membership.state === 'unknown') {
    return (
      <div className="auth-status-main">
        <div className="auth-status-card">
          <div className="auth-status-spinner" aria-hidden />
          <h1 className="auth-status-title">가입 상태 확인 중</h1>
        </div>
      </div>
    )
  }

  if (isSignedIn && !isReview && membership.state === 'none') {
    return (
      <InviteGate
        email={authEmail}
        request={membership.request}
        signupsOpen={membership.signupsOpen}
        onJoined={() => window.location.reload()}
        onSignOut={() => { void signOut() }}
      />
    )
  }

  // ── 메인 앱 ──────────────────────────────────────────────────────
  return (
    <>
      <ExcelShell
        activeRoute={activeRoute}
        onNavigate={handleNavigate}
        onQuickSave={handleQuickSave}
        quickSaveTooltip={quickSaveTooltip}
        onOpenProfile={() => setProfileOpen(true)}
        contentMode={contentMode}
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
          {/* 일반 사용자는 허용된 화면만 — 주소로 직접 들어와도 홈으로 돌려보낸다 */}
          {isAdminReady && !isAdmin && !isPublicAnalyze && !isReview && !canSeeNav(activeRoute, false) && (
            <Navigate to="/dashboard" replace />
          )}
          {needsStart && !['/start', '/profile', '/settings'].includes(location.pathname) && (
            <Navigate to="/start" replace />
          )}
          <Routes>
            <Route path="/"                       element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard"              element={<Dashboard onNavigate={handleNavigate} />} />
            <Route path="/portfolio"              element={<Portfolio />} />
            <Route path="/trades"                 element={<Trades />} />
            <Route path="/settings"               element={<Settings />} />
            <Route path="/scan"                   element={<ScanPage onNavigate={handleNavigate} />} />
            <Route path="/analyze"                element={<AnalyzePage />} />
            <Route path="/execution-guide"        element={<ExecutionGuidePage />} />
            <Route path="/watchlist"              element={<WatchlistPage />} />
            <Route path="/alerts"                 element={<AlertsPage />} />
            <Route path="/reports"                element={<ReportsPage />} />
            <Route path="/market"                 element={<MarketPage />} />
            <Route path="/economy"                element={<EconomyPage />} />
            <Route path="/feed"                   element={<FeedPage />} />
            <Route path="/news"                   element={<NewsPage />} />
            <Route path="/profile"                element={<ProfilePage />} />
            <Route path="/sectors"                element={<SectorsPage onNavigate={handleNavigate} />} />
            <Route path="/admin-users"            element={<AdminUsersPage />} />
            <Route path="/strategy"               element={<StrategyPage />} />
            <Route path="/highlights"             element={<HighlightsPage />} />
            <Route path="/simulator"              element={<SimulatorPage />} />
            <Route path="/follow"                 element={<FollowTradesPage />} />
            <Route path="/start"                  element={<StartWizardPage />} />
            <Route path="/seed-builder"            element={<SeedBuilderPage />} />
            <Route path="/money-flow"             element={<MoneyFlowPage />} />
            <Route path="/family"                 element={<FamilyPage />} />
            <Route path="/income-guide"           element={<IncomeGuidePage />} />
            <Route path="/goal-tracker"           element={<GoalTrackerPage />} />
            <Route path="/choices"                element={<ChoiceReviewPage />} />
            <Route path="/accumulate"             element={<AccumulatePage />} />
            <Route path="/mix"                    element={<MixPage />} />
            <Route path="/child"                  element={<ChildGiftPage />} />
            <Route path="/plan"                   element={<PlanCheckPage />} />
            <Route path="/discovery"              element={<DiscoveryPage />} />
            <Route path="/backtest"               element={<BacktestPage />} />
            <Route path="/control"                element={<ControlPage />} />
            {/* 관제 통합 이전 경로 호환 리다이렉트 */}
            <Route path="/dbview"                 element={<Navigate to="/control?tab=data" replace />} />
            <Route path="/operations"             element={<Navigate to="/control?tab=operations" replace />} />
            <Route path="/position-maintenance"   element={<Navigate to="/control?tab=maintenance" replace />} />
            <Route path="*"                       element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </Suspense>
      </ExcelShell>

      {/* 프로필 모달 (ExcelShell 바깥에서 Portal로 렌더) */}
      {profileOpen && (
        <ProfileModal
          isOpen={profileOpen}
          onClose={() => { setProfileOpen(false); setFocusChatIdField(false) }}
          isSignedIn={isSignedIn}
          authEmail={authEmail}
          authName={authName}
          onSignIn={signIn}
          onSignOut={() => { void signOut() }}
          isSigningIn={isSigningIn}
          focusChatIdField={focusChatIdField}
        />
      )}
    </>
  )
}
