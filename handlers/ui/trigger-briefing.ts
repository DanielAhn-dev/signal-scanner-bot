import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const ORIGIN = process.env.UI_CORS_ORIGIN || '*'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const readKey = req.headers['x-ui-key'] || req.query.ui_key || process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY
  if (!readKey || String(readKey) !== (process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const SUPABASE_URL = process.env.SUPABASE_URL
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(500).json({ error: 'Server misconfiguration' })

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
    const dedupKey = `manual_briefing:${Date.now()}`
    const { error } = await supabase.from('jobs').insert({
      type: 'cron_dispatch',
      status: 'queued',
      dedup_key: `briefing:${dedupKey}`,
      payload: { task: 'briefing', key: dedupKey },
    })

    if (error) {
      return res.status(500).json({ error: String(error) })
    }

    return res.status(200).json({ ok: true, message: 'Briefing enqueued' })
  } catch (e: any) {
    return res.status(500).json({ error: String(e) })
  }
}
