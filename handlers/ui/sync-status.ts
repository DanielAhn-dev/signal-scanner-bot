import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getSyncJob } from './_syncState'

const ORIGIN = process.env.UI_CORS_ORIGIN || '*'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || ORIGIN || '*'
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key')
  res.setHeader('Access-Control-Allow-Credentials', 'true')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const readKey = req.headers['x-ui-key'] || req.query.ui_key || process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY
  if (!readKey || String(readKey) !== (process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const syncId = String(req.query.syncId || '').trim()
  if (!syncId) {
    return res.status(400).json({ error: 'syncId is required' })
  }

  try {
    const item = await getSyncJob(syncId)
    if (!item) {
      return res.status(200).json({
        ok: true,
        data: {
          id: syncId,
          kind: 'stocks-refresh',
          status: 'running',
          progress: 1,
          stage: '요청 대기',
          detail: '동기화 작업 생성 대기 중입니다.',
          startedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      })
    }
    return res.status(200).json({ ok: true, data: item })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
