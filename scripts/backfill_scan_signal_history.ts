import 'dotenv/config'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

type PullbackRow = {
  trade_date: string
  code: string
  entry_grade: string | null
  entry_score: number | null
  trend_grade: string | null
  warn_grade: string | null
  warn_score: number | null
  stock: { code: string; liquidity: number | null } | Array<{ code: string; liquidity: number | null }> | null
}

type IndicatorRow = {
  code: string
  value_traded: number | null
}

type UpsertRow = {
  code: string
  trade_date: string
  is_quick_strict: boolean
  is_quick_lite: boolean
  quick_score: number
}

type Args = {
  from?: string
  to?: string
  days: number
  limitDates: number
  dryRun: boolean
}

function parseArg(name: string): string | undefined {
  const hit = process.argv.find((x) => x.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}

function parseIntArg(name: string, fallback: number): number {
  const raw = Number(parseArg(name))
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback
}

function parseBoolArg(name: string, fallback: boolean): boolean {
  const raw = parseArg(name)
  if (!raw) return fallback
  const s = raw.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(s)) return true
  if (['0', 'false', 'no', 'off'].includes(s)) return false
  return fallback
}

function toDateText(daysBack: number): string {
  const d = new Date(Date.now() - daysBack * 86_400_000)
  return d.toISOString().slice(0, 10)
}

function parseArgs(): Args {
  return {
    from: parseArg('from'),
    to: parseArg('to'),
    days: parseIntArg('days', 240),
    limitDates: parseIntArg('limitDates', 365),
    dryRun: parseBoolArg('dryRun', false),
  }
}

function requireSupabaseClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key, { auth: { persistSession: false } })
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function normalizeScanScoreToPct(raw: number | null | undefined): number {
  const safe = Number(raw ?? 0)
  if (!Number.isFinite(safe)) return 0
  if (safe > 5) return clamp(safe, 0, 100)
  return clamp(safe * 20, 0, 100)
}

function computeQuickTradeScore(item: {
  entry_score?: number | null
  warn_score?: number | null
  liquidity?: number | null
}): number {
  const entryPct = normalizeScanScoreToPct(item.entry_score)
  const warnPct = normalizeScanScoreToPct(item.warn_score)
  const safetyPct = 100 - warnPct
  const liquidity = Number(item.liquidity ?? 0)
  const liquidityScore =
    liquidity >= 80_000_000_000 ? 100 :
    liquidity >= 30_000_000_000 ? 85 :
    liquidity >= 10_000_000_000 ? 70 :
    liquidity >= 3_000_000_000 ? 55 :
    liquidity >= 1_000_000_000 ? 40 : 20
  return clamp(
    entryPct * 0.56 +
    safetyPct * 0.20 +
    liquidityScore * 0.24,
    0,
    100,
  )
}

function isQuickTradeStrict(item: {
  warn_grade?: string | null
  entry_grade?: string | null
  trend_grade?: string | null
  liquidity?: number | null
  entry_score?: number | null
  warn_score?: number | null
}): boolean {
  const warn = String(item.warn_grade || '').toUpperCase().trim()
  if (warn === 'SELL') return false
  const entry = String(item.entry_grade || '').toUpperCase().trim()
  const trend = String(item.trend_grade || '').toUpperCase().trim()
  const hasQuality = entry === 'A' || entry === 'B' || trend === 'A' || trend === 'B'
  if (!hasQuality) return false
  if (Number(item.liquidity ?? 0) < 1_000_000_000) return false
  return computeQuickTradeScore(item) >= 58
}

function isQuickTradeLite(item: {
  warn_grade?: string | null
  entry_grade?: string | null
  trend_grade?: string | null
  liquidity?: number | null
  entry_score?: number | null
  warn_score?: number | null
}): boolean {
  const warn = String(item.warn_grade || '').toUpperCase().trim()
  if (warn === 'SELL') return false
  const entry = String(item.entry_grade || '').toUpperCase().trim()
  const trend = String(item.trend_grade || '').toUpperCase().trim()
  const hasQuality = entry === 'A' || entry === 'B' || trend === 'A' || trend === 'B'
  if (!hasQuality) return false
  if (Number(item.liquidity ?? 0) < 500_000_000) return false
  return computeQuickTradeScore(item) >= 52
}

