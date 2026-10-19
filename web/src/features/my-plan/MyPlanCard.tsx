import React, { useEffect, useRef, useState } from 'react'
import AccountTag from '../../components/ui/AccountTag'
import { ChevronRight, Pencil } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { stockCapFor } from '../../lib/planGuide'
import { recordSwitch } from '../../lib/switchHistory'
import { useCurrentChatId, useProfileStore } from '../../stores/profileStore'
import './my-plan.css'

/**
 * 모아가기 화면 "내 계획" (2026-10-19 홈에서 옮김, 홈은 "내 모으기" 요약) — 방향(매달 투자할 돈·넣는 날·버틸 하락폭·개별주 몫)을 바꾸는 유일한 곳.
 * 실험(가상) 계좌는 이 계획을 그대로 따른다. 실제 계좌에는 입금·자동매매를 걸지 않는다.
 * 저장은 /api/ui/investment-prefs의 plan 하나로만 한다 (src/services/userPlan.ts).
 */
type Satellite = 0 | 10 | 100
type Plan = { monthly: number; payday: number | null; depositDay: number; tolerancePct: number | null; satellitePct: Satellite }
type DepositInfo = { next_deposit_date: string | null; total_deposited: number | null; deposit_log: Array<{ date: string; amount: number }> }

const TOLERANCES = [10, 15, 20, 25, 30, 40, 50] as const
const man = (won: number) => `${(won / 10_000).toLocaleString('ko-KR')}만원`
/** 급여일 다음 날, 28일을 넘으면 다음 달 1일 — 서버 depositDayFromPayday와 같은 규칙 */
const dayAfter = (payday: number) => (payday + 1 > 28 ? 1 : payday + 1)

function summary(plan: Plan): string {
  const parts = [plan.monthly > 0 ? `매달 ${plan.depositDay}일 ${man(plan.monthly)}` : '매달 적립 안 함']
  if (plan.tolerancePct != null) parts.push(`버틸 하락 −${plan.tolerancePct}% (주식 ${stockCapFor(plan.tolerancePct).recommended}%부터)`)
  parts.push(plan.satellitePct === 0 ? '지수만' : plan.satellitePct === 100 ? '실험: 종목 봇 전체' : `개별주 ${plan.satellitePct}%까지`)
  return parts.join(' · ')
}

/** 목표 진행 — 대시보드가 이미 불러온 목표 트래커 값을 넘긴다 (같은 요청을 두 번 하지 않게) */
export type PlanGoal = { progressPct: number; gapPct: number }

