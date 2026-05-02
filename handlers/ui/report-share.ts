import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  buildAudienceKey,
  buildReportBodyText,
  createSupabaseServiceClientFromEnv,
  getKstDateKey,
  getPersistedReportBody,
  parseChatId,
  resolveReportTopic,
  saveReportBodySnapshot,
} from '../../src/services/reportSnapshotService'
import {
  createReportShare,
  listReportShares,
  revokeReportShare,
} from '../../src/services/reportShareService'

const ORIGIN = process.env.UI_CORS_ORIGIN || '*'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key')
  res.setHeader('Access-Control-Allow-Credentials', 'true')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (!['GET', 'POST', 'DELETE'].includes(String(req.method || ''))) return res.status(405).json({ error: 'Method not allowed' })

  const readKey = req.headers['x-ui-key'] || req.query.ui_key || process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY
  if (!readKey || String(readKey) !== (process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const secret = process.env.SHARE_KEY || process.env.UI_SHARE_KEY || process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY
  if (!secret) return res.status(500).json({ error: 'Server misconfiguration' })

  const host = req.headers['x-forwarded-host'] || req.headers.host || ''
  const proto = req.headers['x-forwarded-proto'] || 'https'
  const origin = `${proto}://${String(host)}`

  try {
    const supabase = createSupabaseServiceClientFromEnv()

    if (req.method === 'GET') {
      const topic = req.query.topic ? resolveReportTopic(req.query.topic) : undefined
      const shares = await listReportShares({ supabase, topic, activeOnly: String(req.query.all || '') !== '1' })
      type ShareListItem = (typeof shares)[number]
      return res.status(200).json({
        ok: true,
        data: shares.map((share: ShareListItem) => ({
          ...share,
          url: `${origin}/api/ui/report-shared?share=${encodeURIComponent(share.publicToken)}`,
        })),
      })
    }

    if (req.method === 'DELETE') {
      const shareId = String(req.query.shareId || req.body?.shareId || '')
      if (!shareId) return res.status(400).json({ error: 'shareId required' })
      await revokeReportShare({ supabase, shareId })
      return res.status(200).json({ ok: true, message: '공유 링크를 철회했습니다.' })
    }

    const topic = resolveReportTopic(req.body?.topic || req.query.topic)
    const chatId = parseChatId(req.body?.chatId || req.query.chatId)
    const reportDate = getKstDateKey()
    const audienceKey = buildAudienceKey(chatId)

    let bodyText = ''
    let sourceLabel = ''
    const persisted = await getPersistedReportBody({ supabase, topic, audienceKey, reportDate })
    if (persisted?.bodyText) {
      bodyText = persisted.bodyText
      sourceLabel = persisted.sourceLabel
    } else {
      const built = await buildReportBodyText({ topic, chatId, supabase })
      bodyText = built.bodyText
      sourceLabel = built.sourceLabel
      await saveReportBodySnapshot({ supabase, topic, audienceKey, reportDate, bodyText, sourceLabel })
    }

    const ttlHours = Number(req.body?.ttlHours || req.query.ttlHours || 24)
    const expiresAt = new Date(Date.now() + Math.max(1, ttlHours) * 60 * 60 * 1000).toISOString()
    const share = await createReportShare({
      supabase,
      secret,
      topic,
      reportDate,
      audienceKey,
      bodyText,
      sourceLabel,
      expiresAt,
    })

    const url = `${origin}/api/ui/report-shared?share=${encodeURIComponent(share.publicToken)}`

    return res.status(200).json({
      ok: true,
      url,
      code: share.inviteCode,
      shareId: share.shareId,
      expiresAt: share.expiresAt,
      topic,
    })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
