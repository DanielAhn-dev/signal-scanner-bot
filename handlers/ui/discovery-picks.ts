import type { VercelRequest, VercelResponse } from '@vercel/node'
import { discoverMultibagger, type DiscoveryQoqMode } from '../../src/services/discoveryService'
import { getPagingRunStatsSummary, resetPagingRunStats } from '../../src/services/supabasePaging'
import { denyIfUnauthorizedRead } from './_accessControl'

const ORIGIN = process.env.UI_CORS_ORIGIN || '*'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || ORIGIN || '*'
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Cache-Control', 'private, max-age=60, stale-while-revalidate=300')

  if (req.method === 'OPTIONS') {
    return res.status(204).end()
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  if (denyIfUnauthorizedRead(req, res)) return


  const limitRaw = req.query.limit
  const limit = Math.min(50, Math.max(5, Number(Array.isArray(limitRaw) ? limitRaw[0] : limitRaw) || 20))
  const minMarketCapBillionRaw = Array.isArray(req.query.minMarketCapBillion)
    ? req.query.minMarketCapBillion[0]
    : req.query.minMarketCapBillion
  const minRoeRaw = Array.isArray(req.query.minRoe) ? req.query.minRoe[0] : req.query.minRoe
  const maxPbrRaw = Array.isArray(req.query.maxPbr) ? req.query.maxPbr[0] : req.query.maxPbr
  const minPegRaw = Array.isArray(req.query.minPeg) ? req.query.minPeg[0] : req.query.minPeg
  const maxPegRaw = Array.isArray(req.query.maxPeg) ? req.query.maxPeg[0] : req.query.maxPeg
  const qoqModeRaw = Array.isArray(req.query.qoqMode) ? req.query.qoqMode[0] : req.query.qoqMode

  const criteriaInput = {
    minMarketCap: Number(minMarketCapBillionRaw) * 100_000_000,
    minRoe: Number(minRoeRaw),
    maxPbr: Number(maxPbrRaw),
    minPeg: minPegRaw == null || String(minPegRaw).trim() === '' ? null : Number(minPegRaw),
    maxPeg: maxPegRaw == null || String(maxPegRaw).trim() === '' ? null : Number(maxPegRaw),
    qoqMode: (qoqModeRaw === 'latest-quarter-positive'
      ? 'latest-quarter-positive'
      : 'two-quarter-positive') as DiscoveryQoqMode,
  }

  try {
    resetPagingRunStats()
    const result = await discoverMultibagger(limit, criteriaInput)
    return res.status(200).json({
      picks: result.picks,
      total: result.picks.length,
      criteria: {
        minMarketCapBillion: Math.round(result.criteria.minMarketCap / 100_000_000),
        minRoe: result.criteria.minRoe,
        maxPbr: result.criteria.maxPbr,
        minPeg: result.criteria.minPeg,
        maxPeg: result.criteria.maxPeg,
        qoqMode: result.criteria.qoqMode,
      },
      funnel: result.funnel,
      fetchedAt: new Date().toISOString(),
      meta: {
        paging: getPagingRunStatsSummary(),
      },
    })
  } catch (err: any) {
    console.error('[discovery-picks] error:', err)
    return res.status(500).json({ error: 'Internal server error', detail: err?.message })
  }
}
