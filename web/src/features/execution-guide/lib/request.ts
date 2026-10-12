import { getAuthHeaders } from '../../../lib/api'
import { getCurrentClientIdFromStore } from '../../../stores/profileStore'

/** 실행가이드 리포트 PDF 등 직접 fetch용: UI 읽기 키·클라이언트/채팅 ID를 쿼리와 헤더에 붙인다 */
export function appendQueryParam(url: string, key: string, value: string): string {
  if (!value) return url
  if (new RegExp(`(?:\\?|&)${key}=`).test(url)) return url
  return `${url}${url.includes('?') ? '&' : '?'}${encodeURIComponent(key)}=${encodeURIComponent(value)}`
}

export async function buildUiRequest(endpoint: string, chatId: string): Promise<{ url: string; headers: Record<string, string> }> {
  const base = import.meta.env.VITE_API_BASE || ''
  const uiKey = import.meta.env.VITE_UI_READ_KEY
  const clientId = getCurrentClientIdFromStore()

  let resolvedEndpoint = endpoint
  if (uiKey) resolvedEndpoint = appendQueryParam(resolvedEndpoint, 'ui_key', uiKey)
  if (clientId) resolvedEndpoint = appendQueryParam(resolvedEndpoint, 'client_id', clientId)
  if (chatId) resolvedEndpoint = appendQueryParam(resolvedEndpoint, 'chat_id', chatId)

  const url = base
    ? `${base.replace(/\/$/, '')}${resolvedEndpoint.startsWith('/') ? resolvedEndpoint : `/${resolvedEndpoint}`}`
    : resolvedEndpoint

  const headers: Record<string, string> = { ...(await getAuthHeaders()) }
  if (uiKey) headers['x-ui-key'] = uiKey
  if (chatId) headers['x-user-chat-id'] = chatId
  return { url, headers }
}
