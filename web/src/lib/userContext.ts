export type StoredProfile = {
  clientId?: string
  telegramId?: string
  nickname?: string
  telegramUsername?: string
  telegramName?: string
  /** 텔레그램 미연결 — telegramId는 서버가 만든 웹 전용 계정 ID (src/services/webAccount.ts) */
  webOnly?: boolean
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

/** 서버 src/services/webAccount.ts와 같은 예약 번호대 (9e12 ~ 1e13) */
export function isWebOnlyChatId(raw: unknown): boolean {
  const n = Number(raw)
  return Number.isFinite(n) && n >= 9_000_000_000_000 && n < 10_000_000_000_000
}

/** 실제로 연결된 텔레그램 ID — 웹 전용 계정이면 빈 문자열 */
export function linkedTelegramId(profile: StoredProfile | null | undefined): string {
  const id = normalizeTelegramChatId(profile?.telegramId)
  return id && !isWebOnlyChatId(id) ? id : ''
}

export function normalizeTelegramChatId(raw: unknown): string {
  const value = String(raw ?? '').trim().replace(/\s+/g, '')
  if (!value) return ''

  const compact = value.replace(/[^0-9-]/g, '')
  if (!compact) return ''
  if (!/^-?\d+$/.test(compact)) return ''

  return compact
}

const RUNTIME_API_BASE_KEY = 'signal_scanner_api_base'
const PROFILE_STORAGE_KEY = 'profile'

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
  const telegramId = normalizeTelegramChatId(profile.telegramId)
  if (telegramId) next.telegramId = telegramId
  if (profile.nickname) next.nickname = String(profile.nickname).trim()
  if (profile.telegramUsername) next.telegramUsername = String(profile.telegramUsername).trim()
  if (profile.telegramName) next.telegramName = String(profile.telegramName).trim()
  // 웹 전용 여부는 번호대로만 판단 — 저장된 표시를 믿으면 텔레그램을 새로 연결해도 남는다
  if (isWebOnlyChatId(telegramId)) next.webOnly = true
  return next
}

function writeProfile(profile: StoredProfile | null) {
  try {
    if (!profile || Object.keys(profile).length === 0) {
      localStorage.removeItem(PROFILE_STORAGE_KEY)
      return
    }
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile))
  } catch { /* ignore */ }
}

async function syncProfileToServer(profile: StoredProfile): Promise<{ synced: boolean; error?: string }> {
  try {
    const identity = await getAuthIdentity()
    const clientId = String(profile.clientId || identity.userId || '')
    if (!clientId) return { synced: false, error: 'client_id missing' }

    // 웹 전용 계정 ID는 서버가 정하는 값이라 보내지 않는다 (비우면 서버가 같은 ID를 다시 붙인다)
    const telegramId = linkedTelegramId(profile)

    const base = getApiBase() || ''
    const url = base ? `${base.replace(/\/$/, '')}/api/ui/profile` : `/api/ui/profile`
    const headers = buildProfileHeaders(identity.accessToken)
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        client_id: clientId,
        telegram_id: telegramId || undefined,
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
    writeProfile({ ...p, clientId: id })
    return id
  } catch {
    const id = `c_${Math.random().toString(36).slice(2, 10)}`
    try { writeProfile({ clientId: id }) } catch {}
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
  const telegramId = normalizeTelegramChatId(data?.telegram_id)
  if (telegramId) {
    mapped.telegramId = telegramId
    if (isWebOnlyChatId(telegramId)) mapped.webOnly = true
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
  } catch { /* ignore */ }
}

function normalizeApiBase(raw: unknown): string {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  return s.replace(/\/$/, '')
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
