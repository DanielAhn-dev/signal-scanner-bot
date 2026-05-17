import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

const ORIGIN = process.env.UI_CORS_ORIGIN || '*'
const LEADER_CACHE_TTL_MS = Math.max(0, Number(process.env.UI_SECTOR_LEADERS_CACHE_TTL_MS || 60_000))

type LeaderCacheEntry = {
  expiresAt: number
  payload: any
}

const leadersCache = new Map<string, LeaderCacheEntry>()

let _supabase: SupabaseClient | null = null
function getSupabase(): SupabaseClient {
  if (_supabase) return _supabase
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
  if (!url || !key) throw new Error('Server not configured')
  _supabase = createClient(url, key, { auth: { persistSession: false } })
  return _supabase
}

function normalizeSectorIds(input: unknown): string[] {
  const raw = String(input || '')
  if (!raw) return []
  return Array.from(new Set(raw.split(',').map((v) => v.trim()).filter(Boolean)))
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const requestOrigin = String(req.headers.origin || '').trim()
  const trustedOrigins = String(
    process.env.UI_TRUSTED_WEB_ORIGINS ||
    process.env.UI_CORS_ORIGIN ||
    'https://signal-scanner-web.vercel.app,http://localhost:5173',
  )
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
  const allowOrigin = requestOrigin && trustedOrigins.includes(requestOrigin)
    ? requestOrigin
    : (trustedOrigins[0] || ORIGIN || '*')

  res.setHeader('Access-Control-Allow-Origin', allowOrigin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Cache-Control', 'private, max-age=30, stale-while-revalidate=120')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const expectedReadKey = process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY
  const readKey = req.headers['x-ui-key'] || req.query.ui_key
  const isTrustedOrigin = !!requestOrigin && trustedOrigins.includes(requestOrigin)
  if (expectedReadKey && !isTrustedOrigin && String(readKey || '') !== expectedReadKey) {
    return res.status(401).json({ error: 'Unauthorized', detail: 'Invalid UI read key' })
  }

  const sectorIds = normalizeSectorIds((req.query as any)?.sectorIds)
  if (sectorIds.length === 0) {
    return res.status(200).json({
      data: {},
      criteria: 'is_sector_leader desc, market_cap desc, liquidity desc',
      asOf: new Date().toISOString(),
    })
  }

  const limitPerSector = Math.min(5, Math.max(1, Number((req.query as any)?.limitPerSector || 3)))
  const bypassCache = String((req.query as any)?.cacheMs || '') === '0'
  const cacheKey = `sector-leaders:${sectorIds.join(',')}:limit=${limitPerSector}`

  if (!bypassCache && LEADER_CACHE_TTL_MS > 0) {
    const cached = leadersCache.get(cacheKey)
    if (cached && Date.now() <= cached.expiresAt) {
      return res.status(200).json(cached.payload)
    }
    if (cached) leadersCache.delete(cacheKey)
  }

  let supabase: SupabaseClient
  try {
    supabase = getSupabase()
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }

  try {
    const bySector: Record<string, Array<{
      code: string
      name: string
      market: string | null
      market_cap: number | null
      liquidity: number | null
      is_sector_leader: boolean | null
    }>> = {}

    await Promise.all(
      sectorIds.map(async (sectorId) => {
        const { data, error } = await supabase
          .from('stocks')
          .select('code,name,market,market_cap,liquidity,is_sector_leader')
          .eq('sector_id', sectorId)
          .eq('is_active', true)
          .in('market', ['KOSPI', 'KOSDAQ'])
          .order('is_sector_leader', { ascending: false })
          .order('market_cap', { ascending: false, nullsFirst: false })
          .order('liquidity', { ascending: false, nullsFirst: false })
          .limit(limitPerSector)

        if (error) throw error
        bySector[sectorId] = (data ?? []).map((row: any) => ({
          code: String(row.code || ''),
          name: String(row.name || row.code || ''),
          market: row.market ?? null,
          market_cap: Number.isFinite(Number(row.market_cap)) ? Number(row.market_cap) : null,
          liquidity: Number.isFinite(Number(row.liquidity)) ? Number(row.liquidity) : null,
          is_sector_leader: typeof row.is_sector_leader === 'boolean' ? row.is_sector_leader : null,
        }))
      }),
    )

    const payload = {
      data: bySector,
      criteria: 'is_sector_leader desc, market_cap desc, liquidity desc',
      asOf: new Date().toISOString(),
    }

    if (!bypassCache && LEADER_CACHE_TTL_MS > 0) {
      leadersCache.set(cacheKey, {
        expiresAt: Date.now() + LEADER_CACHE_TTL_MS,
        payload,
      })
    }

    return res.status(200).json(payload)
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
