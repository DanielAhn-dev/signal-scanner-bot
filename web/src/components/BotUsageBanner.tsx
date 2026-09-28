import { Link } from 'react-router-dom'
import { BOT_USAGE_NOTES, FLOW_STEPS } from '../navigation'

/**
 * 모든 화면 상단 한 줄: 흐름 단계 + 봇이 이 화면 정보를 매매에 어떻게 쓰는지.
 * 문구는 navigation.ts 의 BOT_USAGE_NOTES 한 곳에서 관리한다.
 */
export default function BotUsageBanner({ route }: { route: string }) {
  const note = BOT_USAGE_NOTES[route]
  if (!note) return null
  const step = FLOW_STEPS.find((s) => s.key === route)
  const next = step ? FLOW_STEPS.find((s) => s.step === step.step + 1) : undefined
  return (
    <div
      role="note"
      style={{
        display: 'flex',
        flexShrink: 0,
        gap: 8,
        alignItems: 'baseline',
        flexWrap: 'wrap',
        padding: '6px 12px',
        fontSize: 12,
        lineHeight: 1.5,
        color: 'var(--color-text-secondary)',
        background: 'var(--color-bg-sunken, rgba(0,0,0,0.03))',
        borderBottom: '1px solid var(--color-border-default)',
      }}
    >
      {step && (
        <strong style={{ color: 'var(--color-brand)', whiteSpace: 'nowrap' }}>
          {step.step}/{FLOW_STEPS.length} {step.label}
        </strong>
      )}
      <span style={{ flex: 1, minWidth: 200 }}>
        <strong style={{ color: 'var(--color-text-primary)' }}>봇 연결</strong> · {note}
      </span>
      {next && (
        <Link to={`/${next.key}`} style={{ color: 'var(--color-brand)', whiteSpace: 'nowrap' }}>
          다음: {next.step} {next.label} →
        </Link>
      )}
    </div>
  )
}
