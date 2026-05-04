export type StoredProfile = {
  clientId?: string
  telegramId?: string
  nickname?: string
  telegramUsername?: string
  telegramName?: string
}

const RUNTIME_API_BASE_KEY = 'signal_scanner_api_base'

export function readProfile(): StoredProfile | null {
  try {
    const raw = localStorage.getItem('profile')
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as StoredProfile
  } catch {
    return null
  }
}

export function saveProfile(patch: Partial<StoredProfile>) {
  const existing = readProfile() ?? {}
  try {
    const merged = { ...existing, ...patch }
    localStorage.setItem('profile', JSON.stringify(merged))

    // try to sync to server if we have a clientId (best-effort, fire-and-forget)
    ;(async () => {
      try {
        const clientId = String(merged.clientId || '')
        if (!clientId) return
        const base = getApiBase() || ''
        const url = base ? `${base.replace(/\/$/, '')}/api/ui/profile` : `/api/ui/profile`
        await fetch(`${url}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ client_id: clientId, telegram_id: merged.telegramId || undefined, nickname: merged.nickname || undefined }),
        })
      } catch {
        // ignore network errors
      }
    })()
  } catch { /* ignore */ }
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
  try {
    const p = readProfile() ?? {}
    const clientId = String(p.clientId || '')
    if (!clientId) return null
    const base = getApiBase() || ''
    const url = base ? `${base.replace(/\/$/, '')}/api/ui/profile?client_id=${encodeURIComponent(clientId)}` : `/api/ui/profile?client_id=${encodeURIComponent(clientId)}`
    const resp = await fetch(url, { method: 'GET' })
    if (!resp.ok) return null
    const json = await resp.json().catch(() => null)
    if (!json || json.error) return null
    const data = json.data ?? null
    if (!data) return null
    const mapped: StoredProfile = {
      clientId,
      telegramId: data.telegram_id ? String(data.telegram_id) : undefined,
      nickname: data.nickname || undefined,
    }
    saveProfile(mapped)
    return mapped
  } catch {
    return null
  }
}

export function clearProfile() {
  try { localStorage.removeItem('profile') } catch { /* ignore */ }
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

export function getCurrentUserChatId(): string {
  const profile = readProfile()
  const fromProfile = normalizeChatId(profile?.telegramId)
  if (fromProfile) return fromProfile

  const fromEnv = normalizeChatId(import.meta.env.VITE_DEFAULT_TELEGRAM_CHAT_ID)
  if (fromEnv) return fromEnv

  const fromLegacyEnv = normalizeChatId((import.meta as any)?.env?.DEFAULT_TELEGRAM_CHAT_ID)
  if (fromLegacyEnv) return fromLegacyEnv

  return ''
}
