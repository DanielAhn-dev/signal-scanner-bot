import React, { useEffect, useState } from 'react'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import Checkbox from '../../components/ui/Checkbox'
import { apiFetch } from '../../lib/api'
import { getCurrentUserChatId } from '../../lib/userContext'

export default function Settings(){
  const [chatId, setChatId] = useState<string>('')
  const [message, setMessage] = useState<string>('테스트 알림입니다.')
  const [status, setStatus] = useState<string|undefined>()
  const [loading, setLoading] = useState(false)

  const [settings, setSettings] = useState<any | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    (async () => {
      try {
        const chat = getCurrentUserChatId()
        setChatId(chat)
        const json = await apiFetch('/api/ui/settings', { cacheMs: 0, timeoutMs: 10_000 })
        setSettings(json?.data ?? null)
      } catch (e) {
        // ignore
      }
    })()
  }, [])

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
        chat_id: chatId,
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
        <div className="card">
          <Input label="기본 Telegram 채팅 ID" value={chatId} onChange={(e:any) => setChatId(e.target.value)} placeholder="예: 123456789" />
          <div className="text-xs muted mt-2">참고: 서버에 `DEFAULT_TELEGRAM_CHAT_ID`가 설정되어 있으면 기본값으로 불러옵니다.</div>
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
      </div>
    </section>
  )
}
