import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { EconomicCalendarResponse } from '../types/economics'

const SNAPSHOT_TABLE = 'economic_calendar_snapshots'

let supabaseClient: SupabaseClient | null = null

function getOptionalSupabaseClient(): SupabaseClient | null {
  if (supabaseClient) return supabaseClient

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
  if (!url || !key) return null

  supabaseClient = createClient(url, key)
  return supabaseClient
}

function cloneResponse(response: EconomicCalendarResponse): EconomicCalendarResponse {
  return {
    ...response,
    events: [...response.events],
    timeRange: { ...response.timeRange },
    nextHighRiskEvent: response.nextHighRiskEvent ? { ...response.nextHighRiskEvent } : undefined,
  }
}

export function buildEconomicCalendarSnapshotKey(queryType: string, queryValue: string): string {
  const safeQueryType = String(queryType || 'calendar').trim() || 'calendar'
  const safeQueryValue = String(queryValue || 'all').trim() || 'all'
  return `economic-calendar:${safeQueryType}:${safeQueryValue}`
}

export async function readEconomicCalendarSnapshot(
  snapshotKey: string,
  options?: { allowStale?: boolean }
): Promise<EconomicCalendarResponse | null> {
  const supabase = getOptionalSupabaseClient()
  if (!supabase) return null

  const { data, error } = await supabase
    .from(SNAPSHOT_TABLE)
    .select('response_payload, expires_at, fetched_at')
    .eq('snapshot_key', snapshotKey)
    .maybeSingle()

  if (error || !data?.response_payload) return null

  const expiresAt = data.expires_at ? new Date(String(data.expires_at)).getTime() : null
  if (!options?.allowStale && expiresAt != null && Number.isFinite(expiresAt) && Date.now() > expiresAt) {
    return null
  }

  return cloneResponse(data.response_payload as EconomicCalendarResponse)
}

export async function saveEconomicCalendarSnapshot(
  snapshotKey: string,
  response: EconomicCalendarResponse,
  options?: {
    sourceLabel?: string | null
    ttlMs?: number | null
    queryType?: string | null
    queryPayload?: Record<string, unknown> | null
  }
): Promise<void> {
  const supabase = getOptionalSupabaseClient()
  if (!supabase) return

  const ttlMs = typeof options?.ttlMs === 'number' && options.ttlMs > 0 ? options.ttlMs : 6 * 60 * 60 * 1000
  const now = new Date().toISOString()
  const expiresAt = new Date(Date.now() + ttlMs).toISOString()

  const { error } = await supabase.from(SNAPSHOT_TABLE).upsert(
    {
      snapshot_key: snapshotKey,
      query_type: options?.queryType ?? 'calendar',
      query_payload: options?.queryPayload ?? {},
      response_payload: cloneResponse(response),
      source_label: options?.sourceLabel ?? null,
      fetched_at: now,
      expires_at: expiresAt,
      updated_at: now,
    },
    { onConflict: 'snapshot_key' }
  )

  if (error) {
    console.error('[economic-calendar] snapshot save failed:', error)
  }
}
