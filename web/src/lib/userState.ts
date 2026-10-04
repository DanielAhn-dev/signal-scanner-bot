import { useCallback, useEffect, useRef, useState } from 'react'
import { apiFetch } from './api'
import { getCurrentClientIdFromStore, useCurrentClientId } from '../stores/profileStore'

/**
 * 사용자별 화면 설정 저장소 — 같은 브라우저에서 계정을 바꿔도 값이 섞이지 않게 키에 사용자 ID를 붙이고,
 * 서버(/api/ui/user-state)에도 저장해 기기를 바꿔도 따라오게 한다. 로컬은 즉시 읽기용 캐시다.
 * 서버가 받는 이름은 handlers/ui/user-state.ts의 USER_STATE_KEYS와 같아야 한다.
 */
export type UserStateName = 'holdingRules' | 'assetOverview' | 'tradeCost' | 'buycheck' | 'accumulate' | 'investorProfile' | 'switchHistory' | 'dropPlan' | 'childGifts' | 'accountGoals'

const SCOPED_PREFIX = 'u:'
/** 사용자 ID 없이 쓰던 예전 키 — 처음 읽을 때 현재 사용자 것으로 옮기고 지운다 */
const LEGACY_KEYS: Record<UserStateName, string> = {
  holdingRules: 'portfolio.holdingRules.v1',
  assetOverview: 'portfolio.assetOverview.v1',
  tradeCost: 'portfolio.tradeCost.v1',
  buycheck: 'scan_buycheck_settings_v1',
  accumulate: 'accumulate_v1',
  investorProfile: 'investor_profile_v1',
  switchHistory: 'switch_history_v1',
  dropPlan: 'drop_plan_v1',
  childGifts: 'child_gifts_v1',
  accountGoals: 'account_goals_v1',
}
/** 로그아웃 때 함께 지우는 사용자 데이터 키 (사용자 ID가 안 붙은 것) */
const SIGN_OUT_LOCAL_KEYS = [
  ...Object.values(LEGACY_KEYS),
  'start-wizard:v1',
  'highlight_simulation_plan_v1',
  'analyze.recentSearches',
  'fcm_push_enabled',
  'fcm_push_optout',
]
const SIGN_OUT_SESSION_KEYS = ['execution_guide_pending_v1', 'analyze_pending_code', 'backtest_pending_code', 'scan_snapshot_v1', 'scan_signal_history_v1']
const PULLED_EVENT = 'user-state-pulled'
const SAVE_DELAY_MS = 800

type Entry = { value: unknown; updatedAt: number }

/** 사용자 ID가 붙은 로컬 키 — 로그인 전(ID 없음)에는 null이라 저장하지 않는다 */
export function userScopedKey(base: string): string | null {
  const id = getCurrentClientIdFromStore()
  return id ? `${SCOPED_PREFIX}${id}:${base}` : null
}

function readEntry(name: UserStateName): Entry | null {
  const key = userScopedKey(`state:${name}`)
  if (!key) return null
  try {
    const raw = localStorage.getItem(key)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && 'value' in parsed) return { value: parsed.value, updatedAt: Number(parsed.updatedAt) || 0 }
    }
    const legacyRaw = localStorage.getItem(LEGACY_KEYS[name])
    if (legacyRaw) {
      const entry: Entry = { value: JSON.parse(legacyRaw), updatedAt: 1 }
      localStorage.setItem(key, JSON.stringify(entry))
      localStorage.removeItem(LEGACY_KEYS[name])
      return entry
    }
  } catch { /* 저장소를 못 쓰는 환경은 서버 값만 쓴다 */ }
  return null
}

function writeEntry(name: UserStateName, entry: Entry) {
  const key = userScopedKey(`state:${name}`)
  if (!key) return
  try { localStorage.setItem(key, JSON.stringify(entry)) } catch { /* 이번 세션만 */ }
}

export function readUserState<T>(name: UserStateName): T | null {
  return (readEntry(name)?.value as T | undefined) ?? null
}

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** 서버 저장에 실패한 값 — 다음 조회 때 서버 값으로 덮지 않고 다시 올린다 */
const unsaved = new Set<string>()

async function pushToServer(name: UserStateName, value: unknown) {
  const id = `${getCurrentClientIdFromStore()}:${name}`
  try {
    await apiFetch('/api/ui/user-state', { method: 'POST', body: JSON.stringify({ key: name, value }), cacheMs: 0, retries: 0, timeoutMs: 10_000 })
    unsaved.delete(id)
  } catch { unsaved.add(id) }
}

export function writeUserState(name: UserStateName, value: unknown) {
  const clientId = getCurrentClientIdFromStore()
  if (!clientId) return
  writeEntry(name, { value, updatedAt: Date.now() })
  const timerKey = `${clientId}:${name}`
  const pending = saveTimers.get(timerKey)
  if (pending) clearTimeout(pending)
  saveTimers.set(timerKey, setTimeout(() => { saveTimers.delete(timerKey); void pushToServer(name, value) }, SAVE_DELAY_MS))
}

/** 로그인 직후 한 번 — 서버 값이 더 새로우면 로컬을 덮고, 서버에 없는 로컬 값(예전 기기 설정)은 올린다 */
const pulls = new Map<string, Promise<void>>()

