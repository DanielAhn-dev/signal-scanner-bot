import React from 'react'

type SheetHeaderBarProps = {
  title: React.ReactNode
  subtitle?: React.ReactNode
  action?: React.ReactNode
  className?: string
}

export default function SheetHeaderBar({ title, subtitle, action, className }: SheetHeaderBarProps) {
  return (
    <div
      className={className}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-3)',
        flexWrap: 'wrap',
        width: '100%',
      }}
    >
      <div style={{ minWidth: 0, flex: '1 1 auto' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-brand)' }}>{title}</div>
        {subtitle && (
          <div style={{ marginTop: 4, color: 'var(--color-text-secondary)', fontSize: 11, lineHeight: 1.45 }}>
            {subtitle}
          </div>
        )}
      </div>
      {action && <div style={{ flexShrink: 0 }}>{action}</div>}
    </div>
  )
}