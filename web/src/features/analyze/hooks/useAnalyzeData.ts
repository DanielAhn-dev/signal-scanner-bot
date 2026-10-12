import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '../../../lib/api'
import type { OhlcvCandle } from '../../../lib/types'
import { ANALYZE_PENDING_CODE_KEY } from '../constants'
import { normalizeCandles } from '../lib/candles'
import { buildAnalyzeShareUrl } from '../lib/shareUrl'

/**
 * 종목 조회와 결과 상태. 조회를 시작하면 이전 결과를 모두 비운 뒤 채운다.
 * 마운트 시 URL `?code=` 또는 다른 화면이 sessionStorage로 넘긴 종목을 이어받는다.
 * 연달아 조회하면 마지막 조회의 응답만 반영한다(먼저 보낸 조회가 늦게 와서 결과를 덮어쓰지 않게).
 */
export function useAnalyzeData(input: {
  chatId: string
  query: string
  setQuery: React.Dispatch<React.SetStateAction<string>>
  pushRecentSearch: (stock: { code: string; name: string }) => void
}) {
  const { chatId, query, setQuery, pushRecentSearch } = input
  const [result, setResult] = useState<any | null>(null)
  const [candles, setCandles] = useState<OhlcvCandle[]>([])
  const [flow, setFlow] = useState<any | null>(null)
  const [creditShort, setCreditShort] = useState<any | null>(null)
  const [advisor, setAdvisor] = useState<any | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestSeqRef = useRef(0)

  const analyze = async (code?: string) => {
    const q = code ?? query.trim()
    if (!q) return
    const seq = ++requestSeqRef.current
    const isLatest = () => seq === requestSeqRef.current

    setLoading(true)
    setError(null)
    setResult(null)
    setFlow(null)
    setCreditShort(null)
    setAdvisor(null)
    setCandles([])

    try {
      const chatQs = chatId ? `&chat_id=${encodeURIComponent(chatId)}` : ''
      const res = await apiFetch(`/api/ui/stock-latest?code=${encodeURIComponent(q)}${chatQs}`, { cacheMs: 0 })
      if (!isLatest()) return
      if (res?.profile || res?.latest) {
        const merged = { ...res.profile, ...res.latest }
        setResult(merged)
        if (merged.code && (merged.name || merged.code)) {
          pushRecentSearch({ code: merged.code, name: merged.name ?? merged.code })
        }
        // OHLCV 캔들 데이터: 서버 series를 OhlcvCandle 형태로 정규화
        const rawData: any[] = res?.data ?? []
        setCandles(normalizeCandles(rawData))
        setFlow(res?.flow ?? null)
        setCreditShort(res?.creditShort ?? null)
        setAdvisor(res?.advisor ?? null)
      } else if (res?.error) {
        setError(res.error)
      } else {
        setError('조회 결과 없음')
      }
    } catch (e: any) {
      if (isLatest()) setError(e?.message || String(e))
    } finally {
      if (isLatest()) setLoading(false)
    }
  }

  useEffect(() => {
    if (!result?.code || typeof window === 'undefined') return
    try {
      const nextUrl = buildAnalyzeShareUrl(result.code)
      if (nextUrl !== window.location.href) {
        window.history.replaceState({}, '', nextUrl)
      }
    } catch {
      // ignore
    }
  }, [result?.code])

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const sharedCode = params.get('code')?.trim()
      const pending = sessionStorage.getItem(ANALYZE_PENDING_CODE_KEY)
      const initialCode = sharedCode || pending
      if (pending) {
        sessionStorage.removeItem(ANALYZE_PENDING_CODE_KEY)
      }
      if (initialCode) {
        setQuery(initialCode)
        void analyze(initialCode)
      }
    } catch {
      // ignore
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return { result, candles, flow, creditShort, advisor, loading, error, analyze }
}
