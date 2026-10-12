export function buildAnalyzeShareUrl(code: string): string {
  if (typeof window === 'undefined') return ''
  const url = new URL(window.location.href)
  url.searchParams.set('code', code)
  return url.toString()
}
