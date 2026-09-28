import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { resolveUiUserContext } from './_userContext'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || process.env.UI_CORS_ORIGIN || '*'
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'POST,DELETE,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key,Authorization')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  if (req.method === 'OPTIONS') return res.status(204).end()

  const readKey = req.headers['x-ui-key'] || req.query.ui_key || process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY
  if (!readKey || String(readKey) !== (process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
  if (!url || !key) return res.status(500).json({ error: 'Server not configured' })
  const supabase = createClient(url, key)

  // client_id는 반드시 인증된 세션(Authorization 헤더)에서 온 값만 신뢰한다 — 요청 바디의
  // client_id는 스푸핑 가능하므로 사용하지 않는다.
  const user = await resolveUiUserContext(req)
  if (user.source !== 'auth' || !user.clientId) {
    return res.status(401).json({ error: 'Sign-in required' })
  }
  const clientId = user.clientId

  const body = (req.body || {}) as any

  if (req.method === 'POST') {
    const token = String(body.token || '').trim()
    if (!token) return res.status(400).json({ error: 'Missing token' })
    const deviceId = body.device_id ? String(body.device_id).trim() : null

    // 같은 기기(client_id + device_id)가 예전에 등록한 다른 토큰 행을 먼저 지운다 — FCM 토큰은
    // 재설치·SW 갱신·주기적 로테이션마다 바뀌는데, upsert(onConflict:'token')만 하면 옛 행이
    // 남아 한 기기에 푸시가 여러 번 가게 된다.
    if (deviceId) {
      await supabase
        .from('push_tokens')
        .delete()
        .eq('client_id', clientId)
        .eq('device_id', deviceId)
        .neq('token', token)
    }

    const { error } = await supabase
      .from('push_tokens')
      .upsert(
        { client_id: clientId, token, device_id: deviceId, updated_at: new Date().toISOString() },
        { onConflict: 'token' },
      )
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true })
  }

  if (req.method === 'DELETE') {
    const token = String(body.token || '').trim()
    if (!token) return res.status(400).json({ error: 'Missing token' })
    const { error } = await supabase
      .from('push_tokens')
      .delete()
      .eq('client_id', clientId)
      .eq('token', token)
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ ok: true })
  }

  return res.status(405).json({ error: 'Method not allowed' })
}
