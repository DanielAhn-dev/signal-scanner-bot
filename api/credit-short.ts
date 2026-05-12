import { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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

    const records: Array<{ code: string; date: string; short_ratio: number | null; credit_ratio: number | null }> = []
    const latestByCode = new Map<string, { short_ratio?: number; credit_ratio?: number }>()

    for (let i = 0; i < rows.length; i += 1) {
      const row = rows[i] || {}
      const rawCode = String(row.code || '').trim().replace(/^A/i, '')
      const code = rawCode.padStart(6, '0')
      if (!/^\d{6}$/.test(code)) {
        return res.status(400).json({ error: `Invalid code at row ${i + 1}` })
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

    // Upsert to stock_credit_short_daily
    const { error: upsertError } = await supabase
      .from('stock_credit_short_daily')
      .upsert(records, {
        onConflict: 'code,date',
      })

    if (upsertError) {
      console.error('Upsert error:', upsertError)
      return res.status(500).json({ error: 'Failed to save data' })
    }

    // Update latest values per stock code
    let updatedStocks = 0
    for (const [code, payload] of latestByCode.entries()) {
      if (!Object.keys(payload).length) continue
      await supabase
        .from('stocks')
        .update(payload)
        .eq('code', code)
      updatedStocks += 1
    }

    return res.status(200).json({
      success: true,
      saved: records.length,
      updatedStocks,
    })
  } catch (err) {
    console.error('Error:', err)
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Unknown error',
    })
  }
}
