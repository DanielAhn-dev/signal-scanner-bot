import type { VercelRequest, VercelResponse } from '@vercel/node'
import accountPolicies from '../handlers/ui/account-policies'
import accessUsers from '../handlers/ui/access-users'
import advisorPerformance from '../handlers/ui/advisor-performance'
import { ADVANCED_ROUTES, enforceAdvancedRouteAccess } from '../handlers/ui/_accessControl'

import decisions from '../handlers/ui/decisions'
import discoveryPicks from '../handlers/ui/discovery-picks'
import formatStock from '../handlers/ui/format-stock'
import marketOverview from '../handlers/ui/market-overview'
import notify from '../handlers/ui/notify'
import operations from '../handlers/ui/operations'
import news from '../handlers/ui/news'
import newsRelated from '../handlers/ui/news-related'
import positions from '../handlers/ui/positions'
import positionsMaintenance from '../handlers/ui/positions-maintenance'
import portfolioShare from '../handlers/ui/portfolio-share'
import portfolioShared from '../handlers/ui/portfolio-shared'
import profile from '../handlers/ui/profile'
import reportPdf from '../handlers/ui/report-pdf'
import reportShare from '../handlers/ui/report-share'
import reportShared from '../handlers/ui/report-shared'
import routeShare from '../handlers/ui/route-share'
import routeShared from '../handlers/ui/route-shared'
import reportSnapshot from '../handlers/ui/report-snapshot'
import reportWeb from '../handlers/ui/report-web'
import scanCandidates from '../handlers/ui/scan-candidates'
import scanHighlights from '../handlers/ui/scan-highlights'
import sectors from '../handlers/ui/sectors'
import simulationPlan from '../handlers/ui/simulation-plan'
import settings from '../handlers/ui/settings'
import stockLatest from '../handlers/ui/stock-latest'
import stocks from '../handlers/ui/stocks'
import strategyAdaptive from '../handlers/ui/strategy-adaptive'
import summary from '../handlers/ui/summary'
import syncHistory from '../handlers/ui/sync-history'
import syncStatus from '../handlers/ui/sync-status'
import telegramProfile from '../handlers/ui/telegram-profile'
import triggerBriefing from '../handlers/ui/trigger-briefing'
import triggerUpdate from '../handlers/ui/trigger-update'
import virtualTrade from '../handlers/ui/virtual-trade'
import watchlist from '../handlers/ui/watchlist'

type UiHandler = (req: VercelRequest, res: VercelResponse) => unknown | Promise<unknown>

const ROUTES: Record<string, UiHandler> = {
  'account-policies': accountPolicies,
  'access-users': accessUsers,
  'advisor-performance': advisorPerformance,
  decisions,
  'discovery-picks': discoveryPicks,
  'format-stock': formatStock,
  'market-overview': marketOverview,
  news,
    'news-related': newsRelated,
  notify,
  operations,
  'portfolio-share': portfolioShare,
  'portfolio-shared': portfolioShared,
  positions,
  'positions-maintenance': positionsMaintenance,
  profile,
  'report-pdf': reportPdf,
  'report-share': reportShare,
  'report-shared': reportShared,
  'route-share': routeShare,
  'route-shared': routeShared,
  'report-snapshot': reportSnapshot,
  'report-web': reportWeb,
  'scan-candidates': scanCandidates,
  'scan-highlights': scanHighlights,
  sectors,
  'simulation-plan': simulationPlan,
  settings,
  'stock-latest': stockLatest,
  stocks,
  'strategy-adaptive': strategyAdaptive,
  summary,
  'sync-history': syncHistory,
  'sync-status': syncStatus,
  'telegram-profile': telegramProfile,
  'trigger-briefing': triggerBriefing,
  'trigger-update': triggerUpdate,
  'virtual-trade': virtualTrade,
  watchlist,
}

function normalizeRoute(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return String(value[0] || '').trim()
  return String(value || '').trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function wildcardToRegExp(pattern: string): RegExp {
  const parts = pattern.split('*').map((v) => escapeRegExp(v))
  return new RegExp(`^${parts.join('.*')}$`)
}

function matchesTrustedOrigin(origin: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (!pattern) continue
    if (!pattern.includes('*')) {
      if (origin === pattern) return true
      continue
    }
    if (wildcardToRegExp(pattern).test(origin)) return true
  }
  return false
}

export const config = {
  maxDuration: 60,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const requestOrigin = String(req.headers.origin || '').trim()
  const trustedOriginPatterns = String(
    process.env.UI_TRUSTED_WEB_ORIGINS ||
    process.env.UI_CORS_ORIGIN ||
    'https://signal-scanner-web.vercel.app,https://stocksweb-seven.vercel.app,https://signal-scanner-web-*.vercel.app,http://localhost:5173',
  )
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
  const primaryOrigin = trustedOriginPatterns.find((origin) => !origin.includes('*')) || trustedOriginPatterns[0] || '*'
  const allowOrigin = requestOrigin && matchesTrustedOrigin(requestOrigin, trustedOriginPatterns)
    ? requestOrigin
    : primaryOrigin

  const requestedHeaders = String(req.headers['access-control-request-headers'] || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
  const allowHeaders = new Set([
    'Content-Type',
    'x-ui-key',
    'x-user-chat-id',
    'Authorization',
    ...requestedHeaders,
  ])

  res.setHeader('Access-Control-Allow-Origin', allowOrigin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', Array.from(allowHeaders).join(','))
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Vary', 'Origin,Access-Control-Request-Headers')
  if (req.method === 'OPTIONS') return res.status(204).end()

  try {
    const route = normalizeRoute(req.query.route)
    const fn = ROUTES[route]

    if (!fn) {
      return res.status(404).json({ ok: false, error: `Unknown /api/ui route: ${route || '(empty)'}` })
    }

    if (ADVANCED_ROUTES.has(route)) {
      const guard = await enforceAdvancedRouteAccess(req)
      if (!guard.allowed) {
        return res.status(guard.status).json({ error: guard.error })
      }
    }

    return await fn(req, res)
  } catch (error: any) {
    if (!res.headersSent) {
      return res.status(500).json({
        ok: false,
        error: String(error?.message || error),
      })
    }
    return undefined
  }
}
