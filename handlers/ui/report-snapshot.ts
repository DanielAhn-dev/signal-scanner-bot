import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  buildAudienceKey,
  buildReportBodyText,
  createSupabaseServiceClientFromEnv,
  getKstDateKey,
  getPersistedReportBody,
  isGuideTopic,
  parseChatId,
  resolveReportTopic,
  saveReportBodySnapshot,
} from '../../src/services/reportSnapshotService'
import { resolveUiUserContext } from './_userContext'

const ORIGIN = process.env.UI_CORS_ORIGIN || '*'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN)
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key')
  res.setHeader('Access-Control-Allow-Credentials', 'true')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const readKey = req.headers['x-ui-key'] || req.query.ui_key || process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY
  if (!readKey || String(readKey) !== (process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const topic = resolveReportTopic(req.body?.topic || req.query.topic)
  const user = await resolveUiUserContext(req)
  const chatId = user.chatId ?? parseChatId(req.body?.chatId || req.body?.chat_id || req.query.chatId || req.query.chat_id || req.headers['x-user-chat-id'])

  try {
    if (isGuideTopic(topic)) {
      const built = await buildReportBodyText({ topic, chatId: null })
      return res.status(200).json({ ok: true, topic, cached: false, sourceLabel: built.sourceLabel })
    }

    const supabase = createSupabaseServiceClientFromEnv()
    const reportDate = getKstDateKey()
    const audienceKey = buildAudienceKey({ clientId: user.clientId, chatId })

    const persisted = await getPersistedReportBody({
      supabase,
      topic,
      audienceKey,
      reportDate,
    })

    if (persisted?.bodyText) {
      return res.status(200).json({
        ok: true,
        topic,
        cached: true,
        reportDate,
        sourceLabel: persisted.sourceLabel,
      })
    }

    const built = await buildReportBodyText({ topic, chatId, supabase })
    await saveReportBodySnapshot({
      supabase,
      topic,
      audienceKey,
      reportDate,
      bodyText: built.bodyText,
      sourceLabel: built.sourceLabel,
    })

    return res.status(200).json({
      ok: true,
      topic,
      cached: false,
      reportDate,
      sourceLabel: built.sourceLabel,
    })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
