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
  type ReportTopic,
} from '../../src/services/reportSnapshotService'
import { resolveUiUserContext } from './_userContext'
import {
  HTML_BODY_PREFIX,
  renderBodyText,
  renderLayout,
  toPreHtml,
  topicTitle,
} from '../../src/services/reportWebRenderService'

const ORIGIN = process.env.UI_CORS_ORIGIN || '*'
const REPORT_WEB_CACHE_TTL_MS = Number(process.env.REPORT_WEB_CACHE_TTL_MS || 90_000)

type CacheEntry = {
  expiresAt: number
  html: string
}

const reportWebCache = (() => {
  const key = '__signalScannerReportWebCache__'
  const g = globalThis as unknown as Record<string, Map<string, CacheEntry> | undefined>
  if (!g[key]) {
    g[key] = new Map<string, CacheEntry>()
  }
  return g[key] as Map<string, CacheEntry>
})()

function buildCacheKey(topic: ReportTopic, audienceKey: string): string {
  return `${topic}|${audienceKey}`
}

function getCachedHtml(cacheKey: string): string | null {
  const cached = reportWebCache.get(cacheKey)
  if (!cached) return null
  if (Date.now() > cached.expiresAt) {
    reportWebCache.delete(cacheKey)
    return null
  }
  return cached.html
}

function setCachedHtml(cacheKey: string, html: string) {
  if (REPORT_WEB_CACHE_TTL_MS <= 0) return
  reportWebCache.set(cacheKey, {
    expiresAt: Date.now() + REPORT_WEB_CACHE_TTL_MS,
    html,
  })
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN)
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Cache-Control', 'private, max-age=20, stale-while-revalidate=60')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const readKey = req.headers['x-ui-key'] || req.query.ui_key || process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY
  if (!readKey || String(readKey) !== (process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const topic = resolveReportTopic(req.query.topic)
  const user = await resolveUiUserContext(req)
  const chatId = user.chatId ?? parseChatId(req.query.chatId ?? req.query.chat_id ?? req.headers['x-user-chat-id'])
  const audienceKey = buildAudienceKey({ clientId: user.clientId, chatId })
  const cacheKey = buildCacheKey(topic, audienceKey)
  const cachedHtml = getCachedHtml(cacheKey)
  if (cachedHtml) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('X-Report-Web-Cache', 'HIT')
    return res.status(200).send(cachedHtml)
  }

  try {
    if (isGuideTopic(topic)) {
      const { bodyText, sourceLabel } = await buildReportBodyText({ topic, chatId: null })
      const html = renderLayout({
        title: topicTitle(topic),
        topic,
        sourceLabel,
        contentHtml: toPreHtml(bodyText),
      })
      setCachedHtml(cacheKey, html)
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.setHeader('X-Report-Web-Cache', 'MISS')
      return res.status(200).send(html)
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

    const needsRichRefresh = ['추천', '공개추천', '확신추천', '눌림목'].includes(topic)
      && Boolean(persisted?.bodyText)
      && !String(persisted?.bodyText || '').startsWith(HTML_BODY_PREFIX)

    if (persisted?.bodyText && !needsRichRefresh) {
      const html = renderLayout({
        title: topicTitle(topic),
        topic,
        sourceLabel: persisted.sourceLabel,
        contentHtml: renderBodyText(persisted.bodyText),
      })
      setCachedHtml(cacheKey, html)
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.setHeader('X-Report-Web-Cache', 'PERSISTED')
      return res.status(200).send(html)
    }

    const { bodyText, sourceLabel } = await buildReportBodyText({ topic, chatId, supabase })
    await saveReportBodySnapshot({
      supabase,
      topic,
      audienceKey,
      reportDate,
      bodyText,
      sourceLabel,
    })

    const html = renderLayout({
      title: topicTitle(topic),
      topic,
      sourceLabel,
      contentHtml: renderBodyText(bodyText),
    })

    setCachedHtml(cacheKey, html)
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('X-Report-Web-Cache', 'MISS')
    return res.status(200).send(html)
  } catch (e: any) {
    const staleCached = reportWebCache.get(cacheKey)
    if (staleCached?.html) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.setHeader('X-Report-Web-Cache', 'STALE')
      return res.status(200).send(staleCached.html)
    }

    const html = renderLayout({
      title: topicTitle(topic),
      topic,
      sourceLabel: 'error',
      contentHtml: toPreHtml(`리포트 웹보기 생성 중 오류가 발생했습니다.\n\n${String(e?.message || e)}`),
    })
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('X-Report-Web-Cache', 'ERROR')
    return res.status(200).send(html)
  }
}
