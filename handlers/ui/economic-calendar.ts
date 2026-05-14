import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  fetchEconomicCalendar,
  fetchUpcomingHighRiskEvents,
} from '../../src/utils/fetchEconomicCalendar'
import {
  buildEconomicCalendarSnapshotKey,
  readEconomicCalendarSnapshot,
  saveEconomicCalendarSnapshot,
} from '../../src/services/economicCalendarSnapshotService'

const CALENDAR_CACHE_TTL_MS = Math.max(0, Number(process.env.UI_CALENDAR_CACHE_TTL_MS || 3_600_000)) // 1시간
const CALENDAR_QUERY_TIMEOUT_MS = Math.max(1_000, Number(process.env.UI_CALENDAR_QUERY_TIMEOUT_MS || 5_000))
const CALENDAR_SNAPSHOT_TTL_MS = Math.max(5 * 60_000, Number(process.env.ECONOMIC_CALENDAR_SNAPSHOT_TTL_MS || 6 * 60 * 60_000))

type CalendarCacheEntry = {
  expiresAt: number
  payload: any
}

const calendarCache = new Map<string, CalendarCacheEntry>()

function getCacheKey(query: string): string {
  return `economic-calendar:${query}`
}

function getCachedData(key: string): any | null {
  const entry = calendarCache.get(key)
  if (!entry) return null
  if (Date.now() > entry.expiresAt) {
    calendarCache.delete(key)
    return null
  }
  return entry.payload
}

function setCachedData(key: string, payload: any): void {
  calendarCache.set(key, {
    expiresAt: Date.now() + CALENDAR_CACHE_TTL_MS,
    payload,
  })
}

async function getFallbackSnapshot<T>(snapshotKey: string): Promise<T | null> {
  const snapshot = await readEconomicCalendarSnapshot(snapshotKey, { allowStale: true })
  return snapshot as T | null
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // CORS 헤더 추가
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
      return res.status(200).end()
    }

    const { query = 'all', type = 'calendar' } = req.query
    const snapshotKey = buildEconomicCalendarSnapshotKey(String(type), String(query))

    // 다음 고위험 이벤트만 조회
    if (type === 'upcoming-high-risk') {
      const cacheKey = getCacheKey('upcoming-high-risk')
      let cachedData = getCachedData(cacheKey)

      if (!cachedData) {
        cachedData = await getFallbackSnapshot<{ events: any[]; fetchedAt?: string }>(snapshotKey)
        if (cachedData) setCachedData(cacheKey, cachedData)
      }

      if (!cachedData) {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), CALENDAR_QUERY_TIMEOUT_MS)

        try {
          const events = await Promise.race([
            fetchUpcomingHighRiskEvents(),
            new Promise<any>((_, reject) =>
              controller.signal.addEventListener('abort', () => reject(new Error('timeout')))
            ),
          ])
          clearTimeout(timeoutId)
          cachedData = { events, fetchedAt: new Date().toISOString() }
          setCachedData(cacheKey, cachedData)
          await saveEconomicCalendarSnapshot(snapshotKey, cachedData, {
            sourceLabel: 'live-high-risk',
            ttlMs: CALENDAR_SNAPSHOT_TTL_MS,
            queryType: String(type),
            queryPayload: { query: String(query), type: String(type) },
          })
        } catch (e) {
          clearTimeout(timeoutId)
          throw e
        }
      }

      return res.status(200).json({ data: cachedData, ok: true })
    }

    // 전체 또는 범위 캘린더 조회
    const cacheKey = getCacheKey(String(query))
    let cachedData = getCachedData(cacheKey)

    if (!cachedData) {
      cachedData = await getFallbackSnapshot<any>(snapshotKey)
      if (cachedData) setCachedData(cacheKey, cachedData)
    }

    if (!cachedData) {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), CALENDAR_QUERY_TIMEOUT_MS)

      try {
        const response = await Promise.race([
          fetchEconomicCalendar(),
          new Promise<any>((_, reject) =>
            controller.signal.addEventListener('abort', () => reject(new Error('timeout')))
          ),
        ])
        clearTimeout(timeoutId)
        cachedData = response
        setCachedData(cacheKey, cachedData)
        await saveEconomicCalendarSnapshot(snapshotKey, cachedData, {
          sourceLabel: 'live-calendar',
          ttlMs: CALENDAR_SNAPSHOT_TTL_MS,
          queryType: String(type),
          queryPayload: { query: String(query), type: String(type) },
        })
      } catch (e) {
        clearTimeout(timeoutId)
        if (cachedData) {
          return res.status(200).json({ data: cachedData, ok: true, stale: true })
        }
        throw e
      }
    }

    return res.status(200).json({ data: cachedData, ok: true })
  } catch (error: any) {
    const message = error?.message || String(error)
    console.error('[economic-calendar] error:', message)
    return res.status(500).json({
      ok: false,
      error: message,
    })
  }
}