export function pullUserState(): Promise<void> {
  const clientId = getCurrentClientIdFromStore()
  if (!clientId) return Promise.resolve()
  // 화면마다 훅이 따로 불러도 서버 조회는 사용자당 한 번만 — 끝나면 다음 호출은 다시 조회한다
  const inflight = pulls.get(clientId)
  if (inflight) return inflight
  const run = doPull(clientId).finally(() => { pulls.delete(clientId) })
  pulls.set(clientId, run)
  return run
}

async function doPull(clientId: string): Promise<void> {
  try {
    const res = await apiFetch('/api/ui/user-state', { cacheMs: 0, retries: 1, timeoutMs: 10_000 })
    const server = (res?.data || {}) as Record<string, Entry>
    let changed = false
    for (const name of Object.keys(LEGACY_KEYS) as UserStateName[]) {
      const local = readEntry(name)
      const remote = server[name]
      const id = `${clientId}:${name}`
      // 저장 대기 중이거나 저장에 실패한 값은 이 기기가 더 새로운 것 — 서버 값으로 덮지 않고 다시 올린다
      if (local && (saveTimers.has(id) || unsaved.has(id))) {
        if (!saveTimers.has(id)) void pushToServer(name, local.value)
        continue
      }
      if (remote && (!local || Number(remote.updatedAt) > local.updatedAt)) {
        writeEntry(name, { value: remote.value, updatedAt: Number(remote.updatedAt) || 0 })
        changed = true
      } else if (local && !remote) {
        void pushToServer(name, local.value)
      }
    }
    if (changed && getCurrentClientIdFromStore() === clientId) window.dispatchEvent(new Event(PULLED_EVENT))
  } catch { /* 서버를 못 읽으면 로컬 값으로 계속 쓴다 */ }
}

/** 로그아웃 — 이 브라우저에 남은 사용자 데이터를 전부 지워 다음 사람에게 보이지 않게 한다 */
export function clearUserLocalData() {
  for (const t of saveTimers.values()) clearTimeout(t)
  saveTimers.clear()
  unsaved.clear()
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(SCOPED_PREFIX)) localStorage.removeItem(key)
    }
    for (const key of SIGN_OUT_LOCAL_KEYS) localStorage.removeItem(key)
  } catch { /* 무시 */ }
  try { for (const key of SIGN_OUT_SESSION_KEYS) sessionStorage.removeItem(key) } catch { /* 무시 */ }
}

/** 저장값을 읽고 쓰는 훅 — 서버에서 새 값이 내려오면 자동으로 다시 읽는다. ready는 첫 로드가 끝났다는 뜻 */
export function useUserState<T>(name: UserStateName): { value: T | null; set: (next: T) => void; ready: boolean } {
  const clientId = useCurrentClientId()
  const [value, setValue] = useState<T | null>(() => readUserState<T>(name))
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!clientId) { setValue(null); setReady(false); return }
    setValue(readUserState<T>(name))
    let cancelled = false
    const reload = () => { if (!cancelled) setValue(readUserState<T>(name)) }
    window.addEventListener(PULLED_EVENT, reload)
    void pullUserState().finally(() => { if (!cancelled) { reload(); setReady(true) } })
    return () => { cancelled = true; window.removeEventListener(PULLED_EVENT, reload) }
  }, [clientId, name])

  const set = useCallback((next: T) => { setValue(next); writeUserState(name, next) }, [name])
  return { value, set, ready }
}

/**
 * 화면의 여러 useState 값을 한 묶음으로 저장·복원하는 연결 훅.
 * 저장값이 로드되면 apply로 화면 상태에 반영하고(없으면 기본값), 그 뒤 바뀐 값만 저장한다.
 * 로드 전의 기본값이 서버의 실제 값을 덮어쓰지 않도록 반영이 끝난 다음 커밋부터 저장을 시작한다.
 */
export function useSyncedSettings<T extends object>(name: UserStateName, current: T, defaults: T, apply: (saved: Partial<T>) => void) {
  const clientId = useCurrentClientId()
  const { value, set, ready } = useUserState<T>(name)
  const [hydrated, setHydrated] = useState(false)
  const applyRef = useRef(apply)
  applyRef.current = apply
  const currentJson = JSON.stringify(current)
  const valueJson = JSON.stringify(value)

  useEffect(() => { setHydrated(false) }, [clientId])
  useEffect(() => {
    if (!clientId) return
    if (value) { applyRef.current(value); setHydrated(true) }
    else if (ready) { applyRef.current(defaults); setHydrated(true) }
    // defaults는 상수로 넘기므로 의존성에서 뺀다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, valueJson, ready])
  useEffect(() => {
    if (!hydrated || currentJson === valueJson) return
    set(current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, currentJson])
}

const REFRESH_MIN_GAP_MS = 30_000

/** 로그인 직후 서버 값을 미리 받아 두고, 다른 기기에서 쓰다 이 탭으로 돌아오면 다시 받아 온다 (App에서 한 번 호출) */
export function useUserStateAutoSync(enabled: boolean) {
  const clientId = useCurrentClientId()
  useEffect(() => {
    if (!enabled || !clientId) return
    let last = Date.now()
    void pullUserState()
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < REFRESH_MIN_GAP_MS) return
      last = Date.now()
      void pullUserState()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [enabled, clientId])
}
