import React, { useEffect, useState } from 'react'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import Checkbox from '../../components/ui/Checkbox'
import { apiFetch } from '../../lib/api'
import TelegramLinkCallout from '../../components/TelegramLinkCallout'
import { requestOpenProfileModal } from '../../lib/profileModal'
import { useCurrentChatId } from '../../stores/profileStore'

export default function Settings(){
  const currentChatId = useCurrentChatId()
  const [chatId, setChatId] = useState<string>('')
  const [message, setMessage] = useState<string>('테스트 알림입니다.')
  const [status, setStatus] = useState<string|undefined>()
  const [loading, setLoading] = useState(false)

  const [settings, setSettings] = useState<any | null>(null)
  const [saving, setSaving] = useState(false)
  const [accessInfo, setAccessInfo] = useState<{ chat_id: number | null; is_admin: boolean; has_advanced_access: boolean } | null>(null)
  const [accessRows, setAccessRows] = useState<Array<{ chat_id: number; nickname?: string | null; note?: string | null; is_enabled?: boolean | null; updated_at?: string | null }>>([])
  const [adminLoading, setAdminLoading] = useState(false)
  const [adminTargetChatId, setAdminTargetChatId] = useState('')
  const [adminNickname, setAdminNickname] = useState('')
  const [adminNote, setAdminNote] = useState('')

  useEffect(() => {
    setChatId((prev) => (prev === currentChatId ? prev : currentChatId))
  }, [currentChatId])

  useEffect(() => {
    (async () => {
      try {
        const json = await apiFetch('/api/ui/settings', { cacheMs: 0, timeoutMs: 10_000 })
        setSettings(json?.data ?? null)
      } catch (e) {
        // ignore
      }

      try {
        const me = await apiFetch('/api/ui/access-users?mode=me', { cacheMs: 0, timeoutMs: 10_000 })
        const info = me?.data ?? null
        setAccessInfo(info)
        if (info?.is_admin) {
          const list = await apiFetch('/api/ui/access-users', { cacheMs: 0, timeoutMs: 10_000 })
          setAccessRows(Array.isArray(list?.data) ? list.data : [])
        }
      } catch {
        // ignore
      }
    })()
  }, [])

  const refreshAccessRows = async () => {
    if (!accessInfo?.is_admin) return
    const list = await apiFetch('/api/ui/access-users', { cacheMs: 0, timeoutMs: 10_000 })
    setAccessRows(Array.isArray(list?.data) ? list.data : [])
  }

  const upsertAccessUser = async () => {
    const normalized = String(adminTargetChatId || '').trim().replace(/[^0-9]/g, '')
    if (!normalized) {
      setStatus('관리 대상 Chat ID를 입력해 주세요.')
      return
    }
    setAdminLoading(true)
    try {
      await apiFetch('/api/ui/access-users', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 10_000,
        body: JSON.stringify({
          chat_id: Number(normalized),
          nickname: adminNickname.trim() || undefined,
          note: adminNote.trim() || undefined,
          is_enabled: true,
        }),
      })
      setStatus('고급 기능 사용자 저장 완료')
      setAdminTargetChatId('')
      setAdminNickname('')
      setAdminNote('')
      await refreshAccessRows()
    } catch (e: any) {
      setStatus(String(e?.message || e))
    } finally {
      setAdminLoading(false)
    }
  }

  const toggleAccessUser = async (targetChatId: number, nextEnabled: boolean) => {
    setAdminLoading(true)
    try {
      await apiFetch('/api/ui/access-users', {
        method: 'PATCH',
        cacheMs: 0,
        timeoutMs: 10_000,
        body: JSON.stringify({ chat_id: targetChatId, is_enabled: nextEnabled }),
      })
      setStatus(`고급 기능 ${nextEnabled ? '허용' : '차단'} 완료`)
      await refreshAccessRows()
    } catch (e: any) {
      setStatus(String(e?.message || e))
    } finally {
      setAdminLoading(false)
    }
  }

  const removeAccessUser = async (targetChatId: number) => {
    setAdminLoading(true)
    try {
      await apiFetch('/api/ui/access-users', {
        method: 'DELETE',
        cacheMs: 0,
        timeoutMs: 10_000,
        body: JSON.stringify({ chat_id: targetChatId }),
      })
      setStatus('고급 기능 사용자 삭제 완료')
      await refreshAccessRows()
    } catch (e: any) {
      setStatus(String(e?.message || e))
    } finally {
      setAdminLoading(false)
    }
  }

  const sendTest = async () => {
    setStatus(undefined)
    setLoading(true)
    try {
      const json = await apiFetch('/api/ui/notify', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 10_000,
        body: JSON.stringify({ chat_id: chatId || undefined, message })
      })
      if (json?.error) setStatus(String(json?.error || '전송 실패'))
      else setStatus('전송 성공')
    } catch (e: any) {
      setStatus(String(e))
    } finally {
      setLoading(false)
    }
  }

  const saveSettings = async () => {
    setSaving(true)
    try {
      const payload = {
        chat_id: chatId || undefined,
        is_enabled: !!settings?.is_enabled,
        monday_buy_slots: Number(settings?.monday_buy_slots || 2),
        max_positions: Number(settings?.max_positions || 10),
        min_buy_score: Number(settings?.min_buy_score || 72),
        take_profit_pct: Number(settings?.take_profit_pct || 8),
        stop_loss_pct: Number(settings?.stop_loss_pct || 4),
        long_term_ratio: Number(settings?.long_term_ratio ?? 70),
      }
      const json = await apiFetch('/api/ui/settings', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 10_000,
        body: JSON.stringify(payload)
      })
      if (json?.error) setStatus(String(json?.error || '저장 실패'))
      else {
        setStatus('저장 성공')
        setSettings(json.data)
      }
    } catch (e: any) {
      setStatus(String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="container-app">
      <h1 className="title-xl">설정 / 알림</h1>
      <div className="cards-list">
        {!chatId && (
          <TelegramLinkCallout
            description="Chat ID를 연결하면 테스트 알림과 텔레그램 연동 기능을 바로 사용할 수 있습니다."
            onAction={() => requestOpenProfileModal()}
          />
        )}

        <div className="card">
          <Input label="Telegram Chat ID (선택)" value={chatId} onChange={(e:any) => setChatId(e.target.value)} placeholder="예: 123456789" />
          <div className="text-xs muted mt-2">웹 기본 기능에는 필수가 아닙니다. 알림 전송/텔레그램 연동 기능에만 사용됩니다.</div>
          <div className="text-xs muted mt-2">참고: 서버에 `DEFAULT_TELEGRAM_CHAT_ID`가 설정되어 있으면 기본값으로 불러옵니다.</div>
          <div className="text-xs muted mt-2">
            현재 권한: {accessInfo?.has_advanced_access ? '고급 기능 사용 가능' : '일반 기능만 사용 가능'}
            {accessInfo?.is_admin ? ' (관리자)' : ''}
          </div>
          {accessInfo?.is_admin && (
            <div className="mt-2">
              <Button
                variant="secondary"
                onClick={() => {
                  try {
                    window.location.hash = 'admin-users'
                  } catch {
                    // ignore
                  }
                }}
              >
                사용자 관리 페이지 열기
              </Button>
            </div>
          )}
        </div>

        <div className="card">
          <label className="block muted">가상 자동매매 설정</label>
          <div className="mt-2">
            <Checkbox label="활성화" checked={!!settings?.is_enabled} onChange={(v) => setSettings({...settings, is_enabled: v})} />
          </div>
          <div className="mt-2 grid-two">
            <div>
              <Input label="월요일 매수 슬롯" type="number" value={settings?.monday_buy_slots ?? 2} onChange={(e:any) => setSettings({...settings, monday_buy_slots: Number(e.target.value)})} />
            </div>
            <div>
              <Input label="최대 포지션 수" type="number" value={settings?.max_positions ?? 10} onChange={(e:any) => setSettings({...settings, max_positions: Number(e.target.value)})} />
            </div>
          </div>
          <div className="mt-2 grid-two">
            <div>
              <Input label="최소 매수 점수" type="number" value={settings?.min_buy_score ?? 72} onChange={(e:any) => setSettings({...settings, min_buy_score: Number(e.target.value)})} />
            </div>
            <div>
              <Input label="장기 비중(%)" type="number" value={settings?.long_term_ratio ?? 70} onChange={(e:any) => setSettings({...settings, long_term_ratio: Number(e.target.value)})} />
            </div>
          </div>
          <div className="mt-2 grid-two">
            <div>
              <Input label="익절(%)" type="number" value={settings?.take_profit_pct ?? 8} onChange={(e:any) => setSettings({...settings, take_profit_pct: Number(e.target.value)})} />
            </div>
            <div>
              <Input label="손절(%)" type="number" value={settings?.stop_loss_pct ?? 4} onChange={(e:any) => setSettings({...settings, stop_loss_pct: Number(e.target.value)})} />
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <Button onClick={saveSettings} disabled={saving} variant="primary">{saving ? '저장중…' : '저장'}</Button>
            {status && <div className="muted">{status}</div>}
          </div>
        </div>

        <div className="card">
          <label className="block muted">테스트 알림</label>
          <div className="mt-2">
            <label className="block text-sm">테스트 메시지</label>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} className="mt-1 w-full p-2 border rounded h-24" />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <Button onClick={sendTest} disabled={loading} variant="secondary">{loading ? '전송중…' : '테스트 전송'}</Button>
            {status && <div className="muted">{status}</div>}
          </div>
        </div>

        {accessInfo?.is_admin && (
          <div className="card">
            <label className="block muted">고급 기능 사용자 관리 (관리자)</label>
            <div className="mt-2 grid-two">
              <Input label="대상 Chat ID" value={adminTargetChatId} onChange={(e:any) => setAdminTargetChatId(e.target.value)} placeholder="예: 123456789" />
              <Input label="닉네임(선택)" value={adminNickname} onChange={(e:any) => setAdminNickname(e.target.value)} placeholder="예: 운영팀" />
            </div>
            <div className="mt-2">
              <Input label="메모(선택)" value={adminNote} onChange={(e:any) => setAdminNote(e.target.value)} placeholder="권한 부여 사유" />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <Button onClick={upsertAccessUser} disabled={adminLoading} variant="primary">
                {adminLoading ? '처리중…' : '추가/갱신'}
              </Button>
            </div>

            <div className="mt-3" style={{ overflowX: 'auto' }}>
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '8px 6px' }}>Chat ID</th>
                    <th style={{ textAlign: 'left', padding: '8px 6px' }}>닉네임</th>
                    <th style={{ textAlign: 'left', padding: '8px 6px' }}>메모</th>
                    <th style={{ textAlign: 'left', padding: '8px 6px' }}>상태</th>
                    <th style={{ textAlign: 'left', padding: '8px 6px' }}>작업</th>
                  </tr>
                </thead>
                <tbody>
                  {accessRows.map((row) => (
                    <tr key={row.chat_id}>
                      <td style={{ padding: '8px 6px' }}>{row.chat_id}</td>
                      <td style={{ padding: '8px 6px' }}>{row.nickname || '-'}</td>
                      <td style={{ padding: '8px 6px' }}>{row.note || '-'}</td>
                      <td style={{ padding: '8px 6px' }}>{row.is_enabled ? '허용' : '차단'}</td>
                      <td style={{ padding: '8px 6px', display: 'flex', gap: 8 }}>
                        <Button
                          variant="secondary"
                          disabled={adminLoading}
                          onClick={() => toggleAccessUser(row.chat_id, !row.is_enabled)}
                        >
                          {row.is_enabled ? '차단' : '허용'}
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={adminLoading}
                          onClick={() => removeAccessUser(row.chat_id)}
                        >
                          삭제
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {accessRows.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ padding: '10px 6px' }} className="muted">등록된 고급 기능 사용자가 없습니다.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
