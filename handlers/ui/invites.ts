import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { evaluateAdvancedAccess, setUiCorsHeaders } from './_accessControl'
import { resolveUiUserContext } from './_userContext'
import {
  admitIfApproved,
  getMyInvites,
  isInviteOnly,
  isMember,
  issueInvites,
  readConfig,
  redeemInvite,
  submitSignupRequest,
  writeConfig,
} from '../../src/services/invites'
import { COUPLE_REASON_MESSAGE, isCoupleCode, redeemCoupleSignup } from '../../src/services/household'

// 초대 전용 가입 (src/services/invites.ts)
// GET  ?mode=status  내 가입 상태 + (회원이면) 내 초대권 현황
// POST {action:'redeem', code}   초대 코드로 가입
// POST {action:'request', note}  가입 신청(대기열)
// 관리자: GET ?mode=admin, POST {action:'admin-issue'|'admin-decide'|'admin-config'|'admin-revoke'}
const REASON_MESSAGE: Record<string, string> = {
  invalid_code: '초대 코드가 올바르지 않습니다. 코드를 다시 확인해 주세요.',
  used_or_expired: '이미 사용했거나 기간이 지난 초대 코드입니다.',
  signups_closed: '지금은 신규 가입을 받지 않습니다.',
  full: '지금은 정원이 가득 차 가입할 수 없습니다.',
  own_code: '내가 발급한 초대 코드는 직접 쓸 수 없습니다.',
  server_error: '가입 처리 중 문제가 생겼습니다. 잠시 뒤 다시 시도해 주세요.',
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setUiCorsHeaders(req, res, 'GET,POST,OPTIONS')
  res.setHeader('Cache-Control', 'private, no-store')
  if (req.method === 'OPTIONS') return res.status(204).end()

  const readKey = req.headers['x-ui-key'] || req.query.ui_key || process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY
  if (!readKey || String(readKey) !== (process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
  if (!url || !key) return res.status(500).json({ error: 'Server not configured' })

  try {
    const user = await resolveUiUserContext(req, { allowNonMember: true })
    if (!user.authenticated || !user.clientId) return res.status(401).json({ error: 'Authenticated session required' })
    const clientId = user.clientId
    const supabase = createClient(url, key, { auth: { persistSession: false } })
    const inviteOnly = isInviteOnly()

    // 회원이 아닌 계정이 사용할 수 있는 동작: 상태 조회, 코드 가입, 가입 신청
    let member = await isMember(supabase, clientId)
    if (!member && inviteOnly) member = await admitIfApproved(supabase, clientId)
    if (!member && !inviteOnly) member = true // 초대 전용이 꺼져 있으면 로그인 즉시 가입 (기존 동작)

    const mode = String(req.query.mode || '')
    const body = (req.body || {}) as Record<string, unknown>
    const action = String(body.action || '')

    if (req.method === 'GET' && mode === 'status') {
      const { data: reqRow } = await supabase.from('web_signup_requests').select('status').eq('client_id', clientId).maybeSingle()
      if (!member) {
        const config = await readConfig(supabase)
        return res.status(200).json({
          data: { member: false, inviteOnly, signupsOpen: config.signupsOpen, request: reqRow?.status ?? null },
        })
      }
      return res.status(200).json({
        data: { member: true, inviteOnly, invites: inviteOnly ? await getMyInvites(supabase, clientId) : null },
      })
    }

    if (req.method === 'POST' && action === 'redeem') {
      if (member) return res.status(200).json({ ok: true, alreadyMember: true })
      // 부부 연결 코드(같은 형식)면 초대권 없이 가입하면서 바로 연결한다 (src/services/household.ts)
      if (await isCoupleCode(supabase, body.code)) {
        const couple = await redeemCoupleSignup(supabase, clientId, body.code)
        if (!couple.ok) return res.status(200).json({ ok: false, reason: couple.reason, error: COUPLE_REASON_MESSAGE[couple.reason] })
        return res.status(200).json({ ok: true, coupled: true })
      }
      const result = await redeemInvite(supabase, clientId, body.code)
      if (!result.ok) return res.status(200).json({ ok: false, reason: result.reason, error: REASON_MESSAGE[result.reason] })
      return res.status(200).json({ ok: true })
    }

    if (req.method === 'POST' && action === 'request') {
      if (member) return res.status(200).json({ ok: true, alreadyMember: true })
      const email = typeof body.email === 'string' ? body.email : null
      const note = typeof body.note === 'string' ? body.note.trim() : null
      const result = await submitSignupRequest(supabase, clientId, email, note)
      return res.status(200).json({ ok: true, status: result.status })
    }

    // ── 관리자 ─────────────────────────────────────────────────────────
    const access = await evaluateAdvancedAccess({ clientId, chatId: user.chatId })
    if (!access.isAdmin) return res.status(403).json({ error: 'Admin only' })

    if (req.method === 'GET' && mode === 'admin') {
      const [config, requestsRes, invitesRes, membersRes] = await Promise.all([
        readConfig(supabase),
        supabase.from('web_signup_requests').select('client_id,email,note,status,created_at').order('created_at', { ascending: false }).limit(200),
        supabase.from('web_invites').select('code,inviter_client_id,status,created_at,expires_at,used_by_client_id,used_at,rewarded_at').order('created_at', { ascending: false }).limit(500),
        supabase.from('web_user_profiles').select('client_id,nickname,invited_by_client_id,joined_via,created_at').order('created_at', { ascending: true }).limit(2000),
      ])
      return res.status(200).json({
        data: {
          inviteOnly,
          config,
          requests: requestsRes.data ?? [],
          invites: invitesRes.data ?? [],
          members: membersRes.data ?? [],
        },
      })
    }

    if (req.method === 'POST' && action === 'admin-issue') {
      const count = Math.min(10, Math.max(1, Math.trunc(Number(body.count) || 1)))
      const issued = await issueInvites(supabase, null, count)
      return res.status(200).json({ ok: true, codes: issued.map((r) => r.code) })
    }

    if (req.method === 'POST' && action === 'admin-decide') {
      const target = String(body.client_id || '').trim()
      if (!target) return res.status(400).json({ error: 'client_id required' })
      const approve = body.approve === true
      await supabase
        .from('web_signup_requests')
        .update({ status: approve ? 'approved' : 'rejected', decided_at: new Date().toISOString(), decided_by_client_id: clientId })
        .eq('client_id', target)
      return res.status(200).json({ ok: true })
    }

    if (req.method === 'POST' && action === 'admin-config') {
      const maxMembers = body.max_members === undefined ? undefined : Math.max(0, Math.trunc(Number(body.max_members) || 0))
      await writeConfig(supabase, {
        signupsOpen: body.signups_open === undefined ? undefined : body.signups_open === true,
        maxMembers: maxMembers === undefined ? undefined : (maxMembers > 0 ? maxMembers : null),
      })
      return res.status(200).json({ ok: true, config: await readConfig(supabase) })
    }

    if (req.method === 'POST' && action === 'admin-revoke') {
      const code = String(body.code || '').trim().toUpperCase()
      if (!code) return res.status(400).json({ error: 'code required' })
      await supabase.from('web_invites').update({ status: 'revoked' }).eq('code', code).eq('status', 'open')
      return res.status(200).json({ ok: true })
    }

    return res.status(405).json({ error: 'Method not allowed' })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
