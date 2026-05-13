import { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function toPositiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.floor(n)
}

function toBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback
  const v = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'y', 'on'].includes(v)) return true
  if (['0', 'false', 'no', 'n', 'off'].includes(v)) return false
  return fallback
}

function normalizeCode(input: string): string {
  return input.trim().replace(/^A/i, '').padStart(6, '0')
}

const ONLY_INVESTABLE = toBoolean(process.env.CREDIT_SHORT_ONLY_INVESTABLE, true)
const ALLOWED_UNIVERSE = String(process.env.CREDIT_SHORT_ALLOWED_UNIVERSE || 'core,extended')
  .split(',')
  .map(v => v.trim())
  .filter(Boolean)
const MIN_LIQUIDITY = Number(process.env.CREDIT_SHORT_MIN_LIQUIDITY || '0')
const MAX_ELIGIBLE_CODES = toPositiveInt(process.env.CREDIT_SHORT_MAX_ELIGIBLE_CODES, 500)
const MAX_ROWS_PER_REQUEST = toPositiveInt(process.env.CREDIT_SHORT_MAX_ROWS_PER_REQUEST, 3000)
const UPSERT_BATCH_SIZE = toPositiveInt(process.env.CREDIT_SHORT_UPSERT_BATCH_SIZE, 500)
const STOCK_UPDATE_CONCURRENCY = toPositiveInt(process.env.CREDIT_SHORT_STOCK_UPDATE_CONCURRENCY, 20)

async function loadInvestableCodes(): Promise<Set<string>> {
  let query = supabase
    .from('stocks')
    .select('code, liquidity')
    .eq('is_active', true)
    .order('mcap_rank', { ascending: true, nullsFirst: false })
    .limit(MAX_ELIGIBLE_CODES)

  if (ALLOWED_UNIVERSE.length) {
    query = query.in('universe_level', ALLOWED_UNIVERSE)
  }

  const { data, error } = await query
  if (error) {
    throw new Error(`Failed to load investable universe: ${error.message}`)
  }

  const codes = new Set<string>()
  for (const row of data || []) {
    const code = normalizeCode(String((row as any)?.code || ''))
    if (!/^\d{6}$/.test(code)) continue
    const liquidity = Number((row as any)?.liquidity ?? 0)
    if (Number.isFinite(MIN_LIQUIDITY) && MIN_LIQUIDITY > 0 && liquidity < MIN_LIQUIDITY) continue
    codes.add(code)
  }
  return codes
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : []
    if (!rows.length) {
      return res.status(400).json({ error: 'rows is required and must be a non-empty array' })
    }
    if (rows.length > MAX_ROWS_PER_REQUEST) {
      return res.status(413).json({
        error: `rows exceeds limit (${MAX_ROWS_PER_REQUEST})`,
      })
    }

    const records: Array<{ code: string; date: string; short_ratio: number | null; credit_ratio: number | null }> = []
    const latestByCode = new Map<string, { short_ratio?: number; credit_ratio?: number }>()
    const investableCodes = ONLY_INVESTABLE ? await loadInvestableCodes() : null
    let filteredOut = 0

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i] || {}
      const code = normalizeCode(String(row.code || ''))
      if (!/^\d{6}$/.test(code)) {
        return res.status(400).json({ error: `Invalid code at row ${i + 1}` })
      }
      if (investableCodes && !investableCodes.has(code)) {
        filteredOut += 1
        continue
      }

      const rawDate = String(row.date || '').trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
        return res.status(400).json({ error: `Invalid date at row ${i + 1} (YYYY-MM-DD)` })
      }

      const hasShort = row.shortRatio !== undefined && row.shortRatio !== null && row.shortRatio !== ''
      const hasCredit = row.creditRatio !== undefined && row.creditRatio !== null && row.creditRatio !== ''
      if (!hasShort && !hasCredit) {
        return res.status(400).json({ error: `shortRatio/creditRatio required at row ${i + 1}` })
      }

      const shortRatio = hasShort ? Number(row.shortRatio) : null
      const creditRatio = hasCredit ? Number(row.creditRatio) : null
      if ((shortRatio !== null && Number.isNaN(shortRatio)) || (creditRatio !== null && Number.isNaN(creditRatio))) {
        return res.status(400).json({ error: `shortRatio/creditRatio must be numeric at row ${i + 1}` })
      }

      records.push({
        code,
        date: rawDate,
        short_ratio: shortRatio,
        credit_ratio: creditRatio,
      })

      const latest = latestByCode.get(code) || {}
      if (shortRatio !== null) latest.short_ratio = shortRatio
      if (creditRatio !== null) latest.credit_ratio = creditRatio
      latestByCode.set(code, latest)
    }

    if (!records.length) {
      return res.status(200).json({
        success: true,
        requested: rows.length,
        saved: 0,
        filteredOut,
        updatedStocks: 0,
      })
    }

    // Upsert to stock_credit_short_daily
    for (let i = 0; i < records.length; i += UPSERT_BATCH_SIZE) {
      const chunk = records.slice(i, i + UPSERT_BATCH_SIZE)
      const { error: upsertError } = await supabase
        .from('stock_credit_short_daily')
        .upsert(chunk, {
          onConflict: 'code,date',
        })

      if (upsertError) {
        console.error('Upsert error:', upsertError)
        return res.status(500).json({ error: 'Failed to save data' })
      }
    }

    // Update latest values per stock code
    let updatedStocks = 0
    const stockUpdates = Array.from(latestByCode.entries())
      .filter(([, payload]) => Object.keys(payload).length > 0)

    for (let i = 0; i < stockUpdates.length; i += STOCK_UPDATE_CONCURRENCY) {
      const window = stockUpdates.slice(i, i + STOCK_UPDATE_CONCURRENCY)
      await Promise.all(window.map(async ([code, payload]) => {
        const { error: updateError } = await supabase
          .from('stocks')
          .update(payload)
          .eq('code', code)
        if (updateError) {
          console.error('stocks update error:', code, updateError)
          return
        }
        updatedStocks += 1
      }))
    }

    return res.status(200).json({
      success: true,
      requested: rows.length,
      saved: records.length,
      filteredOut,
      updatedStocks,
    })
  } catch (err) {
    console.error('Error:', err)
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    })
  }
}
