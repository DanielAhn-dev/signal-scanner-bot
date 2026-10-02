import React, { useCallback, useEffect, useMemo, useState } from 'react'
import Button from '../../components/ui/Button'
import { apiFetch } from '../../lib/api'
import { formatKstDateTime } from '../../lib/format'

type Admin = {
  inviteOnly: boolean
  config: { signupsOpen: boolean; maxMembers: number | null }
  requests: Array<{ client_id: string; email: string | null; note: string | null; status: string; created_at: string }>
  invites: Array<{ code: string; inviter_client_id: string | null; status: string; expires_at: string }>
  members: Array<{ client_id: string; nickname: string | null; invited_by_client_id: string | null; joined_via: string | null; created_at: string }>
}

const short = (id: string | null | undefined) => (id ? id.slice(0, 8) : '관리자')

/** 초대 현황·가입 신청 승인·가입 상한 — 관리자 전용 (사용자 관리 화면 안) */
export default function InviteAdminPanel() {
  const [data, setData] = useState<Admin | null>(null)
  const [msg, setMsg] = useState('')
  const [maxInput, setMaxInput] = useState('')
  const [issued, setIssued] = useState<string[]>([])

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/ui/invites?mode=admin', { cacheMs: 0, timeoutMs: 15_000 })
      setData(res?.data ?? null)
      setMaxInput(res?.data?.config?.maxMembers ? String(res.data.config.maxMembers) : '')
    } catch (e: any) { setMsg(e?.message || '불러오지 못했습니다.') }
  }, [])
  useEffect(() => { void load() }, [load])

  const post = async (body: Record<string, unknown>) => {
    setMsg('')
    try {
      const res = await apiFetch('/api/ui/invites', { method: 'POST', body: JSON.stringify(body), cacheMs: 0, retries: 0, timeoutMs: 15_000 })
      await load()
      return res
    } catch (e: any) { setMsg(e?.message || '실패했습니다.'); return null }
  }

  // 초대 트리: 누가 누구를 데려왔는지 (들여쓰기)
  const tree = useMemo(() => {
    const out: Array<{ id: string; name: string; depth: number; via: string | null }> = []
    if (!data) return out
    const byParent = new Map<string | null, Admin['members']>()
    const ids = new Set(data.members.map((m) => m.client_id))
    for (const m of data.members) {
      const parent = m.invited_by_client_id && ids.has(m.invited_by_client_id) ? m.invited_by_client_id : null
      byParent.set(parent, [...(byParent.get(parent) ?? []), m])
    }
    const walk = (parent: string | null, depth: number) => {
      for (const m of byParent.get(parent) ?? []) {
        out.push({ id: m.client_id, name: m.nickname || short(m.client_id), depth, via: m.joined_via })
        walk(m.client_id, depth + 1)
      }
    }
    walk(null, 0)
    return out
  }, [data])

  if (!data) return msg ? <p className="muted">{msg}</p> : null
  const pending = data.requests.filter((r) => r.status === 'pending')
  const openCount = data.invites.filter((i) => i.status === 'open' && new Date(i.expires_at).getTime() > Date.now()).length

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <label className="block muted">초대·가입 관리 {data.inviteOnly ? '' : '(초대 전용 모드 꺼짐 — 서버 UI_INVITE_ONLY)'}</label>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 8 }}>
        <Button variant={data.config.signupsOpen ? 'secondary' : 'primary'} onClick={() => void post({ action: 'admin-config', signups_open: !data.config.signupsOpen })}>
          {data.config.signupsOpen ? '신규 가입 멈추기' : '신규 가입 다시 열기'}
        </Button>
        <span className="muted">회원 {data.members.length}명 · 열린 초대권 {openCount}장 · 상한</span>
        <input className="ui-input ui-text" style={{ width: 90 }} placeholder="무제한" value={maxInput} onChange={(e) => setMaxInput(e.target.value.replace(/\D/g, ''))} />
        <Button variant="secondary" onClick={() => void post({ action: 'admin-config', max_members: Number(maxInput) || 0 })}>상한 저장</Button>
        <Button variant="secondary" onClick={async () => { const r = await post({ action: 'admin-issue', count: 1 }); if (r?.codes) setIssued(r.codes) }}>관리자 초대권 발급</Button>
      </div>
      {issued.length > 0 && <p style={{ marginTop: 8 }}>새 코드: {issued.map((c) => <code key={c} style={{ marginRight: 8 }}>{c}</code>)}</p>}
      {!!msg && <p style={{ color: 'var(--color-error)', marginTop: 8 }}>{msg}</p>}

      <h3 className="title-sm" style={{ marginTop: 16 }}>가입 신청 {pending.length}건 대기</h3>
      {pending.length === 0 ? <p className="muted">대기 중인 신청이 없습니다.</p> : pending.map((r) => (
        <div key={r.client_id} style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '6px 0', flexWrap: 'wrap' }}>
          <span>{r.email || short(r.client_id)}</span>
          <span className="muted" style={{ flex: 1 }}>{r.note || ''} · {formatKstDateTime(r.created_at)}</span>
          <Button variant="primary" onClick={() => void post({ action: 'admin-decide', client_id: r.client_id, approve: true })}>승인</Button>
          <Button variant="secondary" onClick={() => void post({ action: 'admin-decide', client_id: r.client_id, approve: false })}>거절</Button>
        </div>
      ))}

      <h3 className="title-sm" style={{ marginTop: 16 }}>초대 트리</h3>
      {tree.length === 0 ? <p className="muted">회원이 없습니다.</p> : (
        <div style={{ fontSize: 'var(--font-size-sm)' }}>
          {tree.map((n) => (
            <div key={n.id} style={{ paddingLeft: n.depth * 18 }}>
              {n.depth > 0 ? '└ ' : ''}{n.name} <span className="muted">({n.via === 'invite' ? '초대' : n.via === 'approved' ? '승인' : '기존'})</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
