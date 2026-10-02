import type { VercelRequest } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { ensureWebAccountChatId } from '../../src/services/webAccount'
import { mayCreateAccount } from '../../src/services/invites'

export type UiUserContext = {
  clientId: string | null
  chatId: number | null
  authenticated: boolean
  source: 'auth' | 'header' | 'query' | 'body' | 'env' | 'none'
}

let _supabase: SupabaseClient | null = null

function getSupabase(): SupabaseClient | null {
  if (_supabase) return _supabase
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
  if (!url || !key) return null
  _supabase = createClient(url, key, { auth: { persistSession: false } })
  return _supabase
}

function toChatId(raw: unknown): number | null {
  const v = String(raw ?? '').trim()
  if (!v) return null
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.trunc(n)
}

function toClientId(raw: unknown): string | null {
  const v = String(raw ?? '').trim()
  return v ? v : null
}

/** 엄격 모드에서는 요청에 실린 chat_id를 신원으로 쓰는 개별 핸들러 경로도 모두 막아야 한다. */
export function isStrictIdentity(): boolean {
  return ['1', 'true', 'yes'].includes(String(process.env.UI_STRICT_IDENTITY || '').trim().toLowerCase())
}

/**
 * allowNonMember: 초대 전용 모드에서 아직 회원이 아닌 로그인 계정도 신원(clientId)만 돌려준다.
 * 초대 가입 화면(invites 핸들러)만 쓴다. 그 밖의 핸들러는 비회원을 미인증으로 취급한다.
 */
export async function resolveUiUserContext(req: VercelRequest, opts: { allowNonMember?: boolean } = {}): Promise<UiUserContext> {
  const authHeader = String(req.headers.authorization || '').trim()
  const bearer = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : ''

  if (bearer) {
    const supabase = getSupabase()
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
    if (supabase && url && key) {
      try {
        const authRes = await fetch(`${url.replace(/\/$/, '')}/auth/v1/user`, {
          method: 'GET',
          headers: {
            apikey: key,
            Authorization: `Bearer ${bearer}`,
          },
        })
        if (authRes.ok) {
          const authData = await authRes.json().catch(() => null) as { id?: string } | null
          const clientId = String(authData?.id || '').trim()
          if (clientId) {
            const { data } = await supabase
              .from('web_user_profiles')
              .select('telegram_id')
              .eq('client_id', clientId)
              .maybeSingle()
            // 초대 전용 모드: 회원이 아니면 계정을 만들지 않는다 (가입은 초대 코드·승인으로만)
            if (!data && !(await mayCreateAccount(supabase, clientId))) {
              return opts.allowNonMember
                ? { clientId, chatId: null, authenticated: true, source: 'auth' }
                : { clientId: null, chatId: null, authenticated: false, source: 'none' }
            }
            // 텔레그램은 선택 — 연결 전에는 웹 전용 계정 ID를 만들어 쓴다 (src/services/webAccount.ts)
            const chatId = toChatId(data?.telegram_id) ?? (await ensureWebAccountChatId(supabase, clientId))
            return { clientId, chatId, authenticated: true, source: 'auth' }
          }
        }
      } catch {
        // Invalid bearer tokens must not fall through to caller-supplied identities.
        return { clientId: null, chatId: null, authenticated: false, source: 'none' }
      }
    }
    return { clientId: null, chatId: null, authenticated: false, source: 'none' }
  }

  // 엄격 모드: 로그인 세션 없이 호출자가 넘긴 chat_id/client_id/서버 기본값은 신원으로 쓰지 않는다.
  if (isStrictIdentity()) {
    return { clientId: null, chatId: null, authenticated: false, source: 'none' }
  }

  const q = req.query || {}
  const body = (req.body || {}) as any
  const clientId = toClientId(
    req.headers['x-user-client-id']
      ?? (q as any).client_id
      ?? (q as any).clientId
      ?? body.client_id
      ?? body.clientId
  )

  const fromHeader = toChatId(req.headers['x-user-chat-id'])
  if (fromHeader) return { clientId, chatId: fromHeader, authenticated: false, source: 'header' }

  const fromQuery = toChatId((q as any).chat_id ?? (q as any).chatId)
  if (fromQuery) return { clientId, chatId: fromQuery, authenticated: false, source: 'query' }

  const fromBody = toChatId(body.chat_id ?? body.chatId)
  if (fromBody) return { clientId, chatId: fromBody, authenticated: false, source: 'body' }

  const fromEnv = toChatId(
    process.env.DEFAULT_TELEGRAM_CHAT_ID ||
    process.env.TELEGRAM_DEFAULT_CHAT_ID ||
    process.env.VITE_DEFAULT_TELEGRAM_CHAT_ID,
  )
  if (fromEnv) return { clientId, chatId: fromEnv, authenticated: false, source: 'env' }

  return { clientId, chatId: null, authenticated: false, source: 'none' }
}
