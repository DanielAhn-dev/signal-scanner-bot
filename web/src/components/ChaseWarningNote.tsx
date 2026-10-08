import React from 'react'
import { chaseWarning } from '../lib/chaseWarning'

/** 오늘 많이 오른 종목을 사기 전에 보여 주는 당일 추격 경고 (C34). 매매를 막지 않는다. */
export default function ChaseWarningNote({ changePct }: { changePct: number | null | undefined }) {
  const w = chaseWarning(changePct)
  if (!w) return null
  const strong = w.level === 'strong'
  return (
    <div
      role="note"
      style={{
        margin: 'var(--space-3, 12px) 0',
        padding: '10px 12px',
        borderRadius: 6,
        border: `1px solid var(${strong ? '--color-error' : '--color-warning'})`,
        background: `var(${strong ? '--color-error-bg' : '--color-warning-bg'})`,
        lineHeight: 1.55,
      }}
    >
      <div style={{ fontWeight: 700, color: 'var(--color-text-primary)' }}>{w.title}</div>
      <div style={{ color: 'var(--color-text-primary)', marginTop: 2 }}>{w.detail}</div>
      <div className="caption muted" style={{ marginTop: 4 }}>{w.source}</div>
    </div>
  )
}
