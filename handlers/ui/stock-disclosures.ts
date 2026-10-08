import type { VercelRequest, VercelResponse } from '@vercel/node'
import { denyIfUnauthorizedRead } from './_accessControl'
import { fetchStockDisclosureCheck } from '../../src/services/stockDisclosureCheck'

const ORIGIN = process.env.UI_CORS_ORIGIN || '*'

/** GET /api/ui/stock-disclosures?code=007660 — 최근 1년 위험·희석 공시 (공개 정보라 사용자별 차이 없음) */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || ORIGIN
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (denyIfUnauthorizedRead(req, res)) return

  const raw = String(req.query.code || '').trim().replace(/^A/i, '')
  const code = /^\d{1,6}$/.test(raw) ? raw.padStart(6, '0') : raw
  if (!/^[0-9A-Z]{6}$/.test(code)) return res.status(400).json({ error: 'code 파라미터가 필요합니다.' })

  const data = await fetchStockDisclosureCheck(code)
  return res.status(200).json({ ok: data.status === 'ok', data })
}
