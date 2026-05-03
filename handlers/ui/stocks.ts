import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

const ORIGIN = process.env.UI_CORS_ORIGIN || '*'

let _supabase: SupabaseClient | null = null
function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
  if (!url || !key) throw new Error('Server not configured')
  _supabase = createClient(url, key, { auth: { persistSession: false } })
  return _supabase
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || ORIGIN || '*'
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key')
  res.setHeader('Access-Control-Allow-Credentials', 'true')

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const expectedReadKey = process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY
  const readKey = req.headers['x-ui-key'] || req.query.ui_key
  const trustedOrigins = String(
    process.env.UI_TRUSTED_WEB_ORIGINS ||
    'https://stocksweb-seven.vercel.app,http://localhost:5173',
  )
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
  const isTrustedOrigin = !!origin && trustedOrigins.includes(origin)
  if (expectedReadKey && !isTrustedOrigin && String(readKey || '') !== expectedReadKey) {
    return res.status(401).json({ error: 'Unauthorized', detail: 'Invalid UI read key' })
  }

  let supabase: SupabaseClient
  try {
    supabase = getSupabase()
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }

  try {
    const q = req.query || {}
    const page = Math.max(1, Number(q.page || 1))
    const pageSize = Math.min(200, Math.max(10, Number(q.pageSize || 20)))
    const from = (page - 1) * pageSize
    const to = from + pageSize - 1

    const qParams: any = req.query || {}
    const codeOrQ = String(qParams.q || '').trim()
    const sector = qParams.sector || null
    const minLiquidity = qParams.minLiquidity ? Number(qParams.minLiquidity) : null
    const allMode = String(qParams.all || '') === '1'

    const withCount = String(qParams.withCount || '') === '1'
    let query = withCount
      ? supabase.from('stocks').select('code,name,sector_id,liquidity,updated_at', { count: 'exact' }).order('code', { ascending: true })
      : supabase.from('stocks').select('code,name,sector_id,liquidity,updated_at').order('code', { ascending: true })

    if (sector) {
      query = query.eq('sector_id', sector)
    }
    if (codeOrQ) {
      // search by code or name
      const like = `%${codeOrQ.replace(/%/g, '')}%`
      query = query.or(`code.ilike.${like},name.ilike.${like}`)
    }
    if (minLiquidity != null && !Number.isNaN(minLiquidity)) {
      query = query.gte('liquidity', minLiquidity)
    }

    // all=1: 클라이언트 캐시용 전체 목록 반환 (최대 5000)
    const { data, error, count } = allMode
      ? await query.limit(5000)
      : await query.range(from, to)

    if (error) return res.status(500).json({ error: error.message })

    return res.status(200).json({ data: data ?? [], count: withCount ? (count ?? 0) : undefined, page, pageSize })
  } catch (e: any) {
    return res.status(500).json({ error: String(e) })
  }
}
