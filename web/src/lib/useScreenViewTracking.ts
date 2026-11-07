import { useEffect } from 'react'
import { apiFetch } from './api'

/**
 * 화면별 방문을 서버에 1회씩 센다(정리 대상 판단용 집계). 실패해도 화면엔 영향 없다.
 * 같은 화면에서 새로고침·재렌더로 중복되지 않게 경로가 바뀔 때만, 짧은 체류(1.5초 미만)는 건너뛴다.
 */
export function useScreenViewTracking(route: string, enabled: boolean) {
  useEffect(() => {
    if (!enabled || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(route)) return
    const t = window.setTimeout(() => {
      apiFetch('/api/ui/screen-views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ screen: route }),
        cacheMs: 0,
        retries: 0,
      }).catch(() => {})
    }, 1500)
    return () => window.clearTimeout(t)
  }, [route, enabled])
}
