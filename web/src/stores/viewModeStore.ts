import { create } from 'zustand'
import { useProfileStore } from './profileStore'

/**
 * "간단히 / 자세히" 보기 — 긴 설명·근거·보조 표를 보일지 정한다.
 * 선택하지 않았으면 관리자는 자세히, 일반 사용자는 간단히로 시작한다.
 */
type Mode = 'simple' | 'detailed'

const STORAGE_KEY = 'view-mode:v1'

function readStored(): Mode | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return v === 'simple' || v === 'detailed' ? v : null
  } catch {
    return null
  }
}

type ViewModeState = {
  override: Mode | null
  setMode: (mode: Mode) => void
}

export const useViewModeStore = create<ViewModeState>((set) => ({
  override: readStored(),
  setMode: (mode) => {
    try { localStorage.setItem(STORAGE_KEY, mode) } catch { /* 저장 불가 환경은 이번 세션만 */ }
    set({ override: mode })
  },
}))

/** 지금 자세히 보기인가 */
export function useDetailed(): boolean {
  const override = useViewModeStore((s) => s.override)
  const isAdmin = useProfileStore((s) => s.isAdmin)
  return override ? override === 'detailed' : isAdmin
}
