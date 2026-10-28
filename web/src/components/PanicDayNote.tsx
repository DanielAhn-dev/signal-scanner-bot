import React, { useMemo } from 'react'
import { panicNote, type PanicBar } from '../lib/panicDay'
import More from './ui/More'

/** 최근 4주 안에 크게 급락한 날(투매일)이 있었던 대형주에 보여 주는 참고 안내 (H84 ⓔ). 매매를 막지 않는다. */
export default function PanicDayNote({ bars }: { bars: PanicBar[] | null | undefined }) {
  const note = useMemo(() => (bars?.length ? panicNote(bars) : null), [bars])
  if (!note) return null
  return (
    <div
      role="note"
      style={{
        margin: 'var(--space-3, 12px) 0',
        padding: '10px 12px',
        borderRadius: 6,
        border: '1px solid var(--color-warning)',
        background: 'var(--color-warning-bg)',
        lineHeight: 1.55,
      }}
    >
      <div style={{ fontWeight: 700, color: 'var(--color-text-primary)' }}>{note.headline}</div>
      <div style={{ color: 'var(--color-text-primary)', marginTop: 2 }}>{note.detail}</div>
      <More label="근거와 한계">
        <div className="caption muted" style={{ marginTop: 4 }}>{note.fold}</div>
      </More>
    </div>
  )
}
