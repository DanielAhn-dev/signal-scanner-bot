import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { EconomicEventOutcome, EconomicEvent, EventImpactDirection } from '../types/economics'

const OUTCOME_TABLE = 'economic_event_outcomes'

let supabaseClient: SupabaseClient | null = null

function getOptionalSupabaseClient(): SupabaseClient | null {
  if (supabaseClient) return supabaseClient

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
  if (!url || !key) return null

  supabaseClient = createClient(url, key)
  return supabaseClient
}

function normalizeNumber(value: unknown): number | null {
  const num = Number(value)
  return Number.isFinite(num) ? num : null
}

function classifySurprise(surpriseValue: number | null): EventImpactDirection | undefined {
  if (surpriseValue == null || surpriseValue === 0) return 'neutral'
  return surpriseValue > 0 ? 'positive' : 'negative'
}

export function buildEconomicEventOutcome(event: EconomicEvent, outcome?: Partial<EconomicEventOutcome>): EconomicEventOutcome {
  const actualValue = normalizeNumber(outcome?.actualValue)
  const forecastValue = normalizeNumber(outcome?.forecastValue ?? event.forecastValue)
  const surpriseValue = actualValue != null && forecastValue != null ? Number((actualValue - forecastValue).toFixed(4)) : null

  return {
    eventId: event.id,
    eventName: event.name,
    country: event.country,
    category: event.category,
    importance: event.importance,
    scheduledAt: event.scheduledAt,
    publishedAt: outcome?.publishedAt,
    forecastValue: forecastValue ?? undefined,
    actualValue: actualValue ?? undefined,
    previousValue: normalizeNumber(outcome?.previousValue ?? event.previousValue) ?? undefined,
    surpriseValue: surpriseValue ?? undefined,
    surpriseDirection: classifySurprise(surpriseValue) ?? undefined,
    kospiReturn1d: normalizeNumber(outcome?.kospiReturn1d) ?? undefined,
    kospiReturn3d: normalizeNumber(outcome?.kospiReturn3d) ?? undefined,
    kospiReturn5d: normalizeNumber(outcome?.kospiReturn5d) ?? undefined,
    kospiReturn10d: normalizeNumber(outcome?.kospiReturn10d) ?? undefined,
    kosdaqReturn1d: normalizeNumber(outcome?.kosdaqReturn1d) ?? undefined,
    kosdaqReturn3d: normalizeNumber(outcome?.kosdaqReturn3d) ?? undefined,
    kosdaqReturn5d: normalizeNumber(outcome?.kosdaqReturn5d) ?? undefined,
    kosdaqReturn10d: normalizeNumber(outcome?.kosdaqReturn10d) ?? undefined,
    volatilityChange: normalizeNumber(outcome?.volatilityChange) ?? undefined,
    keyDriver: outcome?.keyDriver ?? undefined,
    marketTheme: outcome?.marketTheme ?? undefined,
    confidenceScore: normalizeNumber(outcome?.confidenceScore) ?? undefined,
    reasonSummary: outcome?.reasonSummary ?? undefined,
    reasonDetails: outcome?.reasonDetails ?? {},
    createdAt: outcome?.createdAt,
    updatedAt: outcome?.updatedAt,
  }
}

export async function upsertEconomicEventOutcome(
  outcome: EconomicEventOutcome
): Promise<{ ok: boolean; error?: string }> {
  const supabase = getOptionalSupabaseClient()
  if (!supabase) return { ok: false, error: 'SUPABASE_NOT_CONFIGURED' }

  const now = new Date().toISOString()
  const payload = {
    event_id: outcome.eventId,
    event_name: outcome.eventName,
    country: outcome.country,
    category: outcome.category,
    importance: outcome.importance,
    scheduled_at: outcome.scheduledAt,
    published_at: outcome.publishedAt ?? null,
    forecast_value: outcome.forecastValue ?? null,
    actual_value: outcome.actualValue ?? null,
    previous_value: outcome.previousValue ?? null,
    surprise_value: outcome.surpriseValue ?? null,
    surprise_direction: outcome.surpriseDirection ?? null,
    kospi_return_1d: outcome.kospiReturn1d ?? null,
    kospi_return_3d: outcome.kospiReturn3d ?? null,
    kospi_return_5d: outcome.kospiReturn5d ?? null,
    kospi_return_10d: outcome.kospiReturn10d ?? null,
    kosdaq_return_1d: outcome.kosdaqReturn1d ?? null,
    kosdaq_return_3d: outcome.kosdaqReturn3d ?? null,
    kosdaq_return_5d: outcome.kosdaqReturn5d ?? null,
    kosdaq_return_10d: outcome.kosdaqReturn10d ?? null,
    volatility_change: outcome.volatilityChange ?? null,
    key_driver: outcome.keyDriver ?? null,
    market_theme: outcome.marketTheme ?? null,
    confidence_score: outcome.confidenceScore ?? null,
    reason_summary: outcome.reasonSummary ?? null,
    reason_details: outcome.reasonDetails ?? {},
    updated_at: now,
    created_at: outcome.createdAt ?? now,
  }

  const { error } = await supabase.from(OUTCOME_TABLE).upsert(payload, { onConflict: 'event_id' })
  if (error) {
    return { ok: false, error: error.message }
  }

  return { ok: true }
}

export async function saveEconomicEventOutcomeFromEvent(
  event: EconomicEvent,
  outcome?: Partial<EconomicEventOutcome>
): Promise<{ ok: boolean; error?: string }> {
  return upsertEconomicEventOutcome(buildEconomicEventOutcome(event, outcome))
}
