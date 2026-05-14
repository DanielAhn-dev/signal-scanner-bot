import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { fetchRecentSectorOrderSignalBoost } from '../../src/services/orderIntakeSignalStore'

const ORIGIN = process.env.UI_CORS_ORIGIN || '*'
const SECTORS_CACHE_TTL_MS = Math.max(0, Number(process.env.UI_SECTORS_CACHE_TTL_MS || 60_000))

type SectorsCacheEntry = {
  expiresAt: number
  payload: any
}

const sectorsCache = new Map<string, SectorsCacheEntry>()

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
  res.setHeader('Cache-Control', 'private, max-age=30, stale-while-revalidate=120')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const expectedReadKey = process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY
  const readKey = req.headers['x-ui-key'] || req.query.ui_key
  const trustedOrigins = String(
    process.env.UI_TRUSTED_WEB_ORIGINS ||
    'https://signal-scanner-web.vercel.app,http://localhost:5173',
  )
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
  const isTrustedOrigin = !!origin && trustedOrigins.includes(origin)
  if (expectedReadKey && !isTrustedOrigin && String(readKey || '') !== expectedReadKey) {
    return res.status(401).json({ error: 'Unauthorized', detail: 'Invalid UI read key' })
  }

  const bypassCache = String((req.query as any)?.cacheMs || '') === '0'
  const onlyUsed = String((req.query as any)?.onlyUsed || '') === '1'
  const positionType = String((req.query as any)?.positionType || 'all') // 'all' | 'holding' | 'interest'
    const top = Number((req.query as any)?.top || 0)   // 0 = all
    const cacheKey = `sectors:${onlyUsed ? 'used' : 'all'}:pos=${positionType}:top=${top}`
  if (!bypassCache && SECTORS_CACHE_TTL_MS > 0) {
    const cached = sectorsCache.get(cacheKey)
    if (cached && Date.now() <= cached.expiresAt) {
      return res.status(200).json(cached.payload)
    }
    if (cached) sectorsCache.delete(cacheKey)
  }

  let supabase: SupabaseClient
  try {
    supabase = getSupabase()
  } catch (e: any) {
    return res.status(500).json({ error: e.message })
  }

  try {
    // If requested, return only sectors that appear in virtual positions (holding/interest/all)
    if (onlyUsed) {
      // fetch sector ids from virtual_positions via related stock->sector_id
      let vp = supabase.from('virtual_positions').select('stock(sector_id)', { count: 'exact' })
      if (positionType === 'holding') vp = vp.gt('quantity', 0)
      else if (positionType === 'interest') vp = vp.or('quantity.is.null,quantity.eq.0')

      const vpRes = await vp
      if (vpRes.error) return res.status(500).json({ error: vpRes.error.message })
      const sectorIds = Array.from(new Set((vpRes.data ?? []).map((r: any) => r.stock?.sector_id).filter(Boolean)))
      if (sectorIds.length === 0) {
        const payloadEmpty = { data: [] }
        if (!bypassCache && SECTORS_CACHE_TTL_MS > 0) {
          sectorsCache.set(cacheKey, { expiresAt: Date.now() + SECTORS_CACHE_TTL_MS, payload: payloadEmpty })
        }
        return res.status(200).json(payloadEmpty)
      }

      const { data: sdata, error: serror } = await supabase.from('sectors').select('id,name').in('id', sectorIds).order('name', { ascending: true })
      if (serror) return res.status(500).json({ error: serror.message })
      const payload = { data: sdata ?? [] }

      if (!bypassCache && SECTORS_CACHE_TTL_MS > 0) {
        sectorsCache.set(cacheKey, {
          expiresAt: Date.now() + SECTORS_CACHE_TTL_MS,
          payload,
        })
      }

      return res.status(200).json(payload)
    }

    // default: return all sectors
      let q = supabase
        .from('sectors')
        .select('id,name,score,change_rate,metrics')
        .order('score', { ascending: false })
      if (top > 0) q = q.limit(top)
      const { data, error } = await q
    if (error) return res.status(500).json({ error: error.message })
    
    // 수주 신호 상위 섹터 조회
    const orderSignalBoost = await fetchRecentSectorOrderSignalBoost()
    
    // 모든 섹터의 ID와 이름으로 boost 값 매칭
    const sectorBoosts = (data ?? []).map((sector: any) => ({
      id: sector.id,
      name: sector.name,
      orderSignalBoost: 
        orderSignalBoost.bySectorId.get(sector.id) ?? 
        orderSignalBoost.bySectorName.get(sector.name) ?? 
        0,
    }))
    
    // 수주 신호가 0이 아닌 섹터만 필터링 및 정렬
    const orderSignalTopSectors = sectorBoosts
      .filter((s: any) => s.orderSignalBoost !== 0)
      .sort((a: any, b: any) => Math.abs(b.orderSignalBoost) - Math.abs(a.orderSignalBoost))
      .slice(0, 10) // 상위 10개만
    
    const payload = { 
      data: data ?? [],
      orderSignalTopSectors,
    }

    if (!bypassCache && SECTORS_CACHE_TTL_MS > 0) {
      sectorsCache.set(cacheKey, {
        expiresAt: Date.now() + SECTORS_CACHE_TTL_MS,
        payload,
      })
    }

    return res.status(200).json(payload)
  } catch (e: any) {
    return res.status(500).json({ error: String(e) })
  }
}
