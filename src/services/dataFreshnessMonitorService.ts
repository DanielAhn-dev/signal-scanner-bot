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
  /** 최신일 행 수 / 직전 거래일 행 수 (조회 실패·기준 표본 부족이면 null) */
  coverageRatio?: number | null
  latestCount?: number | null
  prevCount?: number | null
  /** 날짜는 최신인데 행 수가 급감한 경우(배치가 일부만 적재된 상태) */
  isLowCoverage?: boolean
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
  { key: 'indicators',  label: '기술지표',                 table: 'daily_indicators',    dateColumn: 'trade_date', maxBizDays: 1 },
  { key: 'investor',    label: '수급(기관/외국인)',          table: 'investor_daily',      dateColumn: 'date',    maxBizDays: 1 },
  { key: 'credit',      label: '신용/공매도',               table: 'stock_credit_short_daily', dateColumn: 'date', maxBizDays: 2 },
  { key: 'scores',      label: '종목 점수',                 table: 'scores',              dateColumn: 'asof',    maxBizDays: 1 },
]

/**
 * 부분 적재여도 신규 매수를 막지 않는 항목. 신용/공매도는 종목 상세 화면 표시용이고 점수·매매 판단에 쓰이지 않는데,
 * KRX 차단(2026-10-02)으로 일부만 적재되자 가상 자동매매 신규 매수까지 막힐 뻔했다. 알림·감시는 계속 한다.
 */
const NON_GATING_KEYS = new Set(['credit'])

/** 매수 품질 게이트에 반영할 부분 적재 항목 이름 (순수 함수) */
export function selectGatingPartialLabels(items: FreshnessItem[]): string[] {
  return items.filter((i) => i.isLowCoverage && !NON_GATING_KEYS.has(i.key)).map((i) => i.label)
}

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

  if (error) {
    console.error(`[dataFreshnessMonitor] ${table}.${column} 조회 실패:`, error.message)
    return null
  }
  if (!data) return null
  const row = (data as unknown) as Record<string, unknown>
  const value = row[column]
  if (!value) return null
  // ISO 날짜 문자열에서 YYYY-MM-DD 추출
  return String(value).slice(0, 10)
}

/** 최신일 행 수가 직전 거래일 대비 이 비율 미만이면 부분 적재로 본다 */
const MIN_COVERAGE_RATIO = 0.85
/** 직전 거래일 행 수가 이보다 적으면 비교가 무의미해 판정하지 않는다 */
const MIN_BASELINE_ROWS = 50

function nextDay(ymd: string): string {
  return new Date(Date.parse(`${ymd}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10)
}

async function countRowsOnDate(
  supabase: SupabaseClient,
  table: string,
  column: string,
  ymd: string
): Promise<number | null> {
  const { count, error } = await supabase
    .from(table)
    .select(column, { count: 'exact', head: true })
    .gte(column, ymd)
    .lt(column, nextDay(ymd))
  if (error) return null
  return count ?? null
}

export type CoverageResult = {
  latestCount: number | null
  prevCount: number | null
  coverageRatio: number | null
  isLowCoverage: boolean
}

/** 순수 판정 — 행 수 두 개로 부분 적재 여부를 결정한다 */
export function evaluateCoverage(latestCount: number | null, prevCount: number | null): CoverageResult {
  if (latestCount == null || prevCount == null || prevCount < MIN_BASELINE_ROWS) {
    return { latestCount, prevCount, coverageRatio: null, isLowCoverage: false }
  }
  const coverageRatio = latestCount / prevCount
  return { latestCount, prevCount, coverageRatio, isLowCoverage: coverageRatio < MIN_COVERAGE_RATIO }
}

async function checkCoverage(
  supabase: SupabaseClient,
  table: string,
  column: string,
  latestDate: string
): Promise<CoverageResult> {
  const { data } = await supabase
    .from(table)
    .select(column)
    .lt(column, latestDate)
    .order(column, { ascending: false })
    .limit(1)
    .maybeSingle()
  const prevRaw = data ? (data as unknown as Record<string, unknown>)[column] : null
  const prevDate = prevRaw ? String(prevRaw).slice(0, 10) : null
  if (!prevDate) return evaluateCoverage(null, null)
  const [latestCount, prevCount] = await Promise.all([
    countRowsOnDate(supabase, table, column, latestDate),
    countRowsOnDate(supabase, table, column, prevDate),
  ])
  return evaluateCoverage(latestCount, prevCount)
}

export async function checkDataFreshness(supabase: SupabaseClient): Promise<FreshnessReport> {
  const results = await Promise.all(
    WATCHED_TABLES.map(async (cfg) => {
      const latestDate = await fetchLatestDate(supabase, cfg.table, cfg.dateColumn).catch(() => null)
      const staleBizDays = businessDaysBehind(latestDate)
      const dateStale = isBusinessStale(latestDate, cfg.maxBizDays)
      const coverage = latestDate
        ? await checkCoverage(supabase, cfg.table, cfg.dateColumn, latestDate).catch(() => evaluateCoverage(null, null))
        : evaluateCoverage(null, null)
      const isStale = dateStale || coverage.isLowCoverage
      return {
        ...coverage,
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

let partialLoadCache: { at: number; labels: string[] } | null = null
const PARTIAL_LOAD_CACHE_MS = 10 * 60 * 1000

/**
 * 최신일 행 수가 급감한(부분 적재) 핵심 테이블 이름. 사용자마다 호출되므로 10분간 캐시한다.
 * 조회 실패는 차단 사유로 쓰지 않는다(빈 배열) — 감시 장애가 매매 중단으로 번지지 않게 한다.
 */
export async function getPartialLoadLabels(supabase: SupabaseClient, nowMs = Date.now()): Promise<string[]> {
  if (partialLoadCache && nowMs - partialLoadCache.at < PARTIAL_LOAD_CACHE_MS) return partialLoadCache.labels
  const report = await checkDataFreshness(supabase).catch(() => null)
  const labels = report ? selectGatingPartialLabels(report.staleItems) : []
  partialLoadCache = { at: nowMs, labels }
  return labels
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
    if (item.isLowCoverage && item.latestCount != null && item.prevCount != null) {
      lines.push(`  ↳ 부분 적재 의심: 최신일 ${item.latestCount}행 / 직전 거래일 ${item.prevCount}행`)
    }
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
