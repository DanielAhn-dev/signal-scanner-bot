/**
 * 전체 종목 목록 클라이언트 캐시
 *
 * - 메모리(module-level) → localStorage(24h TTL) → API 순서로 조회
 * - 동시 요청은 단일 Promise로 합쳐 중복 호출 방지
 * - searchStocks()로 즉시 클라이언트 필터링 가능 (API 호출 없음)
 */
import { apiFetch } from './api'

export interface StockItem {
  code: string
  name: string
  sector_id: string | null
  liquidity: number | null
  updated_at: string | null
}

const CACHE_KEY = 'stock_cache_v2'
const CACHE_TTL = 24 * 60 * 60 * 1000 // 24시간
const META_REVALIDATE_MS = 5 * 60 * 1000 // 5분
const MIN_EXPECTED_STOCKS = 1500

type StockCachePayload = {
  items: StockItem[]
  ts: number
  signature?: string
  metaCheckedAt?: number
}

type StockMeta = {
  count: number
  latestUpdatedAt: string | null
  signature: string
}

// 모듈 수준 메모리 캐시 (페이지 전환해도 유지됨)
let _memCache: StockItem[] | null = null
let _fetchPromise: Promise<StockItem[]> | null = null

function readFromStorage(): StockCachePayload | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StockCachePayload
    if (!Array.isArray(parsed?.items)) return null
    if (!Number.isFinite(Number(parsed.ts))) return null
    if (Date.now() - Number(parsed.ts) > CACHE_TTL) return null
    // 과거 버전/불완전 캐시 방어: 종목 수가 비정상적으로 적으면 무효화
    if (parsed.items.length > 0 && parsed.items.length < MIN_EXPECTED_STOCKS) return null
    return {
      items: parsed.items,
      ts: Number(parsed.ts),
      signature: typeof parsed.signature === 'string' ? parsed.signature : undefined,
      metaCheckedAt: Number(parsed.metaCheckedAt || 0) || undefined,
    }
  } catch {
    return null
  }
}

function writeToStorage(payload: StockCachePayload) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload))
  } catch {
    // localStorage 쿼터 초과 무시
  }
}

async function fetchMeta(): Promise<StockMeta | null> {
  try {
    const res = await apiFetch('/api/ui/stocks?meta=1', {
      cacheMs: 5_000,
      timeoutMs: 10_000,
      retries: 1,
    })
    const count = Number(res?.count ?? 0)
    const latestUpdatedAt = res?.latestUpdatedAt ? String(res.latestUpdatedAt) : null
    const signature = String(res?.signature || `${count}:${latestUpdatedAt ?? ''}`)
    if (!Number.isFinite(count)) return null
    return { count, latestUpdatedAt, signature }
  } catch {
    return null
  }
}

async function doFetch(): Promise<StockItem[]> {
  const res = await apiFetch('/api/ui/stocks?all=1', {
    cacheMs: 0, // 자체 캐시 관리
    timeoutMs: 25_000,
    retries: 1,
  })
  return (res?.data ?? []) as StockItem[]
}

/**
 * 전체 종목 목록 반환
 * 메모리 캐시 → localStorage → API 순으로 조회
 */
export async function getStocks(): Promise<StockItem[]> {
  if (_memCache !== null) return _memCache

  const stored = readFromStorage()
  if (stored !== null) {
    const now = Date.now()
    const recentlyChecked = stored.metaCheckedAt && now - stored.metaCheckedAt < META_REVALIDATE_MS
    if (recentlyChecked) {
      _memCache = stored.items
      return stored.items
    }

    const meta = await fetchMeta()
    if (meta && stored.signature && meta.signature === stored.signature) {
      const refreshed: StockCachePayload = {
        ...stored,
        ts: now,
        metaCheckedAt: now,
      }
      _memCache = stored.items
      writeToStorage(refreshed)
      return stored.items
    }

    // meta 조회 실패 시 기존 캐시를 재사용해 과도한 전체 재조회 방지
    if (!meta) {
      _memCache = stored.items
      return stored.items
    }
  }

  if (!_fetchPromise) {
    _fetchPromise = doFetch()
      .then((items) => {
        // 비정상적으로 적은 데이터는 캐시에 저장하지 않음
        if (items.length > 0 && items.length < MIN_EXPECTED_STOCKS) {
          return items
        }
        _memCache = items
        const now = Date.now()
        let latestUpdatedAt = ''
        for (const item of items) {
          const value = String(item.updated_at || '')
          if (value > latestUpdatedAt) latestUpdatedAt = value
        }
        writeToStorage({
          items,
          ts: now,
          signature: `${items.length}:${latestUpdatedAt}`,
          metaCheckedAt: now,
        })
        return items
      })
      .finally(() => {
        _fetchPromise = null
      })
  }
  return _fetchPromise
}

/**
 * 종목명/코드로 즉시 클라이언트 필터링
 * @param q 검색어 (2자 이상 권장)
 * @param limit 최대 결과 수 (기본 20)
 */
export async function searchStocks(q: string, limit = 20): Promise<StockItem[]> {
  const all = await getStocks()
  if (!q || q.trim().length === 0) return []
  const lower = q.trim().toLowerCase()
  const results: StockItem[] = []
  for (const s of all) {
    if (
      s.code.toLowerCase().includes(lower) ||
      s.name.toLowerCase().includes(lower)
    ) {
      results.push(s)
      if (results.length >= limit) break
    }
  }
  return results
}

/**
 * 앱 시작 시 백그라운드 프리로드
 * 첫 번째 실제 요청 전에 캐시를 워밍업
 */
export function preloadStocks(): void {
  void getStocks()
}

/**
 * 캐시 무효화 (동기화 후 강제 새로고침 시 사용)
 */
export function invalidateStockCache(): void {
  _memCache = null
  try {
    localStorage.removeItem(CACHE_KEY)
  } catch {
    // ignore
  }
}
