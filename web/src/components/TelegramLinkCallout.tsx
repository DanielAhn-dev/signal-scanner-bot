import React from 'react'

type Props = {
  title?: string
  description?: string
  actionLabel?: string
  onAction: () => void
}

export default function TelegramLinkCallout({
  title = '텔레그램 연동이 필요합니다',
  description = 'Chat ID를 연결하면 알림 전송과 텔레그램 연동 기능을 바로 사용할 수 있습니다.',
  actionLabel = 'Chat ID 연동하기',
  onAction,
}: Props) {
  return (
    <section className="card" style={{ textAlign: 'center', padding: '24px 16px' }}>
      <h3 className="title-md" style={{ marginBottom: '8px' }}>{title}</h3>
      <p className="muted" style={{ marginBottom: '16px' }}>{description}</p>
      <button className="ui-button ui-btn-primary" onClick={onAction}>{actionLabel}</button>
    </section>
  )
}
