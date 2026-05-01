import React, { lazy, Suspense, useEffect, useState } from 'react'
import Header from './components/Header'
import { ToastProvider } from './components/ToastProvider'
import Portfolio from './features/portfolio'
import ScanPage from './features/scan'
import { preloadStocks } from './lib/stockCache'

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
  const getInitialRoute = (): RouteKey => {
    try {
      const hash = window.location.hash?.replace('#', '')
      if (hash && (hash in COMPONENTS)) return hash as RouteKey
    } catch (e) {
      // ignore (SSR/undefined window)
    }
    return 'dashboard'
  }

  const [route, setRoute] = useState<RouteKey>(getInitialRoute)

  // ???쒖옉 ???꾩껜 醫낅ぉ 罹먯떆 ?뚮컢??(watchlist/dbView ?먮룞?꾩꽦 ?띾룄 ?μ긽)
  useEffect(() => { preloadStocks() }, [])

  useEffect(() => {
    const onHash = () => {
      try {
        const hash = window.location.hash?.replace('#', '')
        if (hash && (hash in COMPONENTS)) setRoute(hash as RouteKey)
      } catch (e) {
        // ignore
      }
    }
            {Active ? (
              route === 'dashboard'
                ? <Dashboard onNavigate={handleNavigate} />
                : <Active />
            ) : null}
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const Active = COMPONENTS[route]

  const handleNavigate = (r: string) => {
    setRoute(r as RouteKey)
    try { window.location.hash = r } catch (e) { /* ignore */ }
  }

  return (
    <ToastProvider>
      <div className="min-h-screen bg-slate-50 text-slate-900">
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
      </div>
    </ToastProvider>
  )
}
