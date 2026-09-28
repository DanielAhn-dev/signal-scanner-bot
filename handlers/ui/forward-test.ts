import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { denyIfUnauthorizedRead } from './_accessControl'
import { FORWARD_TEST_RESULT_PATH, type ForwardTestSnapshot } from '../../src/services/strategyForwardTest'

// 전략 경쟁 측정(전향검증) 최신 결과 — scripts/strategy_forward_test.ts 가 매일 저장한다.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || process.env.UI_CORS_ORIGIN || '*'
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key,x-user-chat-id,Authorization')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (denyIfUnauthorizedRead(req, res)) return

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return res.status(500).json({ error: 'Server not configured' })
  try {
    const supabase = createClient(url, key, { auth: { persistSession: false } })
    const { data, error } = await supabase.storage.from('market-snapshots').download(FORWARD_TEST_RESULT_PATH)
    if (error || !data) return res.status(200).json({ ok: true, data: null })
    const snapshot = JSON.parse(await data.text()) as ForwardTestSnapshot
    res.setHeader('Cache-Control', 'private, max-age=300')
    return res.status(200).json({ ok: true, data: snapshot })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
