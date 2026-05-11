import { create } from 'zustand'
import { readProfile, saveProfile, type StoredProfile } from '../lib/userContext'

type ProfileState = {
  profile: StoredProfile
  isAdmin: boolean
}

type ProfileActions = {
  setProfile: (patch: Partial<StoredProfile>) => void
  setIsAdmin: (val: boolean) => void
  refresh: () => void
}

export const useProfileStore = create<ProfileState & ProfileActions>((set) => ({
  profile: readProfile() ?? {},
  isAdmin: false,

  setProfile: (patch) => {
    set((s) => {
      const next = { ...s.profile, ...patch }
      saveProfile(next)
      return { profile: next }
    })
  },

  setIsAdmin: (val) => set({ isAdmin: val }),

  refresh: () => set({ profile: readProfile() ?? {} }),
}))
