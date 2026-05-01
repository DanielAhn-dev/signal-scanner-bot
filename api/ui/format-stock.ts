import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const ORIGIN = process.env.UI_CORS_ORIGIN || '*'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || ORIGIN || '*'
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const readKey = req.headers['x-ui-key'] || req.query.ui_key || process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY
  if (!readKey || String(readKey) !== (process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
  if (!url || !key) return res.status(500).json({ error: 'Server not configured' })

  const supabase = createClient(url, key)
  const code = String(req.query.code || '').trim()
  if (!code) return res.status(400).json({ error: 'Missing code parameter' })

  try {
    // fetch stock basic info
    const { data: sdata, error: serror } = await supabase
      .from('stocks')
      .select('code,name,sector_id,liquidity,updated_at,description,close')
      .eq('code', code)
      .limit(1)
    if (serror) return res.status(500).json({ error: serror.message })
    const row = (sdata && sdata[0]) || null
    if (!row) return res.status(404).json({ error: 'Not found' })

    // try to fetch recent timeseries for sparkline (limit to 60 points)
    const candidates = ['stock_prices', 'stock_timeseries', 'stock_history']
    let times: any[] = []
    for (const tbl of candidates) {
      const { data: tdata, error: terr } = await supabase
        .from(tbl)
        .select('date,close')
        .eq('code', code)
        .order('date', { ascending: false })
        .limit(60)
      if (!terr && tdata && tdata.length) {
        times = tdata.slice().reverse() // ascending for plotting
        break
      }
    }

    // build sparkline SVG if we have any points
    let sparkSvg = ''
    if (times.length) {
      const values = times.map((r: any) => Number(r.close ?? 0))
      const w = 300
      const h = 60
      const min = Math.min(...values)
      const max = Math.max(...values)
      const span = max - min || 1
      const points = values.map((v: number, i: number) => {
        const x = (i / (values.length - 1 || 1)) * w
        const y = h - ((v - min) / span) * h
        return `${x.toFixed(2)},${y.toFixed(2)}`
      }).join(' ')

      sparkSvg = `
        <svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" style="background:transparent">
          <polyline fill="none" stroke="#0060FF" stroke-width="2" points="${points}" stroke-linejoin="round" stroke-linecap="round" />
        </svg>
      `
    }

    const html = `
      <div style="font-family:system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial;">
        <h2 style="margin:0 0 8px 0;">${row.name || ''} (${row.code})</h2>
        <div style="color:#6B7280;margin-bottom:8px;">섹터: ${row.sector_id || '-'} · 유동성: ${row.liquidity ?? '-'} · 업데이트: ${row.updated_at ? new Date(row.updated_at).toLocaleString() : '-'}</div>
        <div style="padding:8px;border:1px solid #eee;border-radius:6px;background:#fff;">
          <div style="display:flex;gap:12px;align-items:center">
            <div style="font-weight:600">현재가: ${row.close ?? '—'}</div>
            <div style="flex:1">${sparkSvg}</div>
          </div>
          ${row.description ? `<div style="margin-top:8px;color:#374151">${String(row.description).slice(0,200)}</div>` : ''}
        </div>
      </div>
    `

    return res.status(200).json({ data: { html } })
  } catch (e: any) {
    return res.status(500).json({ error: String(e) })
  }
}
