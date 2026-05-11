import { useCallback } from 'react'

type ShareRouteParams = {
  path: string
  query?: Record<string, string | number | boolean | null | undefined>
  title: string
  text?: string
}

function buildAbsoluteRouteUrl(path: string, query?: ShareRouteParams['query']): string {
  if (typeof window === 'undefined') return path
  const url = new URL(path, window.location.origin)
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value == null) continue
      const normalized = String(value).trim()
      if (!normalized) continue
      url.searchParams.set(key, normalized)
    }
  }
  return url.toString()
}

export function useRouteShare() {
  const shareRoute = useCallback(async (params: ShareRouteParams): Promise<{ url: string; mode: 'native' | 'copy' }> => {
    const url = buildAbsoluteRouteUrl(params.path, params.query)

    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: params.title,
          text: params.text || params.title,
          url,
        })
        return { url, mode: 'native' }
      } catch {
        // Ignore and fallback to clipboard copy.
      }
    }

    try {
      await navigator.clipboard?.writeText(url)
    } catch {
      // Ignore clipboard failure and still return URL to caller.
    }

    return { url, mode: 'copy' }
  }, [])

  return { shareRoute }
}
