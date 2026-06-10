/**
 * 데이터 신선도 감시 서비스
 *
 * 핵심 배치 데이터(OHLCV, 지표, 수급, 신용)가 기대 주기보다
 * 오래됐으면 Telegram 경고 메시지를 생성하고 가상매매를 보수화한다.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { businessDaysBehind, isBusinessStale } from '../utils/dataFreshness'

export type FreshnessItem = {
  key: string
  label: string
  latestDate: string | null
  staleBizDays: number | null
  isStale: boolean
  maxBizDays: number
}

export type FreshnessReport = {
  isHealthy: boolean
  staleItems: FreshnessItem[]
  freshItems: FreshnessItem[]
  checkedAt: string
  telegramMessage: string | null
}

type TableConfig = {
  key: string
  label: string
  table: string
  dateColumn: string
  maxBizDays: number
}

const WATCHED_TABLES: TableConfig[] = [
  { key: 'ohlcv',       label: 'OHLCV (일별 시세)',       table: 'stock_daily',         dateColumn: 'date',    maxBizDays: 1 },
  { key: 'indicators',  label: '기술지표',                 table: 'daily_indicators',    dateColumn: 'date',    maxBizDays: 1 },
  { key: 'investor',    label: '수급(기관/외국인)',          table: 'investor_daily',      dateColumn: 'date',    maxBizDays: 1 },
  { key: 'credit',      label: '신용/공매도',               table: 'credit_short_daily',  dateColumn: 'date',    maxBizDays: 2 },
  { key: 'scores',      label: '종목 점수',                 table: 'scan_candidates',     dateColumn: 'created_at', maxBizDays: 1 },
]

async function fetchLatestDate(
  supabase: SupabaseClient,
  table: string,
  column: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from(table)
    .select(column)
    .order(column, { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return null
  const row = (data as unknown) as Record<string, unknown>
  const value = row[column]
  if (!value) return null
  // ISO 날짜 문자열에서 YYYY-MM-DD 추출
  return String(value).slice(0, 10)
}

export async function checkDataFreshness(supabase: SupabaseClient): Promise<FreshnessReport> {
  const results = await Promise.all(
    WATCHED_TABLES.map(async (cfg) => {
      const latestDate = await fetchLatestDate(supabase, cfg.table, cfg.dateColumn).catch(() => null)
      const staleBizDays = businessDaysBehind(latestDate)
      const isStale = isBusinessStale(latestDate, cfg.maxBizDays)
      return {
        key: cfg.key,
        label: cfg.label,
        latestDate,
        staleBizDays,
        isStale,
        maxBizDays: cfg.maxBizDays,
      } satisfies FreshnessItem
    })
  )

  const staleItems = results.filter((r) => r.isStale)
  const freshItems = results.filter((r) => !r.isStale)
  const isHealthy = staleItems.length === 0

  return {
    isHealthy,
    staleItems,
    freshItems,
    checkedAt: new Date().toISOString(),
    telegramMessage: buildFreshnessAlertMessage(staleItems),
  }
}

export function buildFreshnessAlertMessage(staleItems: FreshnessItem[]): string | null {
  if (staleItems.length === 0) return null

  const lines: string[] = []
  lines.push('⚡ <b>데이터 신선도 경고</b>')
  lines.push('다음 데이터가 기준일보다 오래됐습니다. 분석 신뢰도가 낮을 수 있습니다.\n')

  for (const item of staleItems) {
    const dayLabel =
      item.staleBizDays == null
        ? '기준일 확인불가'
        : `${item.staleBizDays}영업일 지연`
    const dateLabel = item.latestDate ?? '없음'
    lines.push(`• <b>${item.label}</b>: 최근 ${dateLabel} (${dayLabel}, 허용 ${item.maxBizDays}영업일)`)
  }

  lines.push('\n→ 일별 배치가 정상 실행됐는지 GitHub Actions 로그를 확인하세요.')
  return lines.join('\n')
}

/** ops 상태 요약용 한 줄 텍스트 */
export function buildFreshnessDigest(report: FreshnessReport): string {
  if (report.isHealthy) {
    return `데이터 신선도 ✅ 전체 정상 (${report.freshItems.length}개 테이블)`
  }
  const labels = report.staleItems.map((i) => i.label).join(', ')
  return `데이터 신선도 ❌ 지연: ${labels}`
}
