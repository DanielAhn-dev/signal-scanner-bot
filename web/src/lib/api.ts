import { getApiBase } from './userContext'
import { getCurrentChatIdFromStore, getCurrentClientIdFromStore } from '../stores/profileStore'
import { isReviewMode, getMockResponse } from './review-mode'
import { supabase } from './supabase'

type CacheEntry = { ts: number; data: any }

const __api_cache = new Map<string, CacheEntry>()
const __inflight = new Map<string, Promise<any>>()

function toUiQueryRouteUrl(url: string): string | null {
  const m = url.match(/^(.*\/api\/ui)\/([^/?#]+)(\?[^#]*)?$/)
  if (!m) return null
  const base = m[1]
  const route = m[2]
  const qs = m[3] ? m[3].slice(1) : ''
  return `${base}?route=${encodeURIComponent(route)}${qs ? `&${qs}` : ''}`
}

function normalizeUiUrl(url: string): string {
  return toUiQueryRouteUrl(url) || url
}

function needsAuthHeader(url: string): boolean {
  return /\/api\/ui\/(profile|positions|positions-maintenance|watchlist|virtual-trade|decisions|summary|settings|notify|access-users|operations|portfolio-share|simulation-plan|account-policies|advisor-performance|portfolio-realtime|stop-loss-take-profit|investment-prefs)(\?|$)|\/api\/ui\?route=(profile|positions|positions-maintenance|watchlist|virtual-trade|decisions|summary|settings|notify|access-users|operations|portfolio-share|simulation-plan|account-policies|advisor-performance|portfolio-realtime|stop-loss-take-profit|investment-prefs)(&|$)/.test(url)
}

function appendQueryParam(url: string, key: string, value: string): string {
  if (!value) return url
  const hashIndex = url.indexOf('#')
  const base = hashIndex >= 0 ? url.slice(0, hashIndex) : url
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : ''
  const hasKey = new RegExp(`(?:\\?|&)${key}=`).test(base)
  if (hasKey) return url
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}${hash}`
}

/** 캐시 전체 또는 특정 path prefix 무효화 */
export function invalidateCache(pathPrefix?: string) {
  if (!pathPrefix) {
    __api_cache.clear()
    return
  }
  const base = getApiBase()
  const prefix = base ? `${base.replace(/\/$/, '')}${pathPrefix}` : pathPrefix
  for (const key of __api_cache.keys()) {
    if (key.startsWith(prefix)) __api_cache.delete(key)
  }
}

export interface ApiFetchOptions extends RequestInit {
  /** GET 캐시 유효시간(ms). 0이면 캐시 비활성. 기본 3000 */
  cacheMs?: number
  /** 요청 타임아웃(ms). 기본 15000 */
  timeoutMs?: number
  /** GET 실패 시 재시도 횟수 (기본 2) */
  retries?: number
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function computeRetryDelay(attempt: number): number {
  const exp = Math.min(2000, 300 * (2 ** attempt))
  const jitter = Math.floor(Math.random() * 200)
  return exp + jitter
}

let __tokenCache: { token: string; ts: number } = { token: '', ts: 0 }

async function getAccessToken(): Promise<string> {
  if (!supabase) return ''
  const now = Date.now()
  if (__tokenCache.token && now - __tokenCache.ts < 5000) {
    return __tokenCache.token
  }
  try {
    const { data } = await supabase.auth.getSession()
    const token = String(data?.session?.access_token || '')
    __tokenCache = { token, ts: now }
    return token
  } catch {
    __tokenCache = { token: '', ts: now }
    return ''
  }
}

async function _fetch(url: string, opts: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal })
  } catch (e: any) {
    if (e?.name === 'AbortError') throw new Error(`Request timed out after ${timeoutMs}ms: ${url}`)
    throw new Error(`Network error: ${e?.message || String(e)} — ${url}`)
  } finally {
    clearTimeout(timer)
  }
}

async function parseJsonResponse(res: Response, url: string) {
  const ct = res.headers.get('content-type') || ''
  if (!ct.includes('application/json')) {
    const text = await res.text()
    throw new Error(`Expected JSON from ${url}, got ${ct || 'unknown content-type'}: ${text.slice(0, 200)}`)
  }
  return res.json()
}

export async function apiFetch(
  path: string,
  opts: ApiFetchOptions = {},
) {
  const { cacheMs = 3000, timeoutMs = 15_000, retries = 2, ...fetchOpts } = opts

  const base = getApiBase()
  let url = base
    ? `${base.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`
    : path

  // Avoid relying on edge rewrites in split deployments by using query-route form directly.
  url = normalizeUiUrl(url)

  // Review mode: check for mock data first
  const mockData = getMockResponse(url)
  if (mockData) {
    return mockData
  }

  const headers = new Headers(fetchOpts.headers)
  const accessToken = await getAccessToken()
  if (accessToken && needsAuthHeader(url) && !headers.has('authorization')) {
    headers.set('authorization', `Bearer ${accessToken}`)
  }
  const uiKey = import.meta.env.VITE_UI_READ_KEY
  if (uiKey) headers.set('x-ui-key', uiKey)
  const requiresUserIdentityQuery = /\/api\/ui\/(positions|positions-maintenance|watchlist|virtual-trade|decisions|summary|settings|notify|access-users|operations|portfolio-share|simulation-plan|account-policies|advisor-performance|trigger-update|trigger-briefing|sync-history|sync-status|report-pdf|report-share|report-snapshot|report-web|investment-prefs)(\?|$)|\/api\/ui\?route=(positions|positions-maintenance|watchlist|virtual-trade|decisions|summary|settings|notify|access-users|operations|portfolio-share|simulation-plan|account-policies|advisor-performance|trigger-update|trigger-briefing|sync-history|sync-status|report-pdf|report-share|report-snapshot|report-web|investment-prefs)(&|$)/.test(url)
  if (requiresUserIdentityQuery) {
    const clientId = getCurrentClientIdFromStore()
    const chatId = getCurrentChatIdFromStore()
    if (clientId) url = appendQueryParam(url, 'client_id', clientId)
    if (chatId) url = appendQueryParam(url, 'chat_id', chatId)
  }
  if (!headers.has('content-type') && fetchOpts.body) headers.set('content-type', 'application/json')

  const method = (fetchOpts.method || 'GET').toUpperCase()
  const cacheKey = `${url}:${method}`

  if (method === 'GET' && cacheMs > 0) {
    const ent = __api_cache.get(cacheKey)
    if (ent && Date.now() - ent.ts < cacheMs) return ent.data
  }

  // React StrictMode 및 빠른 라우트 전환 시 중복 GET을 하나의 요청으로 합친다.
  if (method === 'GET') {
    const pending = __inflight.get(cacheKey)
    if (pending) return pending
  }

  let lastErr: Error | null = null
  const maxAttempts = method === 'GET' ? retries + 1 : 1

  const run = async () => {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const res = await _fetch(url, { ...fetchOpts, headers }, timeoutMs)
        if (!res.ok) {
          if (res.status === 404) {
            const fallbackUrl = toUiQueryRouteUrl(url)
            if (fallbackUrl) {
              const fallbackRes = await _fetch(fallbackUrl, { ...fetchOpts, headers }, timeoutMs)
              if (fallbackRes.ok) {
                const json = await parseJsonResponse(fallbackRes, fallbackUrl)
                if (method === 'GET' && cacheMs > 0) {
                  __api_cache.set(cacheKey, { ts: Date.now(), data: json })
                }
                return json
              }
            }
          }

          const body = await res.text().catch(() => '')
          const preview = body.slice(0, 200)
          if (res.status === 404 && url.includes('/api/ui/')) {
            const origin = typeof window !== 'undefined' ? window.location.origin : ''
            throw new Error(
              `API endpoint not found (${res.status}) from ${url}. `
              + `If web and backend are deployed as separate Vercel projects, set VITE_API_BASE to backend URL `
              + `(current origin: ${origin || 'n/a'}). Check backend deployment and vercel project root. ${preview}`,
            )
          }
          if (res.status === 401) {
            throw new Error(
              `API request failed (401) from ${url}: ${preview}. `
              + `Sign-in session or UI read key may be missing. Verify Supabase login state and check VITE_UI_READ_KEY/UI_READ_KEY only if legacy key auth is still enabled.`,
            )
          }
          throw new Error(`API request failed (${res.status}) from ${url}: ${preview}`)
        }

        const json = await parseJsonResponse(res, url)
        if (method === 'GET' && cacheMs > 0) {
          __api_cache.set(cacheKey, { ts: Date.now(), data: json })
        }
        return json
      } catch (e: any) {
        lastErr = e
        // 401/404 등 HTTP 에러는 재시도해도 달라지지 않으므로 즉시 throw
        const isHttpError = e?.message?.match(/API request failed \(\d+\)/)
        if (attempt === maxAttempts - 1 || isHttpError) break
        // 타임아웃/네트워크 에러는 cold start 또는 일시 혼잡일 수 있어 지수 백오프로 재시도한다.
        await sleep(computeRetryDelay(attempt))
      }
    }

    // 네트워크가 일시적으로 불안정할 때는 마지막 성공값(만료 캐시)으로 화면 끊김을 막는다.
    if (method === 'GET') {
      const stale = __api_cache.get(cacheKey)
      if (stale) return stale.data
    }

    throw lastErr
  }

  const promise = run().finally(() => {
    if (method === 'GET') __inflight.delete(cacheKey)
  })

  if (method === 'GET') __inflight.set(cacheKey, promise)
  return promise
}
