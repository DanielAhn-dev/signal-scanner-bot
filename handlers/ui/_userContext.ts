import type { VercelRequest } from '@vercel/node'

export type UiUserContext = {
  chatId: number | null
  source: 'header' | 'query' | 'body' | 'env' | 'none'
}

function toChatId(raw: unknown): number | null {
  const v = String(raw ?? '').trim()
  if (!v) return null
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.trunc(n)
}

export function resolveUiUserContext(req: VercelRequest): UiUserContext {
  const fromHeader = toChatId(req.headers['x-user-chat-id'])
  if (fromHeader) return { chatId: fromHeader, source: 'header' }

  const q = req.query || {}
  const fromQuery = toChatId((q as any).chat_id ?? (q as any).chatId)
  if (fromQuery) return { chatId: fromQuery, source: 'query' }

  const body = (req.body || {}) as any
  const fromBody = toChatId(body.chat_id ?? body.chatId)
  if (fromBody) return { chatId: fromBody, source: 'body' }

  const fromEnv = toChatId(
    process.env.DEFAULT_TELEGRAM_CHAT_ID ||
    process.env.TELEGRAM_DEFAULT_CHAT_ID ||
    process.env.VITE_DEFAULT_TELEGRAM_CHAT_ID,
  )
  if (fromEnv) return { chatId: fromEnv, source: 'env' }

  return { chatId: null, source: 'none' }
}