async function fetchTargetDates(supabase: SupabaseClient, args: Args): Promise<string[]> {
  const fromDate = args.from || toDateText(args.days)
  let query = supabase
    .from('pullback_signals')
    .select('trade_date')
    .gte('trade_date', fromDate)
    .order('trade_date', { ascending: false })
    .limit(Math.max(10, args.limitDates * 4))

  if (args.to) query = query.lte('trade_date', args.to)

  const { data, error } = await query
  if (error) throw new Error(`pullback_signals 날짜 조회 실패: ${error.message}`)

  const unique = Array.from(new Set((data ?? []).map((row: any) => String(row.trade_date || '').slice(0, 10)).filter(Boolean)))
  return unique.slice(0, args.limitDates).sort((a, b) => a.localeCompare(b))
}

async function fetchIndicatorLiquidityByCode(
  supabase: SupabaseClient,
  tradeDate: string,
  codes: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  if (codes.length === 0) return map

  const { data: rows, error } = await supabase
    .from('daily_indicators')
    .select('code,value_traded')
    .eq('trade_date', tradeDate)
    .in('code', codes)

  let sourceRows: IndicatorRow[] = []
  if (!error) {
    sourceRows = (rows ?? []) as IndicatorRow[]
  } else {
    const fallback = await supabase
      .from('indicators')
      .select('code,value_traded')
      .eq('trade_date', tradeDate)
      .in('code', codes)
    sourceRows = (fallback.data ?? []) as IndicatorRow[]
  }

  for (const row of sourceRows) {
    const code = String(row.code || '').trim()
    const value = Number(row.value_traded)
    if (!code || !Number.isFinite(value) || value <= 0) continue
    map.set(code, value)
  }

  return map
}

function shiftDateText(baseDateText: string, days: number): string {
  const base = Date.parse(`${baseDateText}T00:00:00+09:00`)
  if (Number.isNaN(base)) {
    const fallback = new Date(Date.now() - days * 86_400_000)
    return fallback.toISOString().slice(0, 10)
  }
  const shifted = new Date(base - days * 86_400_000)
  return shifted.toISOString().slice(0, 10)
}

async function fetchStockDailyLiquidityByCode(
  supabase: SupabaseClient,
  tradeDate: string,
  codes: string[],
): Promise<Map<string, number>> {
  const map = new Map<string, number>()
  if (codes.length === 0) return map

  const fromDate = shiftDateText(tradeDate, 15)
  const { data } = await supabase
    .from('stock_daily')
    .select('ticker,date,value')
    .in('ticker', codes)
    .gte('date', fromDate)
    .lte('date', tradeDate)
    .order('date', { ascending: false })

  for (const row of data ?? []) {
    const code = String((row as any)?.ticker || '').trim()
    if (!code || map.has(code)) continue
    const value = Number((row as any)?.value)
    if (!Number.isFinite(value) || value <= 0) continue
    map.set(code, value)
  }

  return map
}

function extractStock(stock: PullbackRow['stock']): { code: string; liquidity: number | null } {
  if (Array.isArray(stock)) return stock[0] || { code: '', liquidity: null }
  return stock || { code: '', liquidity: null }
}

