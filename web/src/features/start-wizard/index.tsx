import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, Check } from 'lucide-react'
import { apiFetch } from '../../lib/api'
import { useCurrentClientId } from '../../stores/profileStore'
import {
  judgeRealism,
  loanAdvice,
  lossReactionNote,
  monthlySurplus,
  realisticOutcome,
  requiredAnnualPct,
  suggestMonthly,
  targetWealth,
  yearsToTarget,
  type LossReaction,
} from '../../lib/startPlan'
import { userScopedKey } from '../../lib/userState'
import './start-wizard.css'

// 월수입·대출 같은 민감한 입력이라 사용자별 키로만 보관하고 로그아웃 때 지운다 (lib/userState.ts)
const storageKey = () => userScopedKey('start-wizard')
const won = (v: number) => `${Math.round(v).toLocaleString('ko-KR')}원`
const man = (v: number) => `${Math.round(v / 10_000).toLocaleString('ko-KR')}만원`
const num = (v: string) => { const n = Number(v.replace(/,/g, '').trim()); return Number.isFinite(n) && n > 0 ? n : 0 }
const monthKeyKst = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).slice(0, 7)

type Form = {
  income: string; card: string; otherFixed: string; loanPayment: string; loanRate: string
  years: string; targetMonthly: string; initialSeed: string; monthly: string; reaction: LossReaction
}
const empty: Form = { income: '', card: '', otherFixed: '', loanPayment: '', loanRate: '', years: '10', targetMonthly: '', initialSeed: '', monthly: '', reaction: 'hold' }

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

  useEffect(() => {
    if (!clientId) return
    apiFetch('/api/ui/investment-prefs', { cacheMs: 0, retries: 0 })
      .then((res) => { if (Number(res?.data?.virtual_seed_capital) > 0) setHasAccount(true) })
      .catch(() => { /* 조회 실패 시 새 계좌로 간주하지 않고 시작 버튼에서 다시 확인 */ })
  }, [clientId])

  const income = num(form.income)
  const surplus = monthlySurplus({ income, card: num(form.card), otherFixed: num(form.otherFixed), loanPayment: num(form.loanPayment) })
  const suggested = suggestMonthly(surplus)
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

  const canNext = step === 0 ? income > 0 : step === 1 ? targetMonthly > 0 : true
  const canStart = !!clientId && !busy && seedToStart >= 10_000

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
      await post('/api/ui/goal-tracker', { targetMonthlyProfit: Math.round(targetMonthly) })
      await post('/api/ui/seed-builder', {
        month: monthKeyKst(), status: 'recorded', household: 'solo', ownIncome: income, partnerIncome: 0, ownPayday: null, partnerPayday: null,
        expenses: { food: 0, housing: 0, vehicle: 0, education: 0, tax: 0, subscriptions: 0, other: num(form.otherFixed) + num(form.loanPayment), card: num(form.card), water: 0, gas: 0, residentTax: 0, propertyTax: 0, vehicleTax: 0, taxAdjustment: 0 },
        extraIncome: { incentive: 0, vacation: 0, taxRefund: 0, other: 0 }, reserve: 0, plan: Math.round(monthly),
      }, 'PUT')
      if (enableBot) await post('/api/ui/settings', { is_enabled: true })
      try { const key = storageKey(); if (key) window.localStorage.removeItem(key) } catch { /* 무시 */ }
      setHasAccount(true)
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
          <p>실제 돈은 들어가지 않습니다. 매달 {won(monthly)}씩 가상으로 적립하며 봇이 어떻게 움직이는지 먼저 지켜보세요. 믿을 만하다고 느껴지면 그때 실제 계좌로 넘어가면 됩니다.</p>
          <div className="start-actions">
            <button type="button" className="start-primary" onClick={() => navigate('/goal-tracker')}>목표 확인하기 <ArrowRight size={15} /></button>
            <button type="button" className="start-link" onClick={() => navigate('/dashboard')}>홈으로</button>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="start-wizard">
      <header>
        <span className="start-eyebrow">시작하기 · {Math.min(step + 1, 4)}/4</span>
        <h1>{['내 돈의 흐름', '목표', '내 성향', '결과 확인'][step]}</h1>
        <p>{['대략만 적어도 됩니다. 정확한 금액은 필요 없습니다. 시작하면 이 값이 시드 만들기의 이번 달 기록으로 저장되고, 나중에 거기서 고칠 수 있습니다.', '말도 안 되는 목표여도 괜찮아요. 얼마나 현실적인지 숫자로 알려 드립니다.', '정답은 없습니다. 규칙의 강도를 정하는 참고로만 씁니다.', '이 조건으로 시작해도 되는지 확인하세요.'][step]}</p>
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
        <MoneyField label="투자로 받고 싶은 월 수입" value={form.targetMonthly} onChange={(v) => set({ targetMonthly: v })} />
        <MoneyField label="투자 기간" value={form.years} onChange={(v) => set({ years: v })} suffix="년" placeholder="10" />
        <MoneyField label="처음에 넣을 금액(없으면 비워두세요)" value={form.initialSeed} onChange={(v) => set({ initialSeed: v })} />
        <MoneyField label="매달 적립" value={form.monthly} onChange={(v) => set({ monthly: v })} placeholder={suggested ? String(suggested) : '0'} hint={suggested ? `여유액의 절반(${man(suggested)})을 기본으로 둡니다. 직접 바꿔도 됩니다.` : undefined} />
      </section>}

      {step === 2 && <section className="start-card">
        <p className="start-question">투자한 돈이 한 달 만에 20% 떨어졌다면?</p>
        <div className="start-choices" role="radiogroup" aria-label="하락 시 반응">
          {([['sell', '불안해서 팔 것 같다'], ['hold', '불안하지만 버틴다'], ['buy', '싸졌으니 더 사고 싶다']] as const).map(([value, label]) => (
            <button key={value} type="button" role="radio" aria-checked={form.reaction === value} className={form.reaction === value ? 'is-active' : ''} onClick={() => set({ reaction: value })}>{label}</button>
          ))}
        </div>
        <p className="start-note">{lossReactionNote(form.reaction)}</p>
      </section>}

      {step === 3 && <section className="start-card">
        <dl className="start-result">
          <div><dt>월 투자 여유</dt><dd>{won(surplus)}</dd></div>
          <div><dt>매달 적립</dt><dd>{won(monthly)}</dd></div>
          <div><dt>목표 월 수입</dt><dd>{won(targetMonthly)}</dd></div>
          <div><dt>그러려면 필요한 자산</dt><dd>{man(target)}</dd></div>
        </dl>
        <p className={`start-realism is-${realism.level}`}>{years}년 안에 닿으려면: {realism.text}</p>
        <p className="start-note">
          지금 조건 그대로 지수 장기 평균(연 8%)이라면 {years}년 뒤 약 {man(outcome.wealth)}, 월 수입으로는 약 {man(outcome.monthlyIncome)}입니다.
          {realism.level !== 'ok' && (reachYears ? ` 목표 자산에는 약 ${reachYears}년이 걸립니다.` : ' 목표 자산에는 50년 안에 닿기 어렵습니다.')}
          {' '}과거 평균일 뿐 보장이 아닙니다.
        </p>
        {loanNote && <p className="start-warn">{loanNote}</p>}
        {hasAccount
          ? <p className="start-note">이미 가상 계좌가 있어 시작금은 건드리지 않고, 월 적립과 목표만 갱신합니다.</p>
          : <p className="start-note">가상 계좌 시작금: <strong>{won(seedToStart)}</strong>{initialSeed > 0 ? '' : ' (처음 넣을 금액이 없어 첫 달 적립액으로 시작)'}. 실제 돈은 들어가지 않습니다.</p>}
        <label className="start-check"><input type="checkbox" checked={enableBot} onChange={(e) => setEnableBot(e.target.checked)} /> 봇 자동매매도 바로 켜기 (가상 계좌에서만 움직입니다)</label>
        {error && <p className="start-warn" role="alert">저장 실패: {error}</p>}
      </section>}

      <div className="start-actions">
        {step > 0 && <button type="button" className="start-link" onClick={() => setStep(step - 1)}>이전</button>}
        {step < 3
          ? <button type="button" className="start-primary" disabled={!canNext} onClick={() => setStep(step + 1)}>다음 <ArrowRight size={15} /></button>
          : <button type="button" className="start-primary" disabled={!canStart} onClick={() => void start()}>{busy ? '만드는 중' : '가상 계좌로 시작'}</button>}
      </div>
    </main>
  )
}
