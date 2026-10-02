import { create } from 'zustand'
import { clearProfile, linkedTelegramId, loadProfileFromServer, readProfile, saveProfile, type SaveProfileOptions, type SaveProfileResult, type StoredProfile } from '../lib/userContext'

type ProfileState = {
  profile: StoredProfile
  isAdmin: boolean
  /** 관리자 여부 조회가 끝났는지 — 끝나기 전에는 경로를 막지 않는다 */
  isAdminReady: boolean
  syncError: string
  isHydrating: boolean
}

type ProfileActions = {
  setProfile: (patch: Partial<StoredProfile>, options?: SaveProfileOptions) => Promise<SaveProfileResult>
  hydrateFromServer: () => Promise<StoredProfile | null>
  clearState: () => void
  setIsAdmin: (val: boolean) => void
  refresh: () => void
  setSyncError: (message: string) => void
}

export const selectProfile = (state: ProfileState) => state.profile
export const selectCurrentClientId = (state: ProfileState) => state.profile.clientId || ''
export const selectCurrentChatId = (state: ProfileState) => state.profile.telegramId || ''
// 계정 ID(telegramId)는 웹 전용일 수 있다 — 텔레그램 기능은 실제 연결일 때만
export const selectIsTelegramLinked = (state: ProfileState) => !!linkedTelegramId(state.profile)

export const useProfileStore = create<ProfileState & ProfileActions>((set) => ({
  profile: readProfile() ?? {},
  isAdmin: false,
  isAdminReady: false,
  syncError: '',
  isHydrating: false,

  setProfile: async (patch, options) => {
    const result = await saveProfile(patch, options)
    set({
      profile: result.profile,
      syncError: result.error || '',
    })
    return result
  },

  hydrateFromServer: async () => {
    set({ isHydrating: true, syncError: '' })
    try {
      const profile = await loadProfileFromServer()
      set({ profile: profile ?? {}, isHydrating: false, syncError: '' })
      return profile
    } catch (error: any) {
      const message = error?.message || String(error)
      set({ isHydrating: false, syncError: message, profile: readProfile() ?? {} })
      throw error
    }
  },

  clearState: () => {
    clearProfile()
    set({ profile: {}, isAdmin: false, isAdminReady: false, syncError: '', isHydrating: false })
  },

  setIsAdmin: (val) => set({ isAdmin: val, isAdminReady: true }),

  refresh: () => set({ profile: readProfile() ?? {} }),

  setSyncError: (message) => set({ syncError: message }),
}))

export function getCurrentChatIdFromStore(): string {
  return useProfileStore.getState().profile.telegramId || ''
}

export function getCurrentClientIdFromStore(): string {
  return useProfileStore.getState().profile.clientId || ''
}

export function useCurrentClientId(): string {
  return useProfileStore(selectCurrentClientId)
}

export function useCurrentChatId(): string {
  return useProfileStore(selectCurrentChatId)
}

export function useIsTelegramLinked(): boolean {
  return useProfileStore(selectIsTelegramLinked)
}
