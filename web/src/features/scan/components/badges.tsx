export function GradeBadge({ grade, label }: { grade: string | null | undefined; label?: string }) {
  if (!grade) return <span className="scan-grade-label">—</span>
  const g = String(grade).toUpperCase()
  const cls = g === 'A' ? 'scan-grade-a' : g === 'B' ? 'scan-grade-b' : g === 'C' ? 'scan-grade-c' : 'scan-grade-other'
  return (
    <span className="scan-grade-pair">
      {label && <span className="scan-grade-label">{label}</span>}
      <span className={`scan-grade-badge ${cls}`}>{g}</span>
    </span>
  )
}

export function WarnBadge({ grade }: { grade: string | null | undefined }) {
  if (!grade) return <span className="scan-grade-label">—</span>
  const g = String(grade).toUpperCase()
  const cls = g === 'SAFE' ? 'scan-warn-safe' : g === 'WATCH' ? 'scan-warn-watch' : g === 'WARN' ? 'scan-warn-warn' : 'scan-warn-default'
  const label = g === 'SAFE' ? '안전' : g === 'WATCH' ? '관찰' : g === 'WARN' ? '주의' : g
  return <span className={`scan-warn-badge ${cls}`}>{label}</span>
}

export function SignalBadge({ signal }: { signal: string | null | undefined }) {
  if (!signal) return null
  const s = String(signal).toUpperCase().trim()
  if (!s || s === 'NEUTRAL' || s === 'NONE') return null
  const cls = s === 'STRONG_BUY' ? 'scan-grade-a' : s === 'BUY' ? 'scan-grade-b' : s === 'WATCH' ? 'scan-grade-c' : 'scan-grade-other'
  const label = s === 'STRONG_BUY' ? '매수+' : s === 'BUY' ? '매수' : s === 'SELL' ? '매도' : s === 'WATCH' ? '관찰' : s
  return <span className={`scan-grade-badge ${cls}`} title="종합시그널">{label}</span>
}

export function AccumulationBadge({ stage }: { stage: 'lead' | 'breakout' | null | undefined }) {
  if (!stage) return null
  // 이격·저점근접·추세·경고 등급을 합산한 눌림 점수 배지. 차트의 박스권 매집 판정과는 다른 계산이다.
  const label = stage === 'breakout' ? '눌림 강함' : '눌림형'
  const title = '이격·저점근접·추세·경고 등급 합산 눌림 점수 (거래량 기반 매집 판정 아님)'
  return (
    <span
      className="scan-grade-badge scan-grade-b"
      title={title}
      style={{ background: 'rgba(34,197,94,0.10)', color: 'var(--color-success)', borderColor: 'rgba(34,197,94,0.22)' }}
    >
      {label}
    </span>
  )
}
