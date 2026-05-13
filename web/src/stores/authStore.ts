import { create } from 'zustand'
import type { Session } from '@supabase/supabase-js'
import { supabase, isSupabaseConfigured } from '../lib/supabase'
import { readProfile } from '../lib/userContext'
import { useProfileStore } from './profileStore'

export type AuthState = {
  isSignedIn: boolean
  isSigningIn: boolean
  authReady: boolean
  authEmail: string
  authName: string
  authError: string
}

export type AuthActions = {
  setAuthError: (msg: string) => void
  signIn: () => Promise<void>
  signOut: () => Promise<void>
  /** Supabase 세션을 구독하고 상태를 동기화한다. cleanup 함수를 반환한다. */
  initAuth: () => () => void
}

const AUTH_RETURN_HASH_KEY = 'supabase-auth-return-hash'
const AUTH_ERROR_KEY = 'supabase-auth-last-error'

function decodeAuthValue(value: string): string {
  let current = value
  for (let i = 0; i < 2; i++) {
    try {
      const decoded = decodeURIComponent(current.replace(/\+/g, ' '))
      if (decoded === current) break
      current = decoded
    } catch {
      break
    }
  }
  return current
}

function readAuthErrorFromLocation(): string {
  if (typeof window === 'undefined') return ''
  const query = new URLSearchParams(window.location.search)
  const hash = window.location.hash.startsWith('#')
    ? new URLSearchParams(window.location.hash.slice(1))
    : new URLSearchParams()
  const error = query.get('error') || hash.get('error') || ''
  const description = query.get('error_description') || hash.get('error_description') || ''
  const code = query.get('error_code') || hash.get('error_code') || ''
  if (!error && !description && !code) return ''
  const message = decodeAuthValue(description || error || 'Google 로그인 처리 중 오류가 발생했습니다.')
  if (code) return `${message} (${decodeAuthValue(code)})`
  return message
}

export const useAuthStore = create<AuthState & AuthActions>((set, get) => ({
  isSignedIn: false,
  isSigningIn: false,
  authReady: !isSupabaseConfigured,
  authEmail: '',
  authName: '',
  authError: '',

  setAuthError: (msg) => set({ authError: msg }),

  initAuth: () => {
    if (!supabase || !isSupabaseConfigured) {
      set({ authReady: true })
      return () => {}
    }

    let disposed = false
    let sessionCheckTimer: ReturnType<typeof setTimeout> | undefined

    const markAuthReady = () => {
      if (disposed) return
      set({ authReady: true })
    }

    const applySession = async (session: Session | null) => {
      const user = session?.user
      if (!user) {
        if (disposed) return
        useProfileStore.getState().clearState()
        set({ isSignedIn: false, authEmail: '', authName: '', authError: '' })
        markAuthReady()
        return
      }
      const metadata = (user.user_metadata ?? {}) as Record<string, unknown>
      const name = String(metadata.full_name || metadata.name || metadata.preferred_username || '').trim()
      const email = String(user.email || '').trim()
      const profileStore = useProfileStore.getState()
      await profileStore.setProfile(
        { clientId: user.id, nickname: name || readProfile()?.nickname },
        { syncServer: false },
      )
      try {
        await profileStore.hydrateFromServer()
      } catch (error: any) {
        if (!disposed) {
          console.error('[auth] profile hydration failed:', error?.message || String(error))
        }
      }
      if (disposed) return
      set({ isSignedIn: true, authEmail: email, authName: name })
      markAuthReady()
    }

    // OAuth 리디렉션 오류 처리
    try {
      const message = readAuthErrorFromLocation()
      if (message) {
        set({ authError: message })
        window.sessionStorage.setItem(AUTH_ERROR_KEY, message)
        const returnPath = window.sessionStorage.getItem(AUTH_RETURN_HASH_KEY) || ''
        const cleanPath = returnPath.startsWith('#')
          ? `/${returnPath.slice(1)}`
          : returnPath.startsWith('/') ? returnPath : window.location.pathname
        window.history.replaceState({}, document.title, cleanPath)
      } else {
        const stored = window.sessionStorage.getItem(AUTH_ERROR_KEY) || ''
        if (stored) set({ authError: stored })
      }
    } catch { /* ignore */ }

    sessionCheckTimer = setTimeout(() => {
      if (!disposed && !get().authReady) markAuthReady()
    }, 5000)

    void supabase.auth.getSession()
      .then(({ data }) => applySession(data?.session ?? null))
      .catch(() => applySession(null))
      .finally(() => {
        if (sessionCheckTimer !== undefined) clearTimeout(sessionCheckTimer)
      })

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      void applySession(session)
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') set({ isSigningIn: false })
      if (event === 'SIGNED_IN' && typeof window !== 'undefined') {
        try {
          const returnPath = window.sessionStorage.getItem(AUTH_RETURN_HASH_KEY)
          if (returnPath) {
            window.sessionStorage.removeItem(AUTH_RETURN_HASH_KEY)
            const path = returnPath.startsWith('#')
              ? `/${returnPath.slice(1)}`
              : returnPath.startsWith('/') ? returnPath : `/${returnPath}`
            if (path && path !== window.location.pathname) window.history.pushState({}, '', path)
          }
        } catch { /* ignore */ }
      }
    })

    return () => {
      disposed = true
      if (sessionCheckTimer !== undefined) clearTimeout(sessionCheckTimer)
      listener.subscription.unsubscribe()
    }
  },

  signIn: async () => {
    if (!supabase || !isSupabaseConfigured) return
    set({ isSigningIn: true, authError: '' })
    try {
      window.sessionStorage.removeItem(AUTH_ERROR_KEY)
      window.sessionStorage.setItem(AUTH_RETURN_HASH_KEY, window.location.pathname || '/dashboard')
    } catch { /* ignore */ }
    const envRedirectTo = import.meta.env.VITE_SUPABASE_OAUTH_REDIRECT || import.meta.env.VITE_OAUTH_REDIRECT
    const isLocalhost = /^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname)
    const redirectTo = isLocalhost
      ? window.location.origin
      : (envRedirectTo || `${window.location.origin}${window.location.pathname}`)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo, queryParams: { prompt: 'select_account' } },
    })
    if (error) {
      const detail = String(error.message || '')
      const msg = /Unsupported provider/i.test(detail)
        ? 'Google provider가 비활성화되어 있습니다. Supabase Authentication > Providers에서 활성화해 주세요.'
        : detail || 'Google 로그인에 실패했습니다.'
      set({ authError: msg, isSigningIn: false })
    }
  },

  signOut: async () => {
    if (!supabase || !isSupabaseConfigured) return
    try {
      await supabase.auth.signOut()
    } catch { /* ignore */ }
    useProfileStore.getState().clearState()
    set({ isSignedIn: false, authEmail: '', authName: '', authError: '' })
  },
}))
