import React from 'react'
import { Inbox } from 'lucide-react'

interface EmptyStateProps {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
}

export function EmptyState({ icon = <Inbox size={36} strokeWidth={1.5} />, title, description, action }: EmptyStateProps) {
  return (
    <div className="state-empty">
      <div className="state-empty-icon">{icon}</div>
      <div className="state-empty-title">{title}</div>
      {description && <div className="state-empty-desc">{description}</div>}
      {action}
    </div>
  )
}

interface ErrorStateProps {
  message: string
  onRetry?: () => void
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="state-error">
      <div className="state-error-title">오류가 발생했습니다</div>
      <div style={{ fontSize: 'var(--font-size-sm)' }}>{message}</div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="ui-button ui-btn-primary"
          style={{ marginTop: 'var(--space-2)', alignSelf: 'flex-start' }}
        >
          재시도
        </button>
      )}
    </div>
  )
}
