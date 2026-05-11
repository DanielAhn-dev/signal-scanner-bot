import { useCallback, useEffect, useState } from 'react'
import { getCurrentUserChatId } from '../lib/userContext'
import { useToast } from '../components/ToastProvider'

type ShareListItem = {
  shareId: string
  publicToken: string
  topic: string
  expiresAt: string
  createdAt?: string
  revokedAt?: string | null
  accessCount?: number
  lastAccessedAt?: string | null
  url?: string
}

type ShareInfo = {
  shareId?: string
  url: string
  code?: string | null
  expiresAt?: string
}

type UseShareManagerOptions = {
  endpoint: string
  scopeKey: 'topic' | 'kind'
  requiresCode?: boolean
}

function appendQueryParam(url: string, key: string, value: string): string {
  if (!value) return url
  if (new RegExp(`(?:\\?|&)${key}=`).test(url)) return url
  return `${url}${url.includes('?') ? '&' : '?'}${encodeURIComponent(key)}=${encodeURIComponent(value)}`
}

function buildUiRequest(endpoint: string) {
  const base = import.meta.env.VITE_API_BASE || ''
  const uiKey = import.meta.env.VITE_UI_READ_KEY
  const chatId = getCurrentUserChatId() || ''

  let resolvedEndpoint = endpoint
  if (uiKey) resolvedEndpoint = appendQueryParam(resolvedEndpoint, 'ui_key', uiKey)
  if (chatId) resolvedEndpoint = appendQueryParam(resolvedEndpoint, 'chat_id', chatId)

  const url = base
    ? `${base.replace(/\/$/, '')}${resolvedEndpoint.startsWith('/') ? resolvedEndpoint : `/${resolvedEndpoint}`}`
    : resolvedEndpoint

  const headers: Record<string, string> = {}
  if (uiKey) headers['x-ui-key'] = uiKey
  if (chatId) headers['x-user-chat-id'] = chatId
  return { url, headers }
}

export function useShareManager(options: UseShareManagerOptions) {
  const { endpoint, scopeKey, requiresCode = false } = options
  const toast = useToast()

  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState('')
  const [info, setInfo] = useState<ShareInfo | null>(null)
  const [list, setList] = useState<ShareListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [includeAll, setIncludeAll] = useState(false)

  const loadList = useCallback(async (nextScope = scope, nextIncludeAll = includeAll) => {
    if (!nextScope) return
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set(scopeKey, nextScope)
      if (nextIncludeAll) params.set('all', '1')
      const request = buildUiRequest(`${endpoint}?${params.toString()}`)
      const res = await fetch(request.url, { headers: request.headers })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || '공유 목록 조회 실패')
      setList(Array.isArray(json?.data) ? json.data : [])
    } catch (e: any) {
      toast.show(String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [endpoint, includeAll, scope, scopeKey, toast])

  const createShare = useCallback(async (nextScope: string, body: Record<string, unknown>) => {
    setCreating(true)
    try {
      setScope(nextScope)
      const request = buildUiRequest(endpoint)
      const headers = { ...request.headers, 'Content-Type': 'application/json' }
      const payload = {
        ...body,
        [scopeKey]: nextScope,
      }
      const res = await fetch(request.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || '공유 생성 실패')

      const nextInfo: ShareInfo = {
        shareId: json?.shareId,
        url: String(json?.url || ''),
        code: json?.code ?? null,
        expiresAt: json?.expiresAt,
      }
      setInfo(nextInfo)
      setOpen(true)
      await loadList(nextScope, includeAll)
      toast.show('공유 URL 생성됨 ✓')
      try {
        await navigator.clipboard?.writeText(nextInfo.url)
      } catch {
        // ignore clipboard failure
      }
      return nextInfo
    } catch (e: any) {
      toast.show(String(e?.message || e))
      return null
    } finally {
      setCreating(false)
    }
  }, [endpoint, includeAll, loadList, scopeKey, toast])

  const revokeShare = useCallback(async (shareId: string) => {
    if (!scope) return
    setRevokingId(shareId)
    try {
      const request = buildUiRequest(`${endpoint}?shareId=${encodeURIComponent(shareId)}&${scopeKey}=${encodeURIComponent(scope)}`)
      const res = await fetch(request.url, { method: 'DELETE', headers: request.headers })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || '공유 철회 실패')
      toast.show('공유 링크를 철회했습니다.')
      await loadList(scope, includeAll)
    } catch (e: any) {
      toast.show(String(e?.message || e))
    } finally {
      setRevokingId(null)
    }
  }, [endpoint, includeAll, loadList, scope, scopeKey, toast])

  useEffect(() => {
    if (!open) return
    void loadList(scope, includeAll)
  }, [open, scope, includeAll, loadList])

  return {
    open,
    setOpen,
    info,
    list,
    loading,
    revokingId,
    creating,
    includeAll,
    setIncludeAll,
    requiresCode,
    createShare,
    loadList,
    revokeShare,
    close: () => {
      setOpen(false)
      setInfo(null)
    },
  }
}
