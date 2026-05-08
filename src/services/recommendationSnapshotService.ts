import type { SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'

export type RecommendationSnapshotInput = {
  recommendationDate: string
  actionCode: string
  code: string
  stockName?: string | null
  reason?: string | null
  entryScore?: number | null
  recommendationSignal?: string | null
  snapshotMetadata?: Record<string, any>
}

export async function saveRecommendationSnapshot(
  supabase: SupabaseClient,
  input: RecommendationSnapshotInput
): Promise<string> {
  const id = randomUUID()
  const now = new Date().toISOString()

  const { error } = await supabase.from('recommendation_snapshots').insert({
    id,
    recommendation_date: input.recommendationDate,
    action_code: input.actionCode,
    code: input.code,
    stock_name: input.stockName ?? null,
    reason: input.reason ?? null,
    entry_score: input.entryScore ?? null,
    recommendation_signal: input.recommendationSignal ?? null,
    snapshot_metadata: input.snapshotMetadata ?? {},
    evaluated_count: 0,
    created_at: now,
    updated_at: now,
  })

  if (error) throw new Error(`스냅샷 저장 실패: ${error.message}`)

  return id
}

export async function batchSaveRecommendationSnapshots(
  supabase: SupabaseClient,
  inputs: RecommendationSnapshotInput[]
): Promise<string[]> {
  if (inputs.length === 0) return []

  const now = new Date().toISOString()
  const rows = inputs.map((input) => ({
    id: randomUUID(),
    recommendation_date: input.recommendationDate,
    action_code: input.actionCode,
    code: input.code,
    stock_name: input.stockName ?? null,
    reason: input.reason ?? null,
    entry_score: input.entryScore ?? null,
    recommendation_signal: input.recommendationSignal ?? null,
    snapshot_metadata: input.snapshotMetadata ?? {},
    evaluated_count: 0,
    created_at: now,
    updated_at: now,
  }))

  const { data, error } = await supabase.from('recommendation_snapshots').insert(rows).select('id')

  if (error) throw new Error(`배치 스냅샷 저장 실패: ${error.message}`)

  return (data ?? []).map((row) => String((row as { id?: string }).id || ''))
}

export type PerformanceUpdateInput = {
  snapshotId: string
  forwardReturnDays: 1 | 3 | 5 | 10
  returnPct: number
}

export async function updateRecommendationPerformance(
  supabase: SupabaseClient,
  input: PerformanceUpdateInput
): Promise<void> {
  const columnMap: Record<number, string> = {
    1: 'forward_return_1d',
    3: 'forward_return_3d',
    5: 'forward_return_5d',
    10: 'forward_return_10d',
  }

  const column = columnMap[input.forwardReturnDays]
  if (!column) throw new Error(`Invalid forward return days: ${input.forwardReturnDays}`)

  const { error } = await supabase
    .from('recommendation_snapshots')
    .update({
      [column]: Number.isFinite(input.returnPct) ? Math.round(input.returnPct * 100) / 100 : null,
      evaluated_count: supabase.rpc('increment_evaluated_count'),
      updated_at: new Date().toISOString(),
    })
    .eq('id', input.snapshotId)

  if (error) throw new Error(`성과 업데이트 실패: ${error.message}`)
}

export async function getSnapshotsPendingEvaluation(
  supabase: SupabaseClient,
  horizonDays: number,
  limit = 100
): Promise<
  Array<{
    id: string
    code: string
    recommendationDate: string
    actionCode: string
  }>
> {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - horizonDays)
  const cutoffIso = cutoffDate.toISOString().split('T')[0]

  const columnMap: Record<number, string> = {
    1: 'forward_return_1d',
    3: 'forward_return_3d',
    5: 'forward_return_5d',
    10: 'forward_return_10d',
  }

  const column = columnMap[horizonDays]
  if (!column) throw new Error(`Invalid horizon days: ${horizonDays}`)

  const { data, error } = await supabase
    .from('recommendation_snapshots')
    .select('id,code,recommendation_date,action_code')
    .lt('recommendation_date', cutoffIso)
    .is(column, null)
    .order('recommendation_date', { ascending: true })
    .limit(limit)

  if (error) throw new Error(`스냅샷 조회 실패: ${error.message}`)

  return (data ?? []).map((row) => ({
    id: String((row as { id?: string }).id || ''),
    code: String((row as { code?: string }).code || ''),
    recommendationDate: String((row as { recommendation_date?: string }).recommendation_date || ''),
    actionCode: String((row as { action_code?: string }).action_code || ''),
  }))
}

