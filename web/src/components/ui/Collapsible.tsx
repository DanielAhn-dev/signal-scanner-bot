import React from 'react'

type Props = {
  title: string
  /** 접힌 상태에서 제목 옆에 보이는 한 줄 안내 (펼칠지 판단하는 데 쓴다) */
  hint?: string
  defaultOpen?: boolean
  className?: string
  children: React.ReactNode
}

/** 자주 안 쓰는 설정·긴 설명을 접어 두는 카드. 기본은 접힘 */
export default function Collapsible({ title, hint, defaultOpen = false, className = '', children }: Props) {
  return (
    <details className={`card collapsible${className ? ` ${className}` : ''}`} open={defaultOpen}>
      <summary className="collapsible__summary">
        <span className="title-md">{title}</span>
        {hint ? <span className="muted collapsible__hint">{hint}</span> : null}
      </summary>
      <div className="collapsible__body">{children}</div>
    </details>
  )
}
