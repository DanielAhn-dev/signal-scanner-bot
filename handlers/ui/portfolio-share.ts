import type { VercelRequest, VercelResponse } from '@vercel/node'
import { resolveUiUserContext } from './_userContext'
import {
  buildAudienceKey,
  createSupabaseServiceClientFromEnv,
  getKstDateKey,
} from '../../src/services/reportSnapshotService'
import { REPORT_SHARE_TABLE, createReportShare } from '../../src/services/reportShareService'
import {
  fetchRealtimePriceBatch,
  logRealtimeCoverageMetric,
  type RealtimeStockData,
} from '../../src/utils/fetchRealtimePrice'

const ORIGIN = process.env.UI_CORS_ORIGIN || '*'

type PortfolioShareRow = {
  stockName: string
  code: string
  quantity: number
  buyPrice: number
  buyDate: string
  currentPrice: number
  unrealizedPnl: number
  unrealizedPct: number
}

function firstHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return String(value[0] || '')
  return String(value || '')
}

function normalizeOrigin(input: string): string {
  const raw = String(input || '').trim()
  if (!raw) return ''
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    return url.origin
  } catch {
    return ''
  }
}

function resolvePublicOrigin(req: VercelRequest): string {
  const envOrigin = normalizeOrigin(
    process.env.SHARE_PUBLIC_ORIGIN || process.env.UI_PUBLIC_ORIGIN || process.env.WEB_PUBLIC_ORIGIN || '',
  )
  if (envOrigin) return envOrigin

  const requestOrigin = normalizeOrigin(firstHeaderValue(req.headers.origin))
  if (requestOrigin) return requestOrigin

  const referer = firstHeaderValue(req.headers.referer)
  const refererOrigin = normalizeOrigin(referer)
  if (refererOrigin) return refererOrigin

  const host = firstHeaderValue(req.headers['x-forwarded-host']) || firstHeaderValue(req.headers.host)
  const proto = firstHeaderValue(req.headers['x-forwarded-proto']) || 'https'
  return normalizeOrigin(`${proto}://${host}`)
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key,x-user-chat-id')
  res.setHeader('Access-Control-Allow-Credentials', 'true')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (!['GET', 'POST', 'DELETE'].includes(String(req.method || ''))) return res.status(405).json({ error: 'Method not allowed' })

  const readKey = req.headers['x-ui-key'] || req.query.ui_key || process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY
  if (!readKey || String(readKey) !== (process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const secret = process.env.SHARE_KEY || process.env.UI_SHARE_KEY || process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY
  if (!secret) return res.status(500).json({ error: 'Server misconfiguration' })

  const user = resolveUiUserContext(req)
  const chatId = user.chatId
  if (!chatId) {
    return res.status(400).json({ error: 'chat_id required (header x-user-chat-id, query/body chat_id, or server default)' })
  }
  const audienceKey = buildAudienceKey(chatId)

  const publicOrigin = resolvePublicOrigin(req)

  try {
    const supabase = createSupabaseServiceClientFromEnv()

    if (req.method === 'GET') {
      const all = String(req.query.all || '0') === '1'
      const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20)))

      let query = supabase
        .from(REPORT_SHARE_TABLE)
        .select('id,public_token,topic,audience_key,expires_at,created_at,revoked_at,access_count,last_accessed_at')
        .eq('topic', 'portfolio-share')
        .eq('audience_key', audienceKey)
        .order('created_at', { ascending: false })
        .limit(limit)

      if (!all) {
        query = query.is('revoked_at', null).gt('expires_at', new Date().toISOString())
      }

      const { data, error } = await query
      if (error) return res.status(500).json({ error: error.message })

      return res.status(200).json({
        ok: true,
        data: (data || []).map((row: any) => ({
          shareId: String(row.id),
          publicToken: String(row.public_token),
          expiresAt: String(row.expires_at),
          createdAt: row.created_at ? String(row.created_at) : '',
          revokedAt: row.revoked_at ? String(row.revoked_at) : null,
          accessCount: Number(row.access_count || 0),
          lastAccessedAt: row.last_accessed_at ? String(row.last_accessed_at) : null,
          url: `${publicOrigin}/api/ui/portfolio-shared?share=${encodeURIComponent(String(row.public_token || ''))}`,
        })),
      })
    }

    if (req.method === 'DELETE') {
      const shareId = String(req.query.shareId || req.body?.shareId || '')
      if (!shareId) return res.status(400).json({ error: 'shareId required' })

      const hardDelete = String(req.query.hard || req.body?.hard || '0') === '1' || req.body?.hard === true
      if (hardDelete) {
        const { data, error } = await supabase
          .from(REPORT_SHARE_TABLE)
          .delete()
          .eq('id', shareId)
          .eq('topic', 'portfolio-share')
          .eq('audience_key', audienceKey)
          .select('id')
          .maybeSingle()

        if (error) return res.status(500).json({ error: error.message })
        if (!data?.id) return res.status(404).json({ error: '공유 기록을 찾을 수 없습니다.' })
        return res.status(200).json({ ok: true, shareId, deleted: true })
      }

      const { data, error } = await supabase
        .from(REPORT_SHARE_TABLE)
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', shareId)
        .eq('topic', 'portfolio-share')
        .eq('audience_key', audienceKey)
        .is('revoked_at', null)
        .select('id')
        .maybeSingle()

      if (error) return res.status(500).json({ error: error.message })
      if (!data?.id) return res.status(404).json({ error: '공유 링크를 찾을 수 없거나 이미 철회되었습니다.' })
      return res.status(200).json({ ok: true, shareId })
    }

    const { data, error } = await supabase
      .from('virtual_positions')
      .select('code,buy_price,buy_date,quantity,stock:stocks(name,close)')
      .eq('chat_id', chatId)
      .gt('quantity', 0)
      .order('updated_at', { ascending: false })
      .limit(200)

    if (error) return res.status(500).json({ error: error.message })

    const codes = (data || []).map((row: any) => String(row?.code || '').trim()).filter(Boolean)
    const realtimeMap = codes.length > 0
      ? await fetchRealtimePriceBatch(codes).catch(() => ({} as Record<string, RealtimeStockData>))
      : {}
    let fallbackToCloseCount = 0

    const rows: PortfolioShareRow[] = (data || []).map((row: any) => {
      const quantity = Number(row.quantity || 0)
      const buyPrice = Number(row.buy_price || 0)
      const code = String(row.code || '').trim()
      const realtimePrice = Number(realtimeMap[code]?.price)
      const hasRealtime = Number.isFinite(realtimePrice) && realtimePrice > 0
      const closeFallback = Number(row.stock?.close)
      const currentPrice = hasRealtime
        ? realtimePrice
        : (Number.isFinite(closeFallback) ? closeFallback : 0)
      if (!hasRealtime && Number.isFinite(closeFallback)) fallbackToCloseCount += 1
      const unrealizedPnl = (currentPrice - buyPrice) * quantity
      const unrealizedPct = buyPrice > 0 ? ((currentPrice - buyPrice) / buyPrice) * 100 : 0

      return {
        stockName: String(row.stock?.name || row.code || '-'),
        code: String(row.code || '-'),
        quantity,
        buyPrice,
        buyDate: String(row.buy_date || '-'),
        currentPrice,
        unrealizedPnl,
        unrealizedPct,
      }
    })

    const totalInvested = rows.reduce((acc, row) => acc + row.quantity * row.buyPrice, 0)
    const totalCurrent = rows.reduce((acc, row) => acc + row.quantity * row.currentPrice, 0)
    const totalUnrealized = totalCurrent - totalInvested
    const totalReturnPct = totalInvested > 0 ? (totalUnrealized / totalInvested) * 100 : 0

    logRealtimeCoverageMetric({
      context: 'ui.portfolio-share',
      requestedCodes: codes,
      realtimeMap,
      fallbackToCloseCount,
      extra: { chatId, rows: rows.length },
    })

    const nowIso = new Date().toISOString()
    const payload = {
      schema: 'portfolio-share-v1',
      generatedAt: nowIso,
      chatId,
      totals: {
        holdingCount: rows.length,
        invested: round(totalInvested, 0),
        currentValue: round(totalCurrent, 0),
        unrealized: round(totalUnrealized, 0),
        returnPct: round(totalReturnPct, 2),
      },
      rows: rows.map((row) => ({
        ...row,
        buyPrice: round(row.buyPrice, 0),
        currentPrice: round(row.currentPrice, 0),
        unrealizedPnl: round(row.unrealizedPnl, 0),
        unrealizedPct: round(row.unrealizedPct, 2),
      })),
    }

    const ttlHours = Number(req.body?.ttlHours || req.query.ttlHours || 24)
    const expiresAt = new Date(Date.now() + Math.max(1, ttlHours) * 60 * 60 * 1000).toISOString()
    const share = await createReportShare({
      supabase,
      secret,
      topic: 'portfolio-share',
      reportDate: getKstDateKey(),
      audienceKey,
      bodyText: JSON.stringify(payload),
      sourceLabel: 'portfolio-share-v1',
      expiresAt,
    })

    const url = `${publicOrigin}/api/ui/portfolio-shared?share=${encodeURIComponent(share.publicToken)}`

    return res.status(200).json({
      ok: true,
      url,
      shareId: share.shareId,
      expiresAt: share.expiresAt,
      holdingCount: rows.length,
    })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
