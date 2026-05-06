import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

type SyncStatus = 'running' | 'success' | 'failed'

export type SyncHistoryItem = {
  id: string
  kind: string
  status: SyncStatus
  progress: number
  stage: string
  detail: string
  startedAt: string
  updatedAt: string
  finishedAt?: string
}

type SyncStore = {
  active: Record<string, SyncHistoryItem>
  history: SyncHistoryItem[]
}

const STORE_PATH = path.join('/tmp', 'ui-sync-store.json')

const EMPTY_STORE: SyncStore = {
  active: {},
  history: [],
}

async function readStore(): Promise<SyncStore> {
  try {
    const raw = await readFile(STORE_PATH, 'utf8')
    const parsed = JSON.parse(raw)
    return {
      active: parsed?.active ?? {},
      history: Array.isArray(parsed?.history) ? parsed.history : [],
    }
  } catch {
    return { ...EMPTY_STORE }
  }
}

async function writeStore(store: SyncStore): Promise<void> {
  await mkdir(path.dirname(STORE_PATH), { recursive: true })
  await writeFile(STORE_PATH, JSON.stringify(store), 'utf8')
}

function nowIso(): string {
  return new Date().toISOString()
}

function clampProgress(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(100, Math.round(v)))
}

export async function startSyncJob(input: {
  id: string
  kind: string
  stage: string
  progress: number
  detail?: string
}): Promise<void> {
  const store = await readStore()
  const now = nowIso()
  store.active[input.id] = {
    id: input.id,
    kind: input.kind,
    status: 'running',
    progress: clampProgress(input.progress),
    stage: input.stage,
    detail: input.detail || '',
    startedAt: now,
    updatedAt: now,
  }
  await writeStore(store)
}

export async function updateSyncJob(input: {
  id: string
  stage?: string
  progress?: number
  detail?: string
}): Promise<void> {
  const store = await readStore()
  const current = store.active[input.id]
  if (!current) return
  current.updatedAt = nowIso()
  if (typeof input.stage === 'string') current.stage = input.stage
  if (typeof input.detail === 'string') current.detail = input.detail
  if (typeof input.progress === 'number') current.progress = clampProgress(input.progress)
  await writeStore(store)
}

export async function finishSyncJob(input: {
  id: string
  status: Exclude<SyncStatus, 'running'>
  stage: string
  progress?: number
  detail?: string
}): Promise<void> {
  const store = await readStore()
  const current = store.active[input.id]
  if (!current) return

  const now = nowIso()
  const done: SyncHistoryItem = {
    ...current,
    status: input.status,
    stage: input.stage,
    progress: clampProgress(typeof input.progress === 'number' ? input.progress : input.status === 'success' ? 100 : current.progress),
    detail: typeof input.detail === 'string' ? input.detail : current.detail,
    updatedAt: now,
    finishedAt: now,
  }

  delete store.active[input.id]
  store.history = [done, ...store.history.filter((item) => item.id !== done.id)].slice(0, 30)

  await writeStore(store)
}

export async function getSyncJob(id: string): Promise<SyncHistoryItem | null> {
  const store = await readStore()
  return store.active[id] || store.history.find((item) => item.id === id) || null
}

export async function getRecentSyncHistory(limit = 10): Promise<SyncHistoryItem[]> {
  const store = await readStore()
  const activeList = Object.values(store.active).sort((a, b) => {
    return b.updatedAt.localeCompare(a.updatedAt)
  })
  const merged = [...activeList, ...store.history]
  return merged.slice(0, Math.max(1, Math.min(30, limit)))
}
