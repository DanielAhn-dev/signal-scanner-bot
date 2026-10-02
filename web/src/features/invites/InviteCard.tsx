import React, { useCallback, useEffect, useState } from 'react'
import { useToast } from '../../components/ToastProvider'
import { apiFetch } from '../../lib/api'
import { buildInviteLink } from '../../lib/inviteStash'
import { formatKstDateTime } from '../../lib/format'

type MyInvites = {
  open: Array<{ code: string; expiresAt: string }>
  invited: Array<{ joinedAt: string; activated: boolean; activatesAt: string }>
  nextRefillAt: string | null
  maxOpen: number
  ttlDays: number
  activationDays: number
}

/** 내 초대권 — 초대 전용 모드에서만 서버가 내용을 준다 (꺼져 있으면 카드를 숨긴다) */
export default function InviteCard() {
  const toast = useToast()
  const [info, setInfo] = useState<MyInvites | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await apiFetch('/api/ui/invites?mode=status', { cacheMs: 0, timeoutMs: 10_000 })
      setInfo(res?.data?.member ? (res.data.invites ?? null) : null)
    } catch { setInfo(null) }
  }, [])
  useEffect(() => { void load() }, [load])

  if (!info) return null

  const share = async (code: string) => {
    const link = buildInviteLink(code)
    try {
      if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) {
        await navigator.share({ title: 'Nexora 초대', text: `Nexora 초대 링크예요. 코드: ${code}`, url: link })
      } else {
        await navigator.clipboard.writeText(link)
        toast.show('초대 링크를 복사했어요')
      }
    } catch { /* 공유 취소 */ }
  }

  const pending = info.invited.filter((i) => !i.activated)
  return (
    <section className="profile-section">
      <div className="profile-section-title">친구 초대</div>
      {info.open.length === 0 ? (
        <p className="muted">
          지금 보낼 수 있는 초대권이 없어요.
          {info.nextRefillAt ? ` ${formatKstDateTime(info.nextRefillAt).slice(0, 10)} 이후 새 초대권이 생겨요.` : ''}
        </p>
      ) : (
        info.open.map((inv) => (
          <div key={inv.code} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <code style={{ fontSize: 'var(--font-size-lg)', letterSpacing: '0.1em' }}>{inv.code}</code>
            <span className="muted" style={{ flex: 1 }}>{formatKstDateTime(inv.expiresAt).slice(0, 10)}까지</span>
            <button className="ui-button ui-btn-secondary" onClick={() => void share(inv.code)}>링크 보내기</button>
          </div>
        ))
      )}
      <p className="profile-hint">
        초대권은 1회용이고 {info.ttlDays}일 뒤 사라져요. 초대한 친구가 가입하고 {info.activationDays}일 넘게 쓰면서 시작 설정을 마치면 초대권이 하나 더 생겨요
        (최대 {info.maxOpen}장까지 보관).
        {pending.length > 0 ? ` 지금 ${pending.length}명이 아직 활동 확인 중이에요.` : ''}
      </p>
    </section>
  )
}
