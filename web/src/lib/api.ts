import { getApiBase, getCurrentUserChatId, getFixedAllowedChatId } from './userContext'

type CacheEntry = { ts: number; data: any }

const __api_cache = new Map<string, CacheEntry>()
const __inflight = new Map<string, Promise<any>>()

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
  /** 요청 타임아웃(ms). 기본 10000 */
  timeoutMs?: number
  /** GET 실패 시 재시도 횟수 (기본 1) */
  retries?: number
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

export async function apiFetch(
  path: string,
  opts: ApiFetchOptions = {},
) {
  const { cacheMs = 3000, timeoutMs = 10_000, retries = 1, ...fetchOpts } = opts

  const base = getApiBase()
  const url = base
    ? `${base.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`
    : path

  const headers: Record<string, string> = {
    ...(fetchOpts.headers as Record<string, string> || {}),
  }
  const uiKey = import.meta.env.VITE_UI_READ_KEY
  if (uiKey) headers['x-ui-key'] = uiKey
  const requiresUserChatId = /\/api\/ui\/(positions|watchlist|virtual-trade|decisions|summary|settings|notify)(\?|$)/.test(url)
  if (requiresUserChatId) {
    const chatId = getFixedAllowedChatId() || getCurrentUserChatId()
    if (chatId) headers['x-user-chat-id'] = chatId
  }
  if (!headers['content-type'] && fetchOpts.body) headers['content-type'] = 'application/json'

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
          const body = await res.text().catch(() => '')
          const preview = body.slice(0, 200)
          if (res.status === 404 && url.includes('/api/ui/')) {
            throw new Error(`API endpoint not found (${res.status}) from ${url}. Check VITE_API_BASE and backend deployment. ${preview}`)
          }
          throw new Error(`API request failed (${res.status}) from ${url}: ${preview}`)
        }

        const ct = res.headers.get('content-type') || ''
        if (!ct.includes('application/json')) {
          const text = await res.text()
          throw new Error(`Expected JSON from ${url}, got ${ct || 'unknown content-type'}: ${text.slice(0, 200)}`)
        }
        const json = await res.json()
        if (method === 'GET' && cacheMs > 0) {
          __api_cache.set(cacheKey, { ts: Date.now(), data: json })
        }
        return json
      } catch (e: any) {
        lastErr = e
        // 마지막 시도거나 타임아웃이면 재시도 없이 throw
        if (attempt === maxAttempts - 1 || e?.message?.includes('timed out')) break
      }
    }
    throw lastErr
  }

  const promise = run().finally(() => {
    if (method === 'GET') __inflight.delete(cacheKey)
  })

  if (method === 'GET') __inflight.set(cacheKey, promise)
  return promise
}
