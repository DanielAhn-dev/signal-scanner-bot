import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { denyIfUnauthorizedRead } from './_accessControl'
import { resolveUiUserContext } from './_userContext'
import { buildAudienceKey, REPORT_SNAPSHOT_TABLE } from '../../src/services/reportSnapshotService'

// 기기를 바꿔도 따라오는 사용자별 화면 설정 — 사용자당 snapshot 행 하나에 키별로 저장한다.
// users.prefs에 쓰면 봇이 동시에 쓰는 가상 계좌 값과 서로 덮어쓸 수 있어 따로 둔다.
const TOPIC = '사용자설정'
const FIXED_DATE = '2000-01-01'
const MAX_VALUE_BYTES = 8_000

/** 서버가 받는 키 — 이름과 크기를 제한해 임의 데이터 저장소로 쓰이지 않게 한다 */
export const USER_STATE_KEYS = new Set(['holdingRules', 'assetOverview', 'tradeCost', 'buycheck', 'accumulate', 'investorProfile', 'switchHistory', 'dropPlan', 'childGifts'])

type StateMap = Record<string, { value: unknown; updatedAt: number }>

function parseState(raw: unknown): StateMap {
  try {
    const parsed = JSON.parse(String(raw || '{}'))
    if (!parsed || typeof parsed !== 'object') return {}
    const out: StateMap = {}
    for (const [k, v] of Object.entries(parsed as Record<string, any>)) {
      if (USER_STATE_KEYS.has(k) && v && typeof v === 'object' && 'value' in v) {
        out[k] = { value: v.value, updatedAt: Number(v.updatedAt) || 0 }
      }
    }
    return out
  } catch {
    return {}
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || process.env.UI_CORS_ORIGIN || '*'
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key,x-user-chat-id,x-user-client-id,Authorization')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  if (denyIfUnauthorizedRead(req, res)) return

  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
  if (!url || !key) return res.status(500).json({ error: 'Server not configured' })
  const supabase = createClient(url, key, { auth: { persistSession: false } })

  try {
    const user = await resolveUiUserContext(req)
    if (!user.chatId && !user.clientId) return res.status(400).json({ error: 'identity required' })
    const audienceKey = buildAudienceKey({ chatId: user.chatId, clientId: user.clientId })

    const { data, error } = await supabase
      .from(REPORT_SNAPSHOT_TABLE)
      .select('body_text')
      .eq('topic', TOPIC)
      .eq('audience_key', audienceKey)
      .eq('report_date', FIXED_DATE)
      .maybeSingle()
    if (error && !error.message.includes('Could not find the table')) return res.status(500).json({ error: error.message })
    const state = parseState(data?.body_text)

    if (req.method === 'GET') return res.status(200).json({ ok: true, data: state })

    const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body) ?? {}
    const name = String(body.key || '')
    if (!USER_STATE_KEYS.has(name)) return res.status(400).json({ error: 'unknown key' })
    if (JSON.stringify(body.value ?? null).length > MAX_VALUE_BYTES) return res.status(413).json({ error: 'value too large' })

    state[name] = { value: body.value ?? null, updatedAt: Date.now() }
    const { error: upsertError } = await supabase.from(REPORT_SNAPSHOT_TABLE).upsert(
      {
        topic: TOPIC,
        audience_key: audienceKey,
        report_date: FIXED_DATE,
        body_text: JSON.stringify(state),
        source_label: 'web-user-state',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'topic,audience_key,report_date' },
    )
    if (upsertError) return res.status(500).json({ error: upsertError.message })
    return res.status(200).json({ ok: true, data: state })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
