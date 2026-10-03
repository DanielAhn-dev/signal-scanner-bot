import React from 'react'

/** 긴 해설은 접어 둔다 — 핵심 숫자와 경고만 먼저 보이게 한다 */
export default function More({ children, label = '자세히 보기' }: { children: React.ReactNode; label?: string }) {
  return (
    <details className="ui-more">
      <summary>{label}</summary>
      {children}
    </details>
  )
}
