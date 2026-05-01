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

const CACHE_KEY = 'stock_cache_v1'
const CACHE_TTL = 24 * 60 * 60 * 1000 // 24시간

// 모듈 수준 메모리 캐시 (페이지 전환해도 유지됨)
let _memCache: StockItem[] | null = null
let _fetchPromise: Promise<StockItem[]> | null = null

function readFromStorage(): StockItem[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { items: StockItem[]; ts: number }
    if (!Array.isArray(parsed?.items)) return null
    if (Date.now() - Number(parsed.ts) > CACHE_TTL) return null
    return parsed.items
  } catch {
    return null
  }
}

function writeToStorage(items: StockItem[]) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ items, ts: Date.now() }))
  } catch {
    // localStorage 쿼터 초과 무시
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
    _memCache = stored
    return stored
  }

  if (!_fetchPromise) {
    _fetchPromise = doFetch()
      .then((items) => {
        _memCache = items
        writeToStorage(items)
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
