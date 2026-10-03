import { useEffect, useMemo, useState } from 'react'
import { formatKrwMan } from '../../lib/format'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Check } from 'lucide-react'
import { apiFetch } from '../../lib/api'
import { useCurrentClientId } from '../../stores/profileStore'
import {
  judgeRealism,
  loanAdvice,
  monthlySurplus,
  realisticOutcome,
  requiredAnnualPct,
  suggestMonthly,
  targetWealth,
  yearsToTarget,
  PROFILE_QUESTIONS,
  emergencyMonthlyFactor,
  profileComplete,
  personalSetup,
  type InvestorProfile,
} from '../../lib/startPlan'
import { userScopedKey, writeUserState } from '../../lib/userState'
import { START_DONE_EVENT } from '../../lib/useStartGate'
import './start-wizard.css'

// 월수입·대출 같은 민감한 입력이라 사용자별 키로만 보관하고 로그아웃 때 지운다 (lib/userState.ts)
const storageKey = () => userScopedKey('start-wizard')
const won = (v: number) => `${Math.round(v).toLocaleString('ko-KR')}원`
const man = formatKrwMan
const num = (v: string) => { const n = Number(v.replace(/,/g, '').trim()); return Number.isFinite(n) && n > 0 ? n : 0 }
const monthKeyKst = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).slice(0, 7)

type Form = {
  income: string; card: string; otherFixed: string; loanPayment: string; loanRate: string
  years: string; targetMonthly: string; initialSeed: string; monthly: string
} & InvestorProfile
const empty: Form = { income: '', card: '', otherFixed: '', loanPayment: '', loanRate: '', years: '10', targetMonthly: '', initialSeed: '', monthly: '', reaction: '', horizon: '', emergency: '', checking: '', experience: '' }

function readForm(): Form {
  try {
    const key = storageKey()
    return key ? { ...empty, ...(JSON.parse(window.localStorage.getItem(key) || '{}') as Partial<Form>) } : empty
  } catch { return empty }
}

function MoneyField({ label, value, onChange, hint, placeholder = '0', suffix = '원' }: { label: string; value: string; onChange: (v: string) => void; hint?: string; placeholder?: string; suffix?: string }) {
  const n = num(value)
  return (
    <label className="start-field">
      <span>{label}</span>
      <input type="number" inputMode="numeric" min="0" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      <em>{suffix}</em>
      {hint ? <small>{hint}</small> : suffix === '원' && n >= 10_000 ? <small>약 {man(n)}</small> : null}
    </label>
  )
}

