import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BOT_USAGE_NOTES, FLOW_STEPS } from '../navigation'
import { useProfileStore } from '../stores/profileStore'
import { useDetailed } from '../stores/viewModeStore'

const OPEN_KEY = (route: string) => `bot_usage_banner_open:${route}`

/** 처음 보는 화면만 펼치고, 이후엔 사용자가 마지막으로 둔 상태를 따른다 (브라우저별 편의 상태) */
function readOpen(route: string): boolean {
  try {
    const v = localStorage.getItem(OPEN_KEY(route))
    return v == null ? true : v === '1'
  } catch {
    return false
  }
}

function writeOpen(route: string, open: boolean) {
  try {
    localStorage.setItem(OPEN_KEY(route), open ? '1' : '0')
  } catch {
    /* 저장 불가 환경은 무시 */
  }
}

/** 접힌 상태에 보일 첫 문장 */
function firstSentence(note: string): string {
  const m = note.match(/^.*?\.(?=\s|$)/)
  return (m ? m[0] : note).trim()
}

/**
 * 모든 화면 상단: 흐름 단계 + 봇이 이 화면 정보를 매매에 어떻게 쓰는지.
 * 이미 아는 설명이 매번 화면을 차지하지 않도록 접을 수 있다 (한 번 본 화면은 기본 접힘).
 * 문구는 navigation.ts 의 BOT_USAGE_NOTES 한 곳에서 관리한다.
 */
export default function BotUsageBanner({ route }: { route: string }) {
  const [open, setOpen] = useState(() => readOpen(route))

  useEffect(() => {
    const initial = readOpen(route)
    setOpen(initial)
    // 첫 방문에 펼쳐 보여줬으면 다음부터는 접힌 채로 시작
    if (initial) writeOpen(route, false)
  }, [route])

  const isAdmin = useProfileStore((s) => s.isAdmin)
  const detailed = useDetailed()
  const note = BOT_USAGE_NOTES[route]
  // 봇 판단 근거는 관리자의 자세히 보기에서만 — 일반 사용자에게는 복잡하기만 하다
  if (!note || !isAdmin || !detailed) return null
  const step = FLOW_STEPS.find((s) => s.key === route)
  const next = step ? FLOW_STEPS.find((s) => s.step === step.step + 1) : undefined
  const summary = firstSentence(note)
  const hasMore = summary.length < note.length

  const toggle = () => {
    const nextOpen = !open
    setOpen(nextOpen)
    writeOpen(route, nextOpen)
  }

  return (
    <div
      role="note"
      style={{
        display: 'flex',
        flexShrink: 0,
        gap: 8,
        alignItems: 'baseline',
        flexWrap: open ? 'wrap' : 'nowrap',
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
      <button
        type="button"
        onClick={hasMore ? toggle : undefined}
        aria-expanded={hasMore ? open : undefined}
        style={{
          flex: 1,
          minWidth: open ? 200 : 0,
          padding: 0,
          border: 0,
          background: 'none',
          font: 'inherit',
          color: 'inherit',
          textAlign: 'left',
          cursor: hasMore ? 'pointer' : 'default',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: open ? 'normal' : 'nowrap',
        }}
      >
        {hasMore && (
          <span aria-hidden style={{ display: 'inline-block', width: 12, color: 'var(--color-text-tertiary)' }}>
            {open ? '▾' : '▸'}
          </span>
        )}
        <strong style={{ color: 'var(--color-text-primary)' }}>봇 연결</strong> · {open ? note : summary}
      </button>
      {next && (
        <Link to={`/${next.key}`} style={{ color: 'var(--color-brand)', whiteSpace: 'nowrap' }}>
          다음: {next.step} {next.label} →
        </Link>
      )}
    </div>
  )
}
