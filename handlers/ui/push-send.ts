import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getMessaging } from 'firebase-admin/messaging'
import { resolveUiUserContext } from './_userContext'

function getFirebaseAdmin() {
  if (getApps().length) return getApps()[0]!
  let raw = String(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '').trim()
  if (!raw) return null
  // Vercel 환경변수 UI는 dotenv와 달리 따옴표를 벗겨주지 않는다 — 로컬 .env.local(작은따옴표로
  // 감싼 형태)에서 그대로 복사해 붙여넣으면 앞뒤 따옴표까지 값에 포함돼 JSON.parse가 깨진다.
  if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) {
    raw = raw.slice(1, -1)
  }
  const serviceAccount = JSON.parse(raw)
  return initializeApp({ credential: cert(serviceAccount) })
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || process.env.UI_CORS_ORIGIN || '*'
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key,Authorization')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const readKey = req.headers['x-ui-key'] || req.query.ui_key || process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY
  if (!readKey || String(readKey) !== (process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
  if (!url || !key) return res.status(500).json({ error: 'Server not configured' })
  const supabase = createClient(url, key)

  const app = getFirebaseAdmin()
  if (!app) return res.status(500).json({ error: 'FIREBASE_SERVICE_ACCOUNT_JSON not configured' })

  const user = await resolveUiUserContext(req)
  if (user.source !== 'auth' || !user.clientId) {
    return res.status(401).json({ error: 'Sign-in required' })
  }

  const { title, body: messageBody, path, notificationId } = (req.body || {}) as {
    title?: string
    body?: string
    path?: string
    notificationId?: string
  }
  if (!title || typeof title !== 'string') return res.status(400).json({ error: 'Missing title' })

  const { data: rows, error } = await supabase
    .from('push_tokens')
    .select('token')
    .eq('client_id', user.clientId)
  if (error) return res.status(500).json({ error: error.message })

  const tokens = (rows || []).map((r) => r.token as string)
  if (tokens.length === 0) return res.status(200).json({ ok: true, sent: 0, failed: 0 })

  const messaging = getMessaging(app)
  // notification 필드까지 같이 보내면 브라우저가 SW의 showNotification과 별개로 자동 표시해
  // 알림이 2개 뜬다 — data-only로 보내고 표시는 서비스워커에서 전담한다.
  const data: Record<string, string> = { title, body: messageBody || '' }
  if (path) data.path = path
  if (notificationId) data.id = String(notificationId)

  const results = await Promise.allSettled(
    tokens.map((token) => messaging.send({ token, data })),
  )

  const staleTokens: string[] = []
  let sent = 0
  let failed = 0
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      sent += 1
      return
    }
    failed += 1
    const code = (result.reason as { code?: string })?.code
    if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
      staleTokens.push(tokens[i])
    }
  })

  if (staleTokens.length > 0) {
    await supabase.from('push_tokens').delete().in('token', staleTokens)
  }

  return res.status(200).json({ ok: true, sent, failed })
}