/** onPlanMonthly: 계획을 읽거나 저장할 때마다 매달 금액을 알린다 — 모아가기 계산기 처음 값이 계획과 같게 */
export default function MyPlanCard({ goal, onPlanMonthly }: { goal?: PlanGoal | null; onPlanMonthly?: (monthly: number) => void }) {
  const navigate = useNavigate()
  const chatId = useCurrentChatId()
  const isAdmin = useProfileStore((st) => st.isAdmin)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [deposit, setDeposit] = useState<DepositInfo | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ monthlyMan: '', payday: '', tolerance: '', satellite: '0' })
  const [status, setStatus] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)

  const apply = (data: any) => {
    if (!data?.plan) return
    setPlan(data.plan as Plan)
    onPlanMonthly?.(Number((data.plan as Plan).monthly) || 0)
    setDeposit({ next_deposit_date: data.next_deposit_date ?? null, total_deposited: data.total_deposited ?? null, deposit_log: Array.isArray(data.deposit_log) ? data.deposit_log : [] })
  }

  // 프로필 스토어 hydration 전에 부르면 chat_id 없이 빈 응답이 온다 — chatId가 생긴 뒤에 읽는다 (useGoalTracker와 같은 방식)
  useEffect(() => {
    if (!chatId) return
    let active = true
    setLoadError(false)
    apiFetch('/api/ui/investment-prefs', { cacheMs: 0, retries: 1 })
      .then((res) => { if (active) apply(res?.data) })
      .catch(() => { if (active) setLoadError(true) })
    return () => { active = false }
  }, [chatId])

  const openEdit = () => {
    if (!plan) return
    setDraft({
      monthlyMan: plan.monthly > 0 ? String(plan.monthly / 10_000) : '0',
      payday: plan.payday != null ? String(plan.payday) : '',
      tolerance: plan.tolerancePct != null ? String(plan.tolerancePct) : '',
      satellite: String(plan.satellitePct),
    })
    setStatus(null)
    setEditing(true)
  }

  const monthlyWon = Math.round(Number(draft.monthlyMan.replace(/,/g, '')) * 10_000)
  const paydayNum = draft.payday === '' ? null : Number(draft.payday)
  const satelliteNum = Number(draft.satellite) as Satellite
  const toSellStocks = plan != null && plan.satellitePct > 0 && satelliteNum === 0

  const save = async () => {
    if (!plan || savingRef.current) return
    if (!Number.isFinite(monthlyWon) || monthlyWon < 0 || (monthlyWon > 0 && monthlyWon < 10_000)) { setStatus('매달 투자할 돈은 0(적립 안 함) 또는 1만원 이상으로 적어 주세요'); return }
    if (paydayNum != null && (!Number.isInteger(paydayNum) || paydayNum < 1 || paydayNum > 31)) { setStatus('급여일은 1~31일로 적어 주세요'); return }
    savingRef.current = true
    setSaving(true)
    setStatus(null)
    try {
      // 개별주 몫을 바꾸면 자동매매 방식이 바뀐다 — 바꾸기 직전 보유를 남겨 "안 바꿨다면"과 비교한다 (내 선택 돌아보기)
      if ((satelliteNum === 0) !== (plan.satellitePct === 0)) await recordSwitch(plan.satellitePct === 0 ? 'index_hold' : 'stock', satelliteNum === 0 ? 'index_hold' : 'stock')
      const res = await apiFetch('/api/ui/investment-prefs', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 15_000,
        body: JSON.stringify({
          plan: {
            monthly: monthlyWon,
            payday: paydayNum,
            tolerancePct: draft.tolerance === '' ? null : Number(draft.tolerance),
            satellitePct: satelliteNum,
          },
        }),
      })
      apply(res?.data)
      setEditing(false)
    } catch (e) {
      // 실패하면 편집을 닫지 않는다 — 닫으면 옛 값이 그대로 보여 저장된 것처럼 착각한다
      setStatus(`저장하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  if (loadError) return <div className="my-plan my-plan--muted">내 계획을 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.</div>
  if (!plan) return null

  // 서버가 최근 입금부터 돌려준다
  const lastDeposit = deposit?.deposit_log[0]

  return (
    <section className="my-plan" aria-label="내 계획">
      <div className="my-plan__head">
        <span className="my-plan__title">내 계획</span>
        <span className="my-plan__summary">{summary(plan)}</span>
        {!editing && (
          <button type="button" className="my-plan__edit" onClick={openEdit}>
            <Pencil size={12} aria-hidden /> 바꾸기
          </button>
        )}
      </div>
      {!editing && (
        <p className="my-plan__note">
          <AccountTag kind="virtual" /> 가상 계좌가 이 계획대로 자동으로 삽니다{plan.monthly > 0 && deposit?.next_deposit_date ? ` · 다음 입금 ${deposit.next_deposit_date.slice(5).replace('-', '/')}` : ''}
          {lastDeposit ? ` · 최근 입금 ${lastDeposit.date.slice(5).replace('-', '/')} ${man(lastDeposit.amount)}` : ''}.
          {' '}<AccountTag kind="real" /> 내 계좌는 자동으로 사지 않고, 매달 홈의 &lsquo;이번 달 할 일&rsquo;로 무엇을 몇 주 살지 안내합니다.
        </p>
      )}

      {editing && (
        <div className="my-plan__form">
          <label>
            <span>매달 투자할 돈</span>
            <span className="my-plan__input"><input type="number" inputMode="numeric" min="0" value={draft.monthlyMan} onChange={(e) => setDraft({ ...draft, monthlyMan: e.target.value })} /> 만원</span>
            <small>0이면 적립하지 않습니다.</small>
          </label>
          <label>
            <span>급여일</span>
            <span className="my-plan__input"><input type="number" inputMode="numeric" min="1" max="31" value={draft.payday} placeholder="모름" onChange={(e) => setDraft({ ...draft, payday: e.target.value })} /> 일</span>
            <small>{paydayNum != null && paydayNum >= 1 && paydayNum <= 31 ? `넣는 날: 매달 ${dayAfter(paydayNum)}일 (급여일 다음 날)` : `넣는 날: 매달 ${plan.depositDay}일 (지금 그대로)`}. 맞벌이면 늦은 급여일을 적어 주세요.</small>
          </label>
          <label>
            <span>버틸 수 있는 하락폭</span>
            <select value={draft.tolerance} onChange={(e) => setDraft({ ...draft, tolerance: e.target.value })}>
              <option value="">아직 안 정함</option>
              {TOLERANCES.map((t) => <option key={t} value={t}>−{t}%</option>)}
            </select>
            <small>{draft.tolerance !== '' ? `주식 비중 상한 ${stockCapFor(Number(draft.tolerance)).cap}%, 처음엔 ${stockCapFor(Number(draft.tolerance)).recommended}%부터 (계획 점검 표 기준).` : '1억이 한 해 동안 얼마까지 줄어도 팔지 않을 수 있는지 골라 주세요.'}</small>
          </label>
          <fieldset>
            <legend>개별주 몫</legend>
            <label className="my-plan__radio"><input type="radio" name="my-plan-satellite" value="0" checked={draft.satellite === '0'} onChange={() => setDraft({ ...draft, satellite: '0' })} /> 안 함 — 지수만 (권장)</label>
            <label className="my-plan__radio"><input type="radio" name="my-plan-satellite" value="10" checked={draft.satellite === '10'} onChange={() => setDraft({ ...draft, satellite: '10' })} /> 시드의 10%까지 — 봇이 개별주를 고름</label>
            {(isAdmin || plan.satellitePct === 100) && (
              <label className="my-plan__radio"><input type="radio" name="my-plan-satellite" value="100" checked={draft.satellite === '100'} onChange={() => setDraft({ ...draft, satellite: '100' })} /> 실험: 종목 봇 전체 — 관리자 전용, 검증 데이터 수집용</label>
            )}
            <small>종목 고르기로 지수를 이긴 근거는 찾지 못했습니다(검증 C1·C23). 10%는 재미 몫이고, 지수는 개별주 자금으로 팔지 않습니다.</small>
            {draft.satellite === '100' && (
              <small>실험: 시드 전체를 종목 봇이 운용하고 지수에 넣지 않습니다(남은 지수는 다음 실행 때 현금으로). 따라 하기용이 아니라 규칙을 검증할 매매 표본을 모으는 용도입니다.</small>
            )}
          </fieldset>
          {toSellStocks && (
            <p className="my-plan__warn" role="status">저장하면 다음 자동매매 때 가상 계좌의 개별주를 모두 팔고 KODEX 200으로 옮깁니다.</p>
          )}
          <div className="my-plan__actions">
            <button type="button" className="my-plan__save" disabled={saving} onClick={() => void save()}>{saving ? '저장 중' : '저장'}</button>
            <button type="button" className="my-plan__cancel" disabled={saving} onClick={() => setEditing(false)}>취소</button>
            {status && <span className="my-plan__status">{status}</span>}
          </div>
        </div>
      )}
      {!editing && goal && (
        <button type="button" className="my-plan__goal" onClick={() => navigate('/goal-tracker')} aria-label="목표 트래커 열기">
          <span>목표</span>
          <span className="my-plan__bar" aria-hidden="true"><span style={{ width: `${Math.min(100, Math.max(0, goal.progressPct))}%` }} /></span>
          <span>{goal.progressPct.toFixed(0)}%</span>
          <span style={{ color: goal.gapPct >= 0 ? 'var(--color-stock-up)' : 'var(--color-stock-down)' }}>계획 대비 {goal.gapPct >= 0 ? '+' : ''}{goal.gapPct.toFixed(1)}%</span>
          <span className="my-plan__more">목표 자세히 <ChevronRight size={12} aria-hidden /></span>
        </button>
      )}
    </section>
  )
}
