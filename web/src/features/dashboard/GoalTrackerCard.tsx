import React, { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../../lib/api'
import Button from '../../components/ui/Button'
import { useCurrentChatId } from '../../stores/profileStore'

type View = {
  today: string
  settings: {
    startDate: string
    startEquity: number
    planAnnualPct: number
    withdrawalPct?: number
    targetMonthlyProfit: number
    monthlyContribution: number
    targetDate?: string
  }
  equity: number
  plan: { monthsElapsed: number; planValue: number; gapPct: number }
  target: { requiredSeed: number; progressPct: number; monthsToReach: number | null; etaMonth: string | null }
  thisMonth: {
    expectedProfit: number
    returnPct: number | null
    realizedSwing: number
    realizedSweep: number
    sells: number
    wins: number
    assessment: { level: string; text: string } | null
  }
  phase: { stage: 1 | 2; title: string; text: string }
  currentMonthlyProfit: number
  currentMonthlyWithdrawal: number
  schedule: Array<{ month: string; months: number; contribution: number; isTarget: boolean }>
  normalRange: { plusMonthsPct: number; p10: number; worst: number; maxLosingStreak: number; source: string }
}

const man = (v: number) => `${Math.round(v / 10_000).toLocaleString('ko-KR')}만원`
const signed = (v: number) => `${v >= 0 ? '+' : ''}${man(v)}`

/**
 * 목표 트래커 — 시드로 스윙 월 평균 수익을 내고, 수익은 재투자해 필요 시드까지 키운다.
 * 계산은 src/services/goalTracker.ts (금요일 텔레그램 보고와 같은 값). 매매 로직과는 무관하다.
 */
export default function GoalTrackerCard() {
  const chatId = useCurrentChatId()
  const [view, setView] = useState<View | null>(null)
  const [reason, setReason] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ targetMan: '', planPct: '', withdrawPct: '', contribMan: '', targetDate: '' })
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const load = useCallback(async (init?: { method: string; body: string }): Promise<boolean> => {
    try {
      const res = await apiFetch('/api/ui/goal-tracker', { cacheMs: 0, timeoutMs: 15_000, ...(init ?? {}) })
      setView(res?.data ?? null)
      setReason(res?.data ? null : res?.reason ?? res?.error ?? null)
      return Boolean(res?.data)
    } catch (e: unknown) {
      setReason(e instanceof Error ? e.message : String(e))
      return false
    }
  }, [])

  // 프로필 스토어 hydration 전에 부르면 chat_id 없이 400이 난다
  useEffect(() => {
    if (chatId) void load()
  }, [chatId, load])

  const startEdit = () => {
    if (!view) return
    setForm({
      targetMan: String(Math.round(view.settings.targetMonthlyProfit / 10_000)),
      planPct: String(view.settings.planAnnualPct),
      withdrawPct: String(view.settings.withdrawalPct ?? 4),
      contribMan: String(Math.round(view.settings.monthlyContribution / 10_000)),
      targetDate: view.settings.targetDate ?? '',
    })
    setSaveError(null)
    setEditing(true)
  }

  const save = async () => {
    setBusy(true)
    setSaveError(null)
    const ok = await load({
      method: 'POST',
      body: JSON.stringify({
        targetMonthlyProfit: Number(form.targetMan) * 10_000,
        planAnnualPct: Number(form.planPct),
        withdrawalPct: Number(form.withdrawPct),
        monthlyContribution: Number(form.contribMan) * 10_000,
        targetDate: form.targetDate,
      }),
    })
    setBusy(false)
    // 실패하면 편집을 닫지 않는다 — 닫으면 옛 값이 그대로 보여 저장된 것처럼 착각한다
    if (ok) setEditing(false)
    else setSaveError('저장하지 못했습니다. 잠시 뒤 다시 시도하세요.')
  }

  const box: React.CSSProperties = {
    margin: '8px 12px',
    padding: 12,
    border: '1px solid var(--color-border-default)',
    borderRadius: 6,
    fontSize: 12,
    lineHeight: 1.6,
    background: 'var(--color-bg-elevated, transparent)',
  }
  if (!view) return reason ? <div style={box}>목표 트래커: {reason}</div> : null

  const t = view.thisMonth
  const levelColor =
    t.assessment?.level === 'good'
      ? 'var(--color-stock-up)'
      : t.assessment?.level === 'rare'
        ? 'var(--color-error)'
        : 'var(--color-text-secondary)'
  const inputStyle: React.CSSProperties = { width: 80, marginRight: 8 }

  return (
    <div style={box}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <strong>
          목표: 월 {man(view.settings.targetMonthlyProfit)} 인출(연 {view.settings.withdrawalPct ?? 4}%) → 필요 시드{' '}
          {man(view.target.requiredSeed)}
        </strong>
        {!editing && (
          <Button size="sm" variant="secondary" onClick={startEdit}>
            목표 설정
          </Button>
        )}
      </div>

      {editing && (
        <div style={{ margin: '6px 0', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
          목표 월 인출(만원)
          <input style={inputStyle} value={form.targetMan} onChange={(e) => setForm({ ...form, targetMan: e.target.value })} />
          계획 연 수익률(%)
          <input style={inputStyle} value={form.planPct} onChange={(e) => setForm({ ...form, planPct: e.target.value })} />
          인출률(%)
          <input style={inputStyle} value={form.withdrawPct} onChange={(e) => setForm({ ...form, withdrawPct: e.target.value })} />
          월 추가 입금(만원)
          <input style={inputStyle} value={form.contribMan} onChange={(e) => setForm({ ...form, contribMan: e.target.value })} />
          필요 시드 도달 목표 시점
          <input
            type="month"
            style={{ ...inputStyle, width: 130 }}
            value={form.targetDate}
            onChange={(e) => setForm({ ...form, targetDate: e.target.value })}
          />
          <Button size="sm" disabled={busy} onClick={() => void save()}>
            저장
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            취소
          </Button>
          {saveError && <div style={{ width: '100%', color: 'var(--color-error)' }}>{saveError}</div>}
          <div style={{ width: '100%', color: 'var(--color-text-tertiary)' }}>
            계획 수익률은 시드를 모으는 동안의 성장 가정입니다 — 검증된 규칙의 과거 수익은 연 10~13%, 기본 8%는 그보다 낮춘 값(1~15%).
            인출률은 원금을 지키며 매년 꺼내 쓸 비율로 필요 시드를 정합니다 — 코스피 30년 데이터에서 물가 반영 20년 인출 시 원금 유지 비율이
            4% 87% · 5% 68% · 6% 50%라 기본 4%(2~8%). 고배당 ETF 배당률도 4~5%대입니다.
          </div>
        </div>
      )}

      <div style={{ margin: '4px 0' }}>
        <strong>{view.phase.title}</strong> — {view.phase.text}
      </div>
      <div>
        현재 {man(view.equity)} · 달성 {view.target.progressPct.toFixed(0)}% · 예상 도달 {view.target.etaMonth ?? '50년 이상'}
        {' '}(연 {view.settings.planAnnualPct}% 재투자{view.settings.monthlyContribution > 0 ? ` + 월 ${man(view.settings.monthlyContribution)} 입금` : ''})
      </div>
      <div>
        계획선 {man(view.plan.planValue)} 대비{' '}
        <span style={{ color: view.plan.gapPct >= 0 ? 'var(--color-stock-up)' : 'var(--color-stock-down)' }}>
          {view.plan.gapPct >= 0 ? '+' : ''}
          {view.plan.gapPct.toFixed(1)}%
        </span>
        {' '}· 시작 {view.settings.startDate} {man(view.settings.startEquity)}
      </div>
      <div>
        이번 달 {t.returnPct == null ? '기록 쌓는 중' : `${t.returnPct >= 0 ? '+' : ''}${t.returnPct.toFixed(1)}%`} · 계획 월 평균 {man(t.expectedProfit)} ·
        스윙 확정 {signed(t.realizedSwing)}({t.sells}건 중 익절 {t.wins}) · 지수·현금 스윕 {signed(t.realizedSweep)}
      </div>
      {t.assessment && <div style={{ color: levelColor }}>{t.assessment.text}</div>}
      {view.schedule.length > 0 && (
        <div style={{ marginTop: 4 }}>
          지금 시드로는 계획상 월 평균 {man(view.currentMonthlyProfit)} 수익(재투자), 원금을 지키며 꺼내 쓰면 월{' '}
          {man(view.currentMonthlyWithdrawal)}. 필요 시드 {man(view.target.requiredSeed)}에 닿으려면 매달 넣어야
          할 금액(연 {view.settings.planAnnualPct}% 재투자 가정):
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px' }}>
            {view.schedule.map((r) => (
              <span key={r.months} style={r.isTarget ? { fontWeight: 600, color: 'var(--color-text-primary)' } : undefined}>
                {r.month}({r.months % 12 === 0 ? `${r.months / 12}년` : `${r.months}개월`}
                {r.isTarget ? ' · 목표' : ''}) 월 {man(r.contribution)}
              </span>
            ))}
          </div>
        </div>
      )}
      <div style={{ color: 'var(--color-text-tertiary)', marginTop: 4 }}>
        매달 고르게 나오지 않습니다 — {view.normalRange.source}: 플러스 달 {view.normalRange.plusMonthsPct}%, 10달 중 1달은{' '}
        {view.normalRange.p10}% 이하, 마이너스 달 최장 {view.normalRange.maxLosingStreak}개월 연속. 누적으로 계획선을 따라가는지를 보세요.
      </div>
    </div>
  )
}
