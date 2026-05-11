import React, { useState } from 'react'
import Button from '../../components/ui/Button'
import { useToast } from '../../components/ToastProvider'

export default function AlertsPage() {
  const [message, setMessage] = useState('테스트 알림입니다. Nexora Web에서 전송됩니다.')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const toast = useToast()

  const send = async () => {
    if (!message.trim()) return
    setSending(true)
    setResult(null)
    try {
      const uiKey = import.meta.env.VITE_UI_READ_KEY || ''
      const res = await fetch('/api/ui/notify', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-ui-key': uiKey },
        body: JSON.stringify({ message }),
      })
      const json = await res.json()
      if (res.ok && json?.ok) {
        toast.show('알림 전송 완료 ✓')
        setResult('✓ 텔레그램으로 전송되었습니다')
      } else {
        setResult(String(json?.error || '전송 실패'))
      }
    } catch (e: any) {
      setResult(String(e?.message || e))
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="container-app">
      <h1 className="title-xl">알림 테스트</h1>

      <div className="card">
        <div className="muted mb-4" style={{ marginBottom: 'var(--space-3)' }}>
          텔레그램 <code>/alert</code>에 대응합니다. 아래 메시지를 텔레그램으로 전송합니다.
        </div>

        <div style={{ marginBottom: 'var(--space-3)' }}>
          <label className="ui-label">알림 메시지</label>
          <textarea
            className="ui-textarea"
            rows={4}
            value={message}
            onChange={e => setMessage(e.target.value)}
            style={{ width: '100%', padding: 'var(--space-2) var(--space-3)', border: '1px solid var(--color-border-default)', borderRadius: 'var(--radius-xs)', fontSize: 'var(--font-size-sm)', resize: 'vertical' }}
          />
        </div>

        <Button variant="primary" onClick={send} disabled={sending || !message.trim()}>
          {sending ? '전송 중…' : '텔레그램으로 전송'}
        </Button>

        {result && (
          <div className="muted mt-2" style={{ marginTop: 'var(--space-3)', fontSize: 'var(--font-size-sm)', color: result.startsWith('✓') ? 'var(--color-success)' : 'var(--color-error)' }}>
            {result}
          </div>
        )}
      </div>
    </section>
  )
}
