export type StoredProfile = {
  clientId?: string
  telegramId?: string
  nickname?: string
  telegramUsername?: string
  telegramName?: string
}

export type SaveProfileOptions = {
  replace?: boolean
  syncServer?: boolean
}

export type SaveProfileResult = {
  profile: StoredProfile
  synced: boolean
  error?: string
}

import { supabase } from './supabase'

const RUNTIME_API_BASE_KEY = 'signal_scanner_api_base'
const PROFILE_UPDATED_EVENT = 'signal-scanner:profile-updated'
const PROFILE_STORAGE_KEY = 'profile'

function emitProfileUpdated() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(PROFILE_UPDATED_EVENT))
}

export function onProfileUpdated(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = () => listener()
  window.addEventListener(PROFILE_UPDATED_EVENT, handler)
  return () => window.removeEventListener(PROFILE_UPDATED_EVENT, handler)
}

export function readProfile(): StoredProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as StoredProfile
  } catch {
    return null
  }
}

function normalizeStoredProfile(profile: StoredProfile): StoredProfile {
  const next: StoredProfile = {}
  if (profile.clientId) next.clientId = String(profile.clientId).trim()
  if (profile.telegramId) next.telegramId = String(profile.telegramId).trim()
  if (profile.nickname) next.nickname = String(profile.nickname).trim()
  if (profile.telegramUsername) next.telegramUsername = String(profile.telegramUsername).trim()
  if (profile.telegramName) next.telegramName = String(profile.telegramName).trim()
  return next
}

function writeProfile(profile: StoredProfile | null) {
  try {
    if (!profile || Object.keys(profile).length === 0) {
      localStorage.removeItem(PROFILE_STORAGE_KEY)
      emitProfileUpdated()
      return
    }
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile))
    emitProfileUpdated()
  } catch { /* ignore */ }
}

async function syncProfileToServer(profile: StoredProfile): Promise<{ synced: boolean; error?: string }> {
  try {
    const identity = await getAuthIdentity()
    const clientId = String(profile.clientId || identity.userId || '')
    if (!clientId) return { synced: false, error: 'client_id missing' }

    const base = getApiBase() || ''
    const url = base ? `${base.replace(/\/$/, '')}/api/ui/profile` : `/api/ui/profile`
    const headers = buildProfileHeaders(identity.accessToken)
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        client_id: clientId,
        telegram_id: profile.telegramId || undefined,
        nickname: profile.nickname || undefined,
      }),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      return {
        synced: false,
        error: `server sync failed (${response.status})${text ? `: ${text.slice(0, 160)}` : ''}`,
      }
    }

    return { synced: true }
  } catch (error: any) {
    return { synced: false, error: error?.message || String(error) }
  }
}

export async function saveProfile(
  patch: Partial<StoredProfile>,
  options: SaveProfileOptions = {},
): Promise<SaveProfileResult> {
  const { replace = false, syncServer = true } = options
  const previous = readProfile() ?? {}
  const merged = normalizeStoredProfile(replace ? { ...patch } : { ...previous, ...patch })
  writeProfile(merged)

  if (!syncServer) {
    return { profile: merged, synced: false }
  }

  const shouldSync = !!merged.clientId
  if (!shouldSync) {
    return { profile: merged, synced: false }
  }

  const result = await syncProfileToServer(merged)
  if (!result.synced) {
    writeProfile(normalizeStoredProfile(previous))
    return { profile: normalizeStoredProfile(previous), synced: false, error: result.error }
  }

  return { profile: merged, synced: true }
}

export function ensureClientId(): string {
  try {
    const p = readProfile() ?? {}
    if (p.clientId) return p.clientId
    const id = `c_${Math.random().toString(36).slice(2, 10)}`
    saveProfile({ clientId: id })
    return id
  } catch {
    const id = `c_${Math.random().toString(36).slice(2, 10)}`
    try { saveProfile({ clientId: id }) } catch {}
    return id
  }
}

export async function loadProfileFromServer(): Promise<StoredProfile | null> {
  const identity = await getAuthIdentity()
  const p = readProfile() ?? {}
  const clientId = String(identity.userId || p.clientId || '')
  if (!clientId) return null

  const base = getApiBase() || ''
  const url = base ? `${base.replace(/\/$/, '')}/api/ui/profile?client_id=${encodeURIComponent(clientId)}` : `/api/ui/profile?client_id=${encodeURIComponent(clientId)}`
  const headers = buildProfileHeaders(identity.accessToken)
  const resp = await fetch(url, { method: 'GET', headers })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`profile fetch failed (${resp.status})${text ? `: ${text.slice(0, 160)}` : ''}`)
  }

  const json = await resp.json().catch(() => null)
  if (!json) throw new Error('profile fetch returned invalid JSON')
  if (json.error) throw new Error(String(json.error))

  const data = json.data ?? null
  const mapped: StoredProfile = { clientId }
  if (data?.telegram_id != null && String(data.telegram_id).trim() !== '') {
    mapped.telegramId = String(data.telegram_id)
  }
  if (data?.nickname != null && String(data.nickname).trim() !== '') {
    mapped.nickname = String(data.nickname)
  }

  writeProfile(normalizeStoredProfile(mapped))
  return mapped
}

async function getAuthIdentity(): Promise<{ userId?: string; accessToken?: string }> {
  try {
    if (!supabase) return {}
    const { data } = await supabase.auth.getSession()
    const session = data?.session
    if (!session || !session.user) return {}
    return {
      userId: session.user.id,
      accessToken: session.access_token,
    }
  } catch {
    return {}
  }
}

function buildProfileHeaders(accessToken?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  }

  const uiKey = String(import.meta.env.VITE_UI_READ_KEY || '').trim()
  if (uiKey) headers['x-ui-key'] = uiKey
  if (accessToken) headers.authorization = `Bearer ${accessToken}`
  return headers
}

export function clearProfile() {
  try {
    localStorage.removeItem(PROFILE_STORAGE_KEY)
    emitProfileUpdated()
  } catch { /* ignore */ }
}

export function normalizeChatId(raw: unknown): string {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  const digits = s.replace(/[^0-9]/g, '')
  return digits
}

function normalizeApiBase(raw: unknown): string {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  return s.replace(/\/$/, '')
}

function getAllowedChatIdsFromEnv(): string[] {
  const raw = String(
    import.meta.env.VITE_ALLOWED_CHAT_IDS
    || import.meta.env.VITE_ALLOWED_CHAT_ID
    || import.meta.env.VITE_DEFAULT_TELEGRAM_CHAT_ID
    || '',
  )
  if (!raw.trim()) return []
  return raw
    .split(',')
    .map(normalizeChatId)
    .filter(Boolean)
}

export function isAllowedChatId(raw: unknown): boolean {
  const chatId = normalizeChatId(raw)
  if (!chatId) return false
  const allowed = getAllowedChatIdsFromEnv()
  if (allowed.length === 0) return true
  return allowed.includes(chatId)
}

export function getApiBase(): string {
  const fromEnv = normalizeApiBase(import.meta.env.VITE_API_BASE)
  if (fromEnv) return fromEnv

  try {
    const fromStorage = normalizeApiBase(localStorage.getItem(RUNTIME_API_BASE_KEY))
    if (fromStorage) return fromStorage
  } catch {
    // ignore
  }

  return ''
}

export function saveApiBase(raw: unknown) {
  const value = normalizeApiBase(raw)
  try {
    if (!value) {
      localStorage.removeItem(RUNTIME_API_BASE_KEY)
      return
    }
    localStorage.setItem(RUNTIME_API_BASE_KEY, value)
  } catch {
    // ignore
  }
}
