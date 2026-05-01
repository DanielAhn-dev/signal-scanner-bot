export type StoredProfile = {
  telegramId?: string
  nickname?: string
  telegramUsername?: string
  telegramName?: string
}

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
    localStorage.setItem('profile', JSON.stringify({ ...existing, ...patch }))
  } catch { /* ignore */ }
}

export function clearProfile() {
  try { localStorage.removeItem('profile') } catch { /* ignore */ }
}

function normalizeChatId(raw: unknown): string {
  const s = String(raw ?? '').trim()
  if (!s) return ''
  const digits = s.replace(/[^0-9]/g, '')
  return digits
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
