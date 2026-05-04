import type { VercelRequest, VercelResponse } from '@vercel/node'
import accessUsers from '../handlers/ui/access-users'
import { ADVANCED_ROUTES, enforceAdvancedRouteAccess } from '../handlers/ui/_accessControl'

import decisions from '../handlers/ui/decisions'
import formatStock from '../handlers/ui/format-stock'
import notify from '../handlers/ui/notify'
import positions from '../handlers/ui/positions'
import profile from '../handlers/ui/profile'
import reportPdf from '../handlers/ui/report-pdf'
import reportShare from '../handlers/ui/report-share'
import reportShared from '../handlers/ui/report-shared'
import reportSnapshot from '../handlers/ui/report-snapshot'
import reportWeb from '../handlers/ui/report-web'
import scanCandidates from '../handlers/ui/scan-candidates'
import sectors from '../handlers/ui/sectors'
import settings from '../handlers/ui/settings'
import stockLatest from '../handlers/ui/stock-latest'
import stocks from '../handlers/ui/stocks'
import summary from '../handlers/ui/summary'
import syncHistory from '../handlers/ui/sync-history'
import syncStatus from '../handlers/ui/sync-status'
import triggerBriefing from '../handlers/ui/trigger-briefing'
import triggerUpdate from '../handlers/ui/trigger-update'
import virtualTrade from '../handlers/ui/virtual-trade'
import watchlist from '../handlers/ui/watchlist'

type UiHandler = (req: VercelRequest, res: VercelResponse) => unknown | Promise<unknown>

const ROUTES: Record<string, UiHandler> = {
  'access-users': accessUsers,
  decisions,
  'format-stock': formatStock,
  notify,
  positions,
  profile,
  'report-pdf': reportPdf,
  'report-share': reportShare,
  'report-shared': reportShared,
  'report-snapshot': reportSnapshot,
  'report-web': reportWeb,
  'scan-candidates': scanCandidates,
  sectors,
  settings,
  'stock-latest': stockLatest,
  stocks,
  summary,
  'sync-history': syncHistory,
  'sync-status': syncStatus,
  'trigger-briefing': triggerBriefing,
  'trigger-update': triggerUpdate,
  'virtual-trade': virtualTrade,
  watchlist,
}

function normalizeRoute(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return String(value[0] || '').trim()
  return String(value || '').trim()
}

export const config = {
  maxDuration: 60,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const requestOrigin = String(req.headers.origin || '').trim()
  const trustedOrigins = String(
    process.env.UI_TRUSTED_WEB_ORIGINS ||
    process.env.UI_CORS_ORIGIN ||
    'https://signal-scanner-web.vercel.app,http://localhost:5173',
  )
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
  const allowOrigin = requestOrigin && trustedOrigins.includes(requestOrigin)
    ? requestOrigin
    : (trustedOrigins[0] || '*')

  res.setHeader('Access-Control-Allow-Origin', allowOrigin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key,x-user-chat-id')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  if (req.method === 'OPTIONS') return res.status(204).end()

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

  return fn(req, res)
}