async function processDate(supabase: SupabaseClient, tradeDate: string): Promise<{ total: number; strict: number; lite: number; upserts: UpsertRow[] }> {
  const { data, error } = await supabase
    .from('pullback_signals')
    .select(`
      trade_date,
      code,
      entry_grade,
      entry_score,
      trend_grade,
      warn_grade,
      warn_score,
      stock:stocks(code,liquidity)
    `)
    .eq('trade_date', tradeDate)
    .neq('warn_grade', 'SELL')

  if (error) throw new Error(`pullback_signals 조회 실패(${tradeDate}): ${error.message}`)

  const rows = (data ?? []) as PullbackRow[]
  const codes = rows.map((row) => String(row.code || '').trim()).filter(Boolean)
  const indicatorLiquidityByCode = await fetchIndicatorLiquidityByCode(supabase, tradeDate, codes)
  const stockDailyLiquidityByCode = await fetchStockDailyLiquidityByCode(supabase, tradeDate, codes)

  let strict = 0
  let lite = 0
  const upserts: UpsertRow[] = []

  for (const row of rows) {
    const code = String(row.code || '').trim()
    if (!code) continue
    const stock = extractStock(row.stock)
    const rawStockLiquidity = Number(stock.liquidity)
    const stockLiquidity = Number.isFinite(rawStockLiquidity) && rawStockLiquidity > 0 ? rawStockLiquidity : null
    const fallbackLiquidity = indicatorLiquidityByCode.get(code) ?? stockDailyLiquidityByCode.get(code)
    const liquidity = Number(stockLiquidity ?? fallbackLiquidity ?? 0)

    const quickScore = computeQuickTradeScore({
      entry_score: row.entry_score,
      warn_score: row.warn_score,
      liquidity,
    })

    const isStrict = isQuickTradeStrict({
      warn_grade: row.warn_grade,
      entry_grade: row.entry_grade,
      trend_grade: row.trend_grade,
      liquidity,
      entry_score: row.entry_score,
      warn_score: row.warn_score,
    })

    const isLite = isQuickTradeLite({
      warn_grade: row.warn_grade,
      entry_grade: row.entry_grade,
      trend_grade: row.trend_grade,
      liquidity,
      entry_score: row.entry_score,
      warn_score: row.warn_score,
    })

    if (isStrict) strict += 1
    if (isLite) lite += 1

    upserts.push({
      code,
      trade_date: tradeDate,
      is_quick_strict: isStrict,
      is_quick_lite: isLite,
      quick_score: Math.round(quickScore * 10) / 10,
    })
  }

  return { total: rows.length, strict, lite, upserts }
}

async function main() {
  const args = parseArgs()
  const supabase = requireSupabaseClient()
  const targetDates = await fetchTargetDates(supabase, args)

  if (targetDates.length === 0) {
    console.log('[backfill-scan-signal-history] 대상 날짜가 없습니다.')
    return
  }

  console.log(
    `[backfill-scan-signal-history] dates=${targetDates.length} range=${targetDates[0]}..${targetDates[targetDates.length - 1]} dryRun=${args.dryRun}`,
  )

  let totalRows = 0
  let totalStrict = 0
  let totalLite = 0
  let totalUpserts = 0

  for (const tradeDate of targetDates) {
    const result = await processDate(supabase, tradeDate)
    totalRows += result.total
    totalStrict += result.strict
    totalLite += result.lite

    if (!args.dryRun && result.upserts.length > 0) {
      const { error } = await supabase
        .from('scan_signal_history')
        .upsert(result.upserts, { onConflict: 'code,trade_date' })
      if (error) throw new Error(`scan_signal_history upsert 실패(${tradeDate}): ${error.message}`)
      totalUpserts += result.upserts.length
    }

    console.log(
      `[backfill-scan-signal-history] ${tradeDate} total=${result.total} strict=${result.strict} lite=${result.lite} upserts=${args.dryRun ? 0 : result.upserts.length}`,
    )
  }

  console.log(
    `[backfill-scan-signal-history] done totalRows=${totalRows} strict=${totalStrict} lite=${totalLite} totalUpserts=${args.dryRun ? 0 : totalUpserts}`,
  )
}

main().catch((error) => {
  console.error('[backfill-scan-signal-history] failed:', error)
  process.exit(1)
})
