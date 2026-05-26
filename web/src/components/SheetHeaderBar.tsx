import React from 'react'

type SheetHeaderBarProps = {
  title: React.ReactNode
  subtitle?: React.ReactNode
  action?: React.ReactNode
  className?: string
}

export default function SheetHeaderBar({ title, subtitle, action, className }: SheetHeaderBarProps) {
  const rootClassName = ['sheet-page-header', className].filter(Boolean).join(' ')

  return (
    <div className={rootClassName}>
      <div className="sheet-page-header__content">
        <div className="sheet-page-header__title">{title}</div>
        {subtitle && (
          <div className="sheet-page-header__subtitle">
            {subtitle}
          </div>
        )}
      </div>
      {action && <div className="sheet-page-header__actions">{action}</div>}
    </div>
  )
}