export default function StartWizardPage() {
  const navigate = useNavigate()
  const clientId = useCurrentClientId()
  const [step, setStep] = useState(0)
  // 성향 질문은 한 화면에 하나씩 — 마지막 질문에서 다음을 눌러야 목표 단계로 넘어간다
  const [q, setQ] = useState(0)
  const [form, setForm] = useState<Form>(readForm)
  const [hasAccount, setHasAccount] = useState(false)
  const [enableBot, setEnableBot] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const set = (patch: Partial<Form>) => setForm((cur) => ({ ...cur, ...patch }))

  useEffect(() => {
    try { const key = storageKey(); if (key) window.localStorage.setItem(key, JSON.stringify(form)) } catch { /* 저장 불가 환경은 이번 세션만 */ }
  }, [form])

  // 이미 쓰던 사용자는 있는 값을 미리 채우고, 비어 있는 것만 직접 입력하게 한다 (사용자가 이미 적은 칸은 건드리지 않음)
  useEffect(() => {
    if (!clientId) return
    const fillEmpty = (patch: Partial<Form>) => setForm((cur) => {
      const next = { ...cur }
      for (const [k, v] of Object.entries(patch) as Array<[keyof Form, string]>) {
        if (v && next[k] === empty[k]) (next as Record<string, string>)[k] = v
      }
      return next
    })
    const str = (n: unknown) => Number(n) > 0 ? String(Math.round(Number(n))) : ''
    apiFetch('/api/ui/investment-prefs', { cacheMs: 0, retries: 0 })
      .then((res) => {
        if (Number(res?.data?.virtual_seed_capital) > 0) setHasAccount(true)
        fillEmpty({ monthly: str(res?.data?.monthly_deposit) })
      })
      .catch(() => { /* 조회 실패 시 새 계좌로 간주하지 않고 시작 버튼에서 다시 확인 */ })
    apiFetch('/api/ui/goal-tracker', { cacheMs: 0, retries: 0 })
      .then((res) => fillEmpty({ targetMonthly: str(res?.data?.settings?.targetMonthlyProfit) }))
      .catch(() => {})
    const year = monthKeyKst().slice(0, 4)
    apiFetch(`/api/ui/seed-builder?year=${year}`, { cacheMs: 0, retries: 0 })
      .then((res) => {
        const rows: any[] = Array.isArray(res?.data) ? res.data : []
        const m = [...rows].reverse().find((r) => Number(r?.ownIncome) > 0)
        if (m) fillEmpty({ income: str(m.ownIncome), card: str(m.expenses?.card) })
      })
      .catch(() => {})
  }, [clientId])

  const income = num(form.income)
  const surplus = monthlySurplus({ income, card: num(form.card), otherFixed: num(form.otherFixed), loanPayment: num(form.loanPayment) })
  // 비상금이 없으면 적립 기본값을 절반으로 낮춘다 (직접 입력한 금액은 그대로 존중)
  const suggested = Math.floor((suggestMonthly(surplus) * emergencyMonthlyFactor(form.emergency)) / 10_000) * 10_000
  const question = PROFILE_QUESTIONS[q]
  const years = Math.min(40, Math.max(1, num(form.years) || 10))
  const targetMonthly = num(form.targetMonthly)
  const monthly = form.monthly === '' ? suggested : num(form.monthly)
  const initialSeed = form.initialSeed === '' ? 0 : num(form.initialSeed)
  const target = targetMonthly > 0 ? targetWealth(targetMonthly) : 0
  const needPct = useMemo(() => target > 0 ? requiredAnnualPct({ seed: initialSeed, monthly, years, target }) : 0, [initialSeed, monthly, years, target])
  const realism = judgeRealism(needPct)
  const outcome = realisticOutcome({ initialSeed, monthly, years })
  const reachYears = target > 0 ? yearsToTarget({ initialSeed, monthly, target }) : null
  const loanNote = loanAdvice(form.loanRate === '' ? null : Number(form.loanRate))
  // 가상 계좌에는 시작금이 있어야 한다 — 시작금을 비우면 첫 달 적립액으로 시작한다
  const seedToStart = initialSeed > 0 ? initialSeed : monthly

  // 수입·목표는 건너뛸 수 있다 — 목돈만 가상으로 굴려 보려는 사람도 시작할 수 있어야 한다. 시작금은 있어야 한다
  const canNext = step === 0 ? true : step === 1 ? !!form[question.key] : step === 2 ? hasAccount || seedToStart >= 10_000 : true
  const setup = personalSetup(form, monthly)
  const canStart = !!clientId && !busy && seedToStart >= 10_000 && profileComplete(form)

  const start = async () => {
    setBusy(true)
    setError('')
    try {
      const post = (path: string, body: unknown, method = 'POST') => apiFetch(path, { method, body: JSON.stringify(body), cacheMs: 0, timeoutMs: 15_000 })
      // 이미 가상 계좌가 있으면 시드·현금을 건드리지 않는다 — 처음 만드는 경우에만 시작금을 넣는다
      const prefs = await apiFetch('/api/ui/investment-prefs', { cacheMs: 0, retries: 0 })
      const exists = Number(prefs?.data?.virtual_seed_capital) > 0
      if (!exists) await post('/api/ui/investment-prefs', { virtual_seed_capital: Math.round(seedToStart), reset_cash: true })
      if (monthly >= 10_000) await post('/api/ui/investment-prefs', { monthly_deposit: Math.round(monthly), deposit_day: 1 })
      if (targetMonthly > 0) await post('/api/ui/goal-tracker', { targetMonthlyProfit: Math.round(targetMonthly) })
      if (income > 0) await post('/api/ui/seed-builder', {
        month: monthKeyKst(), status: 'recorded', household: 'solo', ownIncome: income, partnerIncome: 0, ownPayday: null, partnerPayday: null,
        expenses: { food: 0, housing: 0, vehicle: 0, education: 0, tax: 0, subscriptions: 0, other: num(form.otherFixed) + num(form.loanPayment), card: num(form.card), water: 0, gas: 0, residentTax: 0, propertyTax: 0, vehicleTax: 0, taxAdjustment: 0 },
        extraIncome: { incentive: 0, vacation: 0, taxRefund: 0, other: 0 }, reserve: 0, plan: Math.round(monthly),
      }, 'PUT')
      writeUserState('investorProfile', { reaction: form.reaction, horizon: form.horizon, emergency: form.emergency, checking: form.checking, experience: form.experience } satisfies InvestorProfile)
      // 성향 답으로 자동매매 방식과 기본값을 맞춘다 — 사용자가 설정 화면을 찾아가지 않아도 되게
      await post('/api/ui/investment-prefs', { strategy_mode: setup.strategyMode })
      await post('/api/ui/settings', { ...setup.preset, is_enabled: enableBot })
      try { const key = storageKey(); if (key) window.localStorage.removeItem(key) } catch { /* 무시 */ }
      setHasAccount(true)
      window.dispatchEvent(new Event(START_DONE_EVENT))
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <main className="start-wizard">
        <div className="start-done">
          <Check size={28} aria-hidden />
          <h1>가상 계좌로 시작했어요</h1>
          <p>실제 돈은 들어가지 않습니다. {monthly >= 10_000 ? `매달 ${won(monthly)}씩 가상으로 적립하며 ` : '가상으로 넣어 둔 돈이 '}봇이 어떻게 움직이는지 먼저 지켜보세요. 믿을 만하다고 느껴지면 그때 실제 계좌로 넘어가면 됩니다.</p>
          <div className="start-actions">
            <button type="button" className="start-primary" onClick={() => navigate(targetMonthly > 0 ? '/goal-tracker' : '/dashboard')}>{targetMonthly > 0 ? '목표 확인하기' : '홈으로'} <ArrowRight size={15} /></button>
            {targetMonthly > 0
              ? <button type="button" className="start-link" onClick={() => navigate('/dashboard')}>홈으로</button>
              : <button type="button" className="start-link" onClick={() => navigate('/goal-tracker')}>목표도 정해 볼까요? (선택, 나중에 해도 됩니다)</button>}
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="start-wizard">
      <header>
        <span className="start-eyebrow">시작하기 · {Math.min(step + 1, 4)}/4</span>
        <h1>{['내 돈의 흐름', `내 성향 (${q + 1}/${PROFILE_QUESTIONS.length})`, '금액과 목표 (목표는 선택)', '결과 확인'][step]}</h1>
        <p>{['대략만 적어도 됩니다. 목돈만 가상으로 굴려 보고 싶다면 건너뛰어도 됩니다. 적으면 시드 만들기의 이번 달 기록으로 저장되고, 나중에 거기서 고칠 수 있습니다.', '정답은 없습니다. 답에 따라 적립 기본값과 주의 안내가 달라집니다.', '넣을 돈만 정하면 됩니다. 목표는 비워 둬도 되고, 적으면 얼마나 현실적인지 숫자로 알려 드립니다. 목돈만 굴려 보려면 매달 적립을 0으로 두세요.', '이 조건으로 시작해도 되는지 확인하세요.'][step]}</p>
      </header>

      {step === 0 && <section className="start-card">
        <MoneyField label="월 수입(세후)" value={form.income} onChange={(v) => set({ income: v })} />
        <MoneyField label="카드값(월 평균)" value={form.card} onChange={(v) => set({ card: v })} />
        <MoneyField label="그 밖의 고정지출(월세·보험 등)" value={form.otherFixed} onChange={(v) => set({ otherFixed: v })} />
        <MoneyField label="대출 상환(월)" value={form.loanPayment} onChange={(v) => set({ loanPayment: v })} />
        {num(form.loanPayment) > 0 && <MoneyField label="대출 금리(연, 모르면 비워두세요)" value={form.loanRate} onChange={(v) => set({ loanRate: v })} placeholder="예: 4.5" suffix="%" />}
        {loanNote && <p className="start-warn">{loanNote}</p>}
        {income > 0 && <p className={`start-summary${surplus <= 0 ? ' is-bad' : ''}`}>
          {surplus > 0 ? <>매달 투자에 쓸 수 있는 여유 <strong>{won(surplus)}</strong></> : <>지출이 수입보다 많습니다(<strong>{won(surplus)}</strong>). 먼저 지출을 점검한 뒤 시작하는 걸 권합니다. 가상 계좌로 연습하는 건 괜찮습니다.</>}
        </p>}
      </section>}

      {step === 1 && <section className="start-card">
        <p className="start-question">{question.question}</p>
        <div className="start-choices" role="radiogroup" aria-label={question.question}>
          {question.options.map((o) => (
            <button key={o.value} type="button" role="radio" aria-checked={form[question.key] === o.value} className={form[question.key] === o.value ? 'is-active' : ''} onClick={() => set({ [question.key]: o.value })}>{o.label}</button>
          ))}
        </div>
        {form[question.key] && <p className="start-note">{question.note(form[question.key])}</p>}
      </section>}

      {step === 2 && <section className="start-card">
        <MoneyField label="투자로 받고 싶은 월 수입(선택, 비워 두면 목표 없이 시작)" value={form.targetMonthly} onChange={(v) => set({ targetMonthly: v })} />
        {targetMonthly > 0 && <MoneyField label="투자 기간" value={form.years} onChange={(v) => set({ years: v })} suffix="년" placeholder="10" />}
        <MoneyField label="처음에 넣을 금액(없으면 비워두세요)" value={form.initialSeed} onChange={(v) => set({ initialSeed: v })} />
        <MoneyField label="매달 적립" value={form.monthly} onChange={(v) => set({ monthly: v })} placeholder={suggested ? String(suggested) : '0'} hint={suggested ? `여유액의 절반(${man(suggested)})을 기본으로 둡니다. 직접 바꿔도 됩니다. 적립 없이 목돈만이면 0.` : '적립 없이 목돈만이면 0'} />
        {!hasAccount && seedToStart < 10_000 && <p className="start-note">처음 넣을 금액이나 매달 적립 중 하나는 1만원 이상 적어 주세요.</p>}
      </section>}

      {step === 3 && <section className="start-card">
        <dl className="start-result">
          {income > 0 && <div><dt>월 투자 여유</dt><dd>{won(surplus)}</dd></div>}
          <div><dt>처음 넣을 금액</dt><dd>{won(seedToStart)}</dd></div>
          <div><dt>매달 적립</dt><dd>{monthly >= 10_000 ? won(monthly) : '없음 (목돈만)'}</dd></div>
          {target > 0 && <><div><dt>목표 월 수입</dt><dd>{won(targetMonthly)}</dd></div>
          <div><dt>그러려면 필요한 자산</dt><dd>{man(target)}</dd></div></>}
        </dl>
        {target > 0 ? <>
          <p className={`start-realism is-${realism.level}`}>{years}년 안에 닿으려면: {realism.text}</p>
          <p className="start-note">
            지금 조건 그대로 지수 장기 평균(연 8%)이라면 {years}년 뒤 약 {man(outcome.wealth)}, 월 수입으로는 약 {man(outcome.monthlyIncome)}입니다.
            {realism.level !== 'ok' && (reachYears ? ` 목표 자산에는 약 ${reachYears}년이 걸립니다.` : ' 목표 자산에는 50년 안에 닿기 어렵습니다.')}
            {' '}과거 평균일 뿐 보장이 아닙니다.
          </p>
        </> : <p className="start-note">목표 없이 시작합니다. 얼마가 됐는지, 가장 많이 떨어졌을 때가 언제였는지만 보여 드립니다. 목표는 써 보고 나서 정해도 늦지 않습니다.</p>}
        {loanNote && <p className="start-warn">{loanNote}</p>}
        {profileComplete(form) && <><p className="start-question">내 답에 맞춰 이렇게 설정해 둘게요</p><ul className="start-note">{setup.summary.map((n) => <li key={n}>{n}</li>)}</ul></>}
        {hasAccount
          ? <p className="start-note">이미 가상 계좌가 있어 시작금은 건드리지 않고, 월 적립과 목표만 갱신합니다.</p>
          : <p className="start-note">가상 계좌 시작금: <strong>{won(seedToStart)}</strong>{initialSeed > 0 ? '' : ' (처음 넣을 금액이 없어 첫 달 적립액으로 시작)'}. 실제 돈은 들어가지 않습니다.</p>}
        <label className="start-check"><input type="checkbox" checked={enableBot} onChange={(e) => setEnableBot(e.target.checked)} /> 봇 자동매매도 바로 켜기 (가상 계좌에서만 움직입니다)</label>
        {error && <p className="start-warn" role="alert">저장 실패: {error}</p>}
      </section>}

      <div className="start-actions">
        {(step > 0) && <button type="button" className="start-link" onClick={() => (step === 1 && q > 0 ? setQ(q - 1) : setStep(step - 1))}>이전</button>}
        {step < 3
          ? <button type="button" className="start-primary" disabled={!canNext} onClick={() => (step === 1 && q < PROFILE_QUESTIONS.length - 1 ? setQ(q + 1) : setStep(step + 1))}>{step === 0 && income === 0 ? '건너뛰기' : '다음'} <ArrowRight size={15} /></button>
          : <button type="button" className="start-primary" disabled={!canStart} onClick={() => void start()}>{busy ? '만드는 중' : '가상 계좌로 시작'}</button>}
      </div>
    </main>
  )
}
