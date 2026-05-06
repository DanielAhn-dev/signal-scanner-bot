import type { VercelRequest, VercelResponse } from '@vercel/node'
import { resolveUiUserContext } from './_userContext'
import {
  buildAudienceKey,
  createSupabaseServiceClientFromEnv,
  getKstDateKey,
} from '../../src/services/reportSnapshotService'
import { createReportShare } from '../../src/services/reportShareService'

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

function round(value: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN)
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key,x-user-chat-id')
  res.setHeader('Access-Control-Allow-Credentials', 'true')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

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

  const host = req.headers['x-forwarded-host'] || req.headers.host || ''
  const proto = req.headers['x-forwarded-proto'] || 'https'
  const origin = `${proto}://${String(host)}`

  try {
    const supabase = createSupabaseServiceClientFromEnv()

    const { data, error } = await supabase
      .from('virtual_positions')
      .select('code,buy_price,buy_date,quantity,stock:stocks(name,close)')
      .eq('chat_id', chatId)
      .gt('quantity', 0)
      .order('updated_at', { ascending: false })
      .limit(200)

    if (error) return res.status(500).json({ error: error.message })

    const rows: PortfolioShareRow[] = (data || []).map((row: any) => {
      const quantity = Number(row.quantity || 0)
      const buyPrice = Number(row.buy_price || 0)
      const currentPrice = Number(row.stock?.close || 0)
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
      audienceKey: buildAudienceKey(chatId),
      bodyText: JSON.stringify(payload),
      sourceLabel: 'portfolio-share-v1',
      expiresAt,
    })

    const url = `${origin}/api/ui/portfolio-shared?share=${encodeURIComponent(share.publicToken)}`

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
