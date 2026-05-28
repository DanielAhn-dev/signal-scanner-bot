import type { VercelRequest } from '@vercel/node'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { resolveUiUserContext } from './_userContext'

export const ADVANCED_ROUTES = new Set([
  'trigger-update',
  'trigger-briefing',
  'sync-history',
  'sync-status',
  'report-pdf',
  'report-share',
  'report-snapshot',
  'report-web',
])

const ACCESS_TABLE = 'web_advanced_access_users'

type AccessIdentity = {
  clientId: string | null
  chatId: number | null
}

function parsePositiveInt(raw: unknown): number | null {
  const value = Number(String(raw ?? '').trim())
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.trunc(value)
}

function parseAdminChatIdSet(): Set<number> {
  const raw = String(process.env.UI_ADMIN_CHAT_IDS || process.env.UI_ADMIN_CHAT_ID || '').trim()
  if (!raw) return new Set<number>()
  const values = raw
    .split(',')
    .map((v) => Number(String(v).trim()))
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((n) => Math.trunc(n))
  return new Set(values)
}

function getOwnerAdminChatId(): number | null {
  return parsePositiveInt(process.env.TELEGRAM_OWNER_USER_ID)
}

function parseAdminClientIdSet(): Set<string> {
  const raw = String(process.env.UI_ADMIN_CLIENT_IDS || process.env.UI_ADMIN_CLIENT_ID || '').trim()
  if (!raw) return new Set<string>()
  return new Set(
    raw
      .split(',')
      .map((v) => String(v).trim())
      .filter(Boolean),
  )
}

function getSupabaseAdminClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
  if (!url || !key) return null
  return createClient(url, key)
}

export async function resolveRequesterChatId(req: VercelRequest): Promise<number | null> {
  const user = await resolveUiUserContext(req)
  if (user.source === 'env' || user.source === 'none') return null
  return user.chatId
}

export async function resolveRequesterIdentity(req: VercelRequest): Promise<AccessIdentity | null> {
  const user = await resolveUiUserContext(req)
  if (user.source === 'env' || user.source === 'none') return null
  return {
    clientId: user.clientId,
    chatId: user.chatId,
  }
}

export function isAdminChatId(chatId: number | null): boolean {
  if (!chatId) return false
  const owner = getOwnerAdminChatId()
  if (owner && chatId === owner) return true
  return parseAdminChatIdSet().has(chatId)
}

export function isAdminClientId(clientId: string | null): boolean {
  if (!clientId) return false
  return parseAdminClientIdSet().has(clientId)
}

async function getAccessRowFromTable(supabase: SupabaseClient, identity: AccessIdentity): Promise<{ isEnabled: boolean; isAdmin: boolean }> {
  const column = identity.clientId ? 'client_id' : 'chat_id'
  const value = identity.clientId || identity.chatId
  if (!value) return { isEnabled: false, isAdmin: false }

  const { data, error } = await supabase
    .from(ACCESS_TABLE)
    .select('chat_id,client_id,is_enabled,is_admin')
    .eq(column, value)
    .limit(1)

  if (error || !data || !data[0]) return { isEnabled: false, isAdmin: false }
  const row = data[0] as { is_enabled?: boolean | null; is_admin?: boolean | null }
  return {
    isEnabled: row.is_enabled !== false,
    isAdmin: row.is_admin === true,
  }
}

export async function evaluateAdvancedAccess(identity: AccessIdentity | null): Promise<{
  allowed: boolean
  isAdmin: boolean
  hasAdvancedAccess: boolean
}> {
  if (!identity || (!identity.clientId && !identity.chatId)) {
    return { allowed: false, isAdmin: false, hasAdvancedAccess: false }
  }

  const isOwnerAdmin = isAdminChatId(identity.chatId) || isAdminClientId(identity.clientId)
  if (isOwnerAdmin) return { allowed: true, isAdmin: true, hasAdvancedAccess: true }

  const supabase = getSupabaseAdminClient()
  if (!supabase) return { allowed: false, isAdmin: false, hasAdvancedAccess: false }

  const access = await getAccessRowFromTable(supabase, identity)
  const isAdmin = access.isAdmin
  const hasAdvancedAccess = access.isEnabled || isAdmin
  return { allowed: hasAdvancedAccess, isAdmin, hasAdvancedAccess }
}

export async function enforceAdvancedRouteAccess(req: VercelRequest): Promise<{ allowed: true } | { allowed: false; status: number; error: string }> {
  const identity = await resolveRequesterIdentity(req)
  if (!identity || (!identity.clientId && !identity.chatId)) {
    return {
      allowed: false,
      status: 400,
      error: 'client_id or chat_id required for advanced routes',
    }
  }

  const access = await evaluateAdvancedAccess(identity)
  if (access.allowed) return { allowed: true }

  return {
    allowed: false,
    status: 403,
    error: 'Advanced feature access denied',
  }
}

export function getAccessTableName(): string {
  return ACCESS_TABLE
}

export function getSupabaseAdminForUi(): SupabaseClient | null {
  return getSupabaseAdminClient()
}
