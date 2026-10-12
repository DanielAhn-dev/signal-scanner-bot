import React from 'react'
import { DIVIDER } from './Divider'
import { buildNarrativeLine, flowNarrativeSignal, pegNarrativeSignal, shortNarrativeSignal } from '../lib/narrative'
import { toneStyle } from '../lib/styles'
import type { NarrativeSignal } from '../types'

export type SummarySectionProps = {
  result: any
  flow: any
  creditShort: any
}

export default function SummarySection({
  result,
  flow,
  creditShort,
}: SummarySectionProps) {
  return (
    <>
        {(() => {
          const pegSig = pegNarrativeSignal(result.peg ?? null)
          const flowSig = flowNarrativeSignal(flow?.institution ?? null, flow?.foreign ?? null)
          const shortSig = shortNarrativeSignal(creditShort?.shortRatio ?? null)
          if (!pegSig && !flowSig && !shortSig) return null
          const summaryLine = buildNarrativeLine(pegSig, flowSig, shortSig)
          const signals = [
            pegSig ? { title: '밸류에이션', sig: pegSig } : null,
            flowSig ? { title: '수급 방향', sig: flowSig } : null,
            shortSig ? { title: '공매도', sig: shortSig } : null,
          ].filter(Boolean) as Array<{ title: string; sig: NarrativeSignal }>
          return (
            <>
              {DIVIDER}
              <div className="title-md" style={{ marginBottom: 'var(--space-3)' }}>판단 근거 요약</div>
              <div className="cards-grid cols-3" style={{ marginBottom: summaryLine ? 'var(--space-3)' : undefined }}>
                {signals.map(({ title, sig }) => {
                  const s = toneStyle(sig.tone)
                  return (
                    <div key={title} style={{
                      background: s.bg,
                      border: `1px solid ${s.border}`,
                      borderRadius: 'var(--radius-md)',
                      padding: 'var(--space-3)',
                    }}>
                      <div className="stat-label" style={{ color: s.color, marginBottom: 'var(--space-1)' }}>{title}</div>
                      <div style={{ fontWeight: 'var(--font-weight-semibold)', fontSize: 'var(--font-size-base)', color: s.color }}>{sig.label}</div>
                      <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--color-text-secondary)', marginTop: 2 }}>{sig.detail}</div>
                    </div>
                  )
                })}
              </div>
              {summaryLine && (
                <div style={{
                  padding: 'var(--space-3)',
                  background: 'var(--color-bg-sunken)',
                  borderRadius: 'var(--radius-md)',
                  borderLeft: '3px solid var(--color-border-emphasis)',
                }}>
                  <div className="caption" style={{ color: 'var(--color-text-primary)', lineHeight: 1.7 }}>
                    {summaryLine}
                  </div>
                </div>
              )}
            </>
          )
        })()}
    </>
  )
}
