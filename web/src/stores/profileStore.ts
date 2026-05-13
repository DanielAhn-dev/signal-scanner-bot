import { create } from 'zustand'
import { clearProfile, loadProfileFromServer, readProfile, saveProfile, type SaveProfileOptions, type SaveProfileResult, type StoredProfile } from '../lib/userContext'

type ProfileState = {
  profile: StoredProfile
  isAdmin: boolean
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

export const useProfileStore = create<ProfileState & ProfileActions>((set) => ({
  profile: readProfile() ?? {},
  isAdmin: false,
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
    set({ profile: {}, syncError: '', isHydrating: false })
  },

  setIsAdmin: (val) => set({ isAdmin: val }),

  refresh: () => set({ profile: readProfile() ?? {} }),

  setSyncError: (message) => set({ syncError: message }),
}))