export async function getRecommendationPerformanceStats(
  supabase: SupabaseClient,
  sinceDate?: string
): Promise<{
  totalSnapshots: number
  evaluatedCount: number
  avgForwardReturn1d: number
  avgForwardReturn3d: number
  avgForwardReturn5d: number
  avgForwardReturn10d: number
  hitRate1d: number
  hitRate3d: number
  hitRate5d: number
  hitRate10d: number
}> {
  const baseQuery = supabase
    .from('recommendation_snapshots')
    .select('forward_return_1d,forward_return_3d,forward_return_5d,forward_return_10d')

  const query = sinceDate ? baseQuery.gte('recommendation_date', sinceDate) : baseQuery

  const { data, error } = await query

  if (error) throw new Error(`성과 통계 조회 실패: ${error.message}`)

  const rows = (data ?? []) as Array<{
    forward_return_1d?: number | null
    forward_return_3d?: number | null
    forward_return_5d?: number | null
    forward_return_10d?: number | null
  }>

  const returns = {
    '1d': { sum: 0, count: 0, wins: 0 },
    '3d': { sum: 0, count: 0, wins: 0 },
    '5d': { sum: 0, count: 0, wins: 0 },
    '10d': { sum: 0, count: 0, wins: 0 },
  }

  for (const row of rows) {
    if (row.forward_return_1d != null) {
      returns['1d'].sum += row.forward_return_1d
      returns['1d'].count += 1
      if (row.forward_return_1d > 0) returns['1d'].wins += 1
    }
    if (row.forward_return_3d != null) {
      returns['3d'].sum += row.forward_return_3d
      returns['3d'].count += 1
      if (row.forward_return_3d > 0) returns['3d'].wins += 1
    }
    if (row.forward_return_5d != null) {
      returns['5d'].sum += row.forward_return_5d
      returns['5d'].count += 1
      if (row.forward_return_5d > 0) returns['5d'].wins += 1
    }
    if (row.forward_return_10d != null) {
      returns['10d'].sum += row.forward_return_10d
      returns['10d'].count += 1
      if (row.forward_return_10d > 0) returns['10d'].wins += 1
    }
  }

  return {
    totalSnapshots: rows.length,
    evaluatedCount: rows.filter(
      (row) =>
        row.forward_return_1d != null ||
        row.forward_return_3d != null ||
        row.forward_return_5d != null ||
        row.forward_return_10d != null
    ).length,
    avgForwardReturn1d: returns['1d'].count > 0 ? Math.round((returns['1d'].sum / returns['1d'].count) * 100) / 100 : 0,
    avgForwardReturn3d: returns['3d'].count > 0 ? Math.round((returns['3d'].sum / returns['3d'].count) * 100) / 100 : 0,
    avgForwardReturn5d: returns['5d'].count > 0 ? Math.round((returns['5d'].sum / returns['5d'].count) * 100) / 100 : 0,
    avgForwardReturn10d: returns['10d'].count > 0 ? Math.round((returns['10d'].sum / returns['10d'].count) * 100) / 100 : 0,
    hitRate1d: returns['1d'].count > 0 ? Math.round((returns['1d'].wins / returns['1d'].count) * 100) : 0,
    hitRate3d: returns['3d'].count > 0 ? Math.round((returns['3d'].wins / returns['3d'].count) * 100) : 0,
    hitRate5d: returns['5d'].count > 0 ? Math.round((returns['5d'].wins / returns['5d'].count) * 100) : 0,
    hitRate10d: returns['10d'].count > 0 ? Math.round((returns['10d'].wins / returns['10d'].count) * 100) : 0,
  }
}
