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
  const freshRaw = String(req.query.fresh || '').trim().toLowerCase()
  const forceFreshFromQuery = freshRaw === '1' || freshRaw === 'true' || freshRaw === 'yes'
  const user = await resolveUiUserContext(req)
  const chatId = user.chatId ?? parseChatId(req.query.chatId ?? req.query.chat_id ?? req.headers['x-user-chat-id'])
  const audienceKey = buildAudienceKey({ clientId: user.clientId, chatId })
  const forceFreshReportTopics = forceFreshFromQuery || topic === '추천' || topic === '확신추천' || topic === '공개추천' || topic === '눌림목'
  const cacheKey = buildCacheKey(topic, audienceKey)
  if (!forceFreshReportTopics) {
    const cachedHtml = getCachedHtml(cacheKey)
    if (cachedHtml) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.setHeader('X-Report-Web-Cache', 'HIT')
      return res.status(200).send(cachedHtml)
    }
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

    const persistedBody = String(persisted?.bodyText || '')
    // 추천/확신추천/공개추천/눌림목은 사용자 기대(토픽별 분기/최신성)를 위해 항상 재생성한다.
    const forceFreshCandidateTopics = forceFreshReportTopics
    // 스냅샷이 HTML 형식이더라도 토픽별 고유 마커가 없으면 구 버전 스냅샷으로 간주해 재생성
    // (토픽 분기 렌더 적용 전 저장된 동일 내용 스냅샷 문제 해소)
    const needsRichRefresh = (
      ['추천', '공개추천', '확신추천', '눌림목', '관심종목', '포트폴리오', '주간', '거시', '수급', '섹터'].includes(topic)
      && Boolean(persistedBody)
      && !persistedBody.startsWith(HTML_BODY_PREFIX)
    ) || (
      // 포트폴리오 전용 마커 미포함 → 구 스냅샷 → 재생성
      topic === '포트폴리오'
      && Boolean(persistedBody)
      && persistedBody.startsWith(HTML_BODY_PREFIX)
      && !persistedBody.includes('Portfolio Report')
    ) || (
      topic === '눌림목'
      && persistedBody.includes('Next Week Pullback')
      && persistedBody.includes('다음 주 눌림목 리포트</div>')
    ) || (
      // 확신추천 전용 마커 미포함 → 구 스냅샷(추천과 동일 내용) → 재생성
      topic === '확신추천'
      && Boolean(persistedBody)
      && persistedBody.startsWith(HTML_BODY_PREFIX)
      && !persistedBody.includes('확신 후보')
    ) || (
      // 공개추천 전용 마커 미포함 → 구 스냅샷(추천과 동일 내용) → 재생성
      topic === '공개추천'
      && Boolean(persistedBody)
      && persistedBody.startsWith(HTML_BODY_PREFIX)
      && !persistedBody.includes('공유용 오늘의 후보 리포트')
    ) || (
      topic === '주간'
      && Boolean(persistedBody)
      && persistedBody.startsWith(HTML_BODY_PREFIX)
      && !persistedBody.includes('Weekly Dashboard')
    ) || (
      topic === '거시'
      && Boolean(persistedBody)
      && persistedBody.startsWith(HTML_BODY_PREFIX)
      && !persistedBody.includes('Macro Dashboard')
    ) || (
      topic === '수급'
      && Boolean(persistedBody)
      && persistedBody.startsWith(HTML_BODY_PREFIX)
      && !persistedBody.includes('Flow Dashboard')
    ) || (
      topic === '섹터'
      && Boolean(persistedBody)
      && persistedBody.startsWith(HTML_BODY_PREFIX)
      && !persistedBody.includes('Sector Dashboard')
    )

    if (persisted?.bodyText && !needsRichRefresh && !forceFreshCandidateTopics) {
      const html = renderLayout({
        title: topicTitle(topic),
        topic,
        sourceLabel: persisted.sourceLabel,
        contentHtml: renderBodyText(persisted.bodyText),
      })
      if (!forceFreshReportTopics) setCachedHtml(cacheKey, html)
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

    if (!forceFreshReportTopics) setCachedHtml(cacheKey, html)
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('X-Report-Web-Cache', 'MISS')
    return res.status(200).send(html)
  } catch (e: any) {
    if (!forceFreshReportTopics) {
      const staleCached = reportWebCache.get(cacheKey)
      if (staleCached?.html) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.setHeader('X-Report-Web-Cache', 'STALE')
        return res.status(200).send(staleCached.html)
      }
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
