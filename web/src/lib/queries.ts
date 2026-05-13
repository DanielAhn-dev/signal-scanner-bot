/**
 * TanStack Query 훅 모음
 * apiFetch를 queryFn으로 래핑해 캐싱/재시도/백그라운드 갱신 처리
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from './api'
import { useProfileStore } from '../stores/profileStore'
import type {
  DashboardSummary,
  SectorItem,
  ScanCandidate,
  PositionRow,
  TradeRow,
  AnalyzeResult,
  OhlcvCandle,
  FlowData,
  MaintenanceResult,
} from './types'

// ── 쿼리 키 상수 ─────────────────────────────────────────
export const QUERY_KEYS = {
  summary: ['summary'] as const,
  sectors: (top = 8) => ['sectors', top] as const,
  scanCandidates: (params?: Record<string, string>) => ['scan-candidates', params] as const,
  positions: (chatId = '') => ['positions', chatId] as const,
  trades: (page = 1, chatId = '') => ['trades', page, chatId] as const,
  analyze: (code: string) => ['analyze', code] as const,
  ohlcv: (code: string) => ['ohlcv', code] as const,
  flow: (code: string) => ['flow', code] as const,
}

// ── 대시보드 ─────────────────────────────────────────────
export function useDashboardSummary(opts?: { enabled?: boolean }) {
  return useQuery<DashboardSummary>({
    queryKey: QUERY_KEYS.summary,
    queryFn: () => apiFetch('/api/ui/summary', { cacheMs: 0, timeoutMs: 15_000, retries: 1 }),
    staleTime: 30_000,
    enabled: opts?.enabled ?? true,
  })
}

export function useSectors(top = 8) {
  return useQuery<SectorItem[]>({
    queryKey: QUERY_KEYS.sectors(top),
    queryFn: () => apiFetch(`/api/ui/sectors?top=${top}`, { cacheMs: 0, timeoutMs: 12_000, retries: 1 }),
    staleTime: 120_000,
  })
}

// ── 스캔 ─────────────────────────────────────────────────
export function useScanCandidates(params?: Record<string, string>) {
  const qs = params ? `?${new URLSearchParams(params)}` : ''
  return useQuery<{ candidates: ScanCandidate[]; total: number; latestDate: string | null }>({
    queryKey: QUERY_KEYS.scanCandidates(params),
    queryFn: () => apiFetch(`/api/ui/scan-candidates${qs}`, { cacheMs: 0, timeoutMs: 25_000, retries: 1 }),
    staleTime: 60_000,
  })
}

// ── 포트폴리오 ───────────────────────────────────────────
export function usePositions() {
  const chatId = useProfileStore((state) => state.profile.telegramId || '')
  return useQuery<PositionRow[]>({
    queryKey: QUERY_KEYS.positions(chatId),
    queryFn: () => apiFetch('/api/ui/positions', { cacheMs: 0, timeoutMs: 15_000, retries: 1 }),
    staleTime: 30_000,
    enabled: !!chatId,
  })
}

export function useTrades(page = 1) {
  const chatId = useProfileStore((state) => state.profile.telegramId || '')
  return useQuery<{ rows: TradeRow[]; total: number }>({
    queryKey: QUERY_KEYS.trades(page, chatId),
    queryFn: () => apiFetch(`/api/ui/decisions?page=${page}`, { cacheMs: 0, timeoutMs: 12_000, retries: 1 }),
    staleTime: 60_000,
    enabled: !!chatId,
  })
}

// ── 종목 분석 ─────────────────────────────────────────────
export function useAnalyze(code: string, opts?: { enabled?: boolean }) {
  return useQuery<AnalyzeResult>({
    queryKey: QUERY_KEYS.analyze(code),
    queryFn: () => apiFetch(`/api/ui/format-stock?code=${encodeURIComponent(code)}`, { cacheMs: 0, timeoutMs: 20_000 }),
    enabled: (opts?.enabled ?? true) && !!code,
    staleTime: 60_000,
  })
}

export function useOhlcv(code: string, opts?: { enabled?: boolean }) {
  return useQuery<OhlcvCandle[]>({
    queryKey: QUERY_KEYS.ohlcv(code),
    queryFn: () => apiFetch(`/api/ui/stock-latest?code=${encodeURIComponent(code)}&series=true`, { cacheMs: 0, timeoutMs: 15_000 }),
    enabled: (opts?.enabled ?? true) && !!code,
    staleTime: 120_000,
  })
}

export function useFlow(code: string, opts?: { enabled?: boolean }) {
  return useQuery<FlowData>({
    queryKey: QUERY_KEYS.flow(code),
    queryFn: () => apiFetch(`/api/ui/stock-latest?code=${encodeURIComponent(code)}&flow=true`, { cacheMs: 0, timeoutMs: 12_000 }),
    enabled: (opts?.enabled ?? true) && !!code,
    staleTime: 120_000,
  })
}

// ── 포지션 유지보수 뮤테이션 ──────────────────────────────
export function useMaintenanceMutation() {
  const qc = useQueryClient()
  const chatId = useProfileStore((state) => state.profile.telegramId || '')
  return useMutation<MaintenanceResult, Error, Record<string, unknown>>({
    mutationFn: (body) => {
      return apiFetch('/api/ui/positions-maintenance', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(chatId ? { 'x-user-chat-id': chatId } : {}),
        },
        body: JSON.stringify(body),
        cacheMs: 0,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: QUERY_KEYS.positions(chatId) })
    },
  })
}
