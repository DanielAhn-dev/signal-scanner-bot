import type { VercelRequest, VercelResponse } from '@vercel/node'
import { discoverMultibaggerCandidates } from '../../src/services/discoveryService'

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

  const limitRaw = req.query.limit
  const limit = Math.min(50, Math.max(5, Number(Array.isArray(limitRaw) ? limitRaw[0] : limitRaw) || 20))

  try {
    const picks = await discoverMultibaggerCandidates(limit)
    return res.status(200).json({ picks, total: picks.length, fetchedAt: new Date().toISOString() })
  } catch (err: any) {
    console.error('[discovery-picks] error:', err)
    return res.status(500).json({ error: 'Internal server error', detail: err?.message })
  }
}
