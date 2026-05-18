import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getLatestPreRallyReport } from '../../src/services/preRallyReportService'

const ORIGIN = process.env.UI_CORS_ORIGIN || '*'

function parseHorizon(req: VercelRequest): number {
  const raw = String(req.query.horizon ?? '').trim()
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 40
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || ORIGIN
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key')
  res.setHeader('Access-Control-Allow-Credentials', 'true')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const expectedReadKey = process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY
  const readKey = req.headers['x-ui-key'] || req.query.ui_key
  const trustedOrigins = String(
    process.env.UI_TRUSTED_WEB_ORIGINS ||
      'https://signal-scanner-web.vercel.app,https://stocksweb-seven.vercel.app,http://localhost:5173',
  )
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const isTrustedOrigin = !!origin && trustedOrigins.includes(origin)

  if (expectedReadKey && !isTrustedOrigin && String(readKey || '') !== expectedReadKey) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const horizon = parseHorizon(req)
    const loaded = getLatestPreRallyReport(horizon)
    if (!loaded) {
      return res.status(200).json({
        ok: true,
        data: null,
        note: `horizon ${horizon} 기준 pre_rally 리포트가 없습니다. analyze:pre-rally 실행 후 다시 조회하세요.`,
      })
    }

    return res.status(200).json({
      ok: true,
      data: {
        ...loaded.data,
        fileName: loaded.fileName,
      },
    })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
