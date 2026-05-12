import type { VercelRequest, VercelResponse } from '@vercel/node'
import { resolveUiUserContext } from './_userContext'
import {
  buildAudienceKey,
  createSupabaseServiceClientFromEnv,
  getKstDateKey,
} from '../../src/services/reportSnapshotService'
import { REPORT_SHARE_TABLE, createReportShare } from '../../src/services/reportShareService'

const ORIGIN = process.env.UI_CORS_ORIGIN || '*'

type ShareKind = 'scan' | 'analyze' | 'highlights'

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

function resolveKind(value: unknown): ShareKind {
  const v = String(value || '').trim().toLowerCase()
  if (v === 'analyze') return 'analyze'
  if (v === 'highlights') return 'highlights'
  return 'scan'
}

function toTopic(kind: ShareKind): string {
  if (kind === 'analyze') return 'analyze-share'
  if (kind === 'highlights') return 'highlights-share'
  return 'scan-share'
}

function toPublicPath(kind: ShareKind): string {
  return `/api/ui/route-shared?kind=${encodeURIComponent(kind)}`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key,x-user-chat-id')
  res.setHeader('Access-Control-Allow-Credentials', 'true')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (!['GET', 'POST', 'DELETE'].includes(String(req.method || ''))) {
    return res.status(405).json({ error: 'Method not allowed' })
  }

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
      const kind = resolveKind(req.query.kind)
      const topic = toTopic(kind)
      const all = String(req.query.all || '0') === '1'
      const limit = Math.min(50, Math.max(1, Number(req.query.limit || 20)))

      let query = supabase
        .from(REPORT_SHARE_TABLE)
        .select('id,public_token,topic,audience_key,expires_at,created_at,revoked_at,access_count,last_accessed_at')
        .eq('topic', topic)
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
        kind,
        data: (data || []).map((row: any) => ({
          shareId: String(row.id),
          publicToken: String(row.public_token),
          topic: String(row.topic || topic),
          expiresAt: String(row.expires_at),
          createdAt: row.created_at ? String(row.created_at) : '',
          revokedAt: row.revoked_at ? String(row.revoked_at) : null,
          accessCount: Number(row.access_count || 0),
          lastAccessedAt: row.last_accessed_at ? String(row.last_accessed_at) : null,
          url: `${publicOrigin}${toPublicPath(kind)}&share=${encodeURIComponent(String(row.public_token || ''))}`,
        })),
      })
    }

    if (req.method === 'DELETE') {
      const shareId = String(req.query.shareId || req.body?.shareId || '')
      const kind = resolveKind(req.query.kind || req.body?.kind)
      if (!shareId) return res.status(400).json({ error: 'shareId required' })

      const { data, error } = await supabase
        .from(REPORT_SHARE_TABLE)
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', shareId)
        .eq('topic', toTopic(kind))
        .eq('audience_key', audienceKey)
        .is('revoked_at', null)
        .select('id')
        .maybeSingle()

      if (error) return res.status(500).json({ error: error.message })
      if (!data?.id) return res.status(404).json({ error: '공유 링크를 찾을 수 없거나 이미 철회되었습니다.' })
      return res.status(200).json({ ok: true, shareId })
    }

    const kind = resolveKind(req.body?.kind || req.query.kind)
    const topic = toTopic(kind)
    const payload = req.body?.payload
    const requiresCode = String(req.body?.requiresCode || req.query.requiresCode || '0') === '1'
      || req.body?.requiresCode === true
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return res.status(400).json({ error: 'payload object required' })
    }

    const bodyText = JSON.stringify({
      schema: kind === 'analyze' ? 'analyze-share-v1' : 'scan-share-v1',
      generatedAt: new Date().toISOString(),
      sharePolicy: { requiresCode },
      ...payload,
    })

    const ttlHours = Number(req.body?.ttlHours || req.query.ttlHours || 24)
    const expiresAt = new Date(Date.now() + Math.max(1, ttlHours) * 60 * 60 * 1000).toISOString()

    const share = await createReportShare({
      supabase,
      secret,
      topic,
      reportDate: getKstDateKey(),
      audienceKey,
      bodyText,
      sourceLabel: kind === 'analyze' ? 'analyze-share-v1' : kind === 'highlights' ? 'highlights-share-v1' : 'scan-share-v1',
      expiresAt,
    })

    const url = `${publicOrigin}${toPublicPath(kind)}&share=${encodeURIComponent(share.publicToken)}`
    return res.status(200).json({
      ok: true,
      kind,
      url,
      code: requiresCode ? share.inviteCode : null,
      shareId: share.shareId,
      expiresAt: share.expiresAt,
    })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
