import Detail from '../../components/ui/Detail'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, ChevronLeft, ChevronRight, Eye, EyeOff, Save, Wallet } from 'lucide-react'
import { apiFetch } from '../../lib/api'
import { useCurrentClientId } from '../../stores/profileStore'
import { HOUSEHOLDS, useHouseholdIncome, type Household, type HouseholdIncome } from '../../lib/householdIncome'
import { irregularMonthly, toSeedExpenses, type FlowCheckInput } from '../../../../src/lib/moneyFlow'
import './seed-builder.css'

type ExpenseKey = 'food' | 'housing' | 'vehicle' | 'education' | 'tax' | 'subscriptions' | 'other' | 'card' | 'water' | 'gas' | 'residentTax' | 'propertyTax' | 'vehicleTax' | 'taxAdjustment'
type ExtraIncomeKey = 'incentive' | 'vacation' | 'taxRefund' | 'other'
type Entry = { id: string; date: string; amount: number; deposited: number; memo: string; cancelled: boolean }
type MonthRecord = {
  status: 'recorded' | 'skipped'
  household: Household
  ownIncome: number
  partnerIncome: number
  ownPayday: number | null
  partnerPayday: number | null
  expenses: Record<ExpenseKey, number>
  extraIncome: Record<ExtraIncomeKey, number>
  reserve: number
  plan: number
}

const expenseLabels: Array<{ key: ExpenseKey; label: string }> = [
  { key: 'food', label: '식비·생활' },
  { key: 'housing', label: '주거비' },
  { key: 'vehicle', label: '차량유지비' },
  { key: 'education', label: '교육비' },
  { key: 'tax', label: '세금·보험' },
  { key: 'subscriptions', label: '통신·구독' },
  { key: 'other', label: '기타' },
  { key: 'card', label: '카드대금(미분류)' },
  { key: 'water', label: '수도요금(2개월)' },
  { key: 'gas', label: '가스요금(2개월)' },
  { key: 'residentTax', label: '주민세' },
  { key: 'propertyTax', label: '재산세' },
  { key: 'vehicleTax', label: '자동차세' },
  { key: 'taxAdjustment', label: '연말정산 추가 납부' },
]
const extraIncomeLabels: Array<{ key: ExtraIncomeKey; label: string }> = [
  { key: 'incentive', label: '인센티브' },
  { key: 'vacation', label: '휴가비' },
  { key: 'taxRefund', label: '연말정산 환급' },
  { key: 'other', label: '그 밖의 수입' },
]

const emptyRecord = (): MonthRecord => ({
  status: 'recorded', household: 'solo', ownIncome: 0, partnerIncome: 0, ownPayday: null, partnerPayday: null,
  expenses: { food: 0, housing: 0, vehicle: 0, education: 0, tax: 0, subscriptions: 0, other: 0, card: 0, water: 0, gas: 0, residentTax: 0, propertyTax: 0, vehicleTax: 0, taxAdjustment: 0 },
  extraIncome: { incentive: 0, vacation: 0, taxRefund: 0, other: 0 },
  reserve: 0, plan: 0,
})

// 금액 가리기: 렌더 시작마다 컴포넌트가 값을 맞춰 두고, 모든 금액 문자열이 krw()를 거쳐 가려진다.
let amountMask = false
const krw = (amount: number) => amountMask ? '•••••원' : `${Math.round(amount).toLocaleString('ko-KR')}원`
const koreanAmount = (amount: number) => {
  const value = Math.round(amount)
  if (amountMask || value < 10_000) return krw(value)
  const eok = Math.floor(value / 100_000_000)
  const man = Math.floor((value % 100_000_000) / 10_000)
  const rest = value % 10_000
  return `${[eok ? `${eok}억` : '', man ? `${man.toLocaleString('ko-KR')}만` : '', rest ? rest.toLocaleString('ko-KR') : ''].filter(Boolean).join(' ')}원`
}
const oneOffKeys: ExpenseKey[] = ['water', 'gas', 'residentTax', 'propertyTax', 'vehicleTax', 'taxAdjustment', 'card']
const readStore = (key: string) => { try { return window.localStorage.getItem(key) } catch { return null } }
const writeStore = (key: string, value: string) => { try { window.localStorage.setItem(key, value) } catch { /* 저장소를 못 쓰는 환경에서는 세션 동안만 유지 */ } }
const quickSteps = [10_000, 50_000, 100_000]
const activeEntries = (list: Entry[] | undefined) => (list ?? []).filter((entry) => !entry.cancelled)
const entriesSaved = (list: Entry[] | undefined) => activeEntries(list).reduce((sum, entry) => sum + entry.amount, 0)
const entriesDeposited = (list: Entry[] | undefined) => activeEntries(list).reduce((sum, entry) => sum + entry.deposited, 0)
const todayKst = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
const signedKrw = (amount: number) => `${amount < 0 ? '-' : ''}${krw(Math.abs(amount))}`
const recurringExpenseKeys: ExpenseKey[] = ['food', 'housing', 'vehicle', 'education', 'tax', 'subscriptions', 'other']
const sumValues = (values: Record<string, number>) => Object.values(values).reduce((sum, value) => sum + value, 0)
const monthIncome = (record: MonthRecord) => record.ownIncome + (record.household === 'dual-income' ? record.partnerIncome : 0) + sumValues(record.extraIncome)
// 여력은 0으로 자르지 않는다. 적자 규모를 그대로 보여줘야 이번 달 목표를 쉬어갈지 판단할 수 있다.
const monthAvailable = (record: MonthRecord) => monthIncome(record) - sumValues(record.expenses) - record.reserve
const monthKey = (date: Date) => date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).slice(0, 7)
const incomeOf = (r: MonthRecord): HouseholdIncome => ({ household: r.household, ownIncome: r.ownIncome, partnerIncome: r.partnerIncome, ownPayday: r.ownPayday, partnerPayday: r.partnerPayday })
const sameIncome = (a: HouseholdIncome, b: HouseholdIncome) => JSON.stringify(a) === JSON.stringify(b)

function AmountHint({ id, value }: { id: string; value: number }) {
  return <small className="seed-hint" id={id}>{value > 0 ? `약 ${koreanAmount(value)}` : ' '}</small>
}

function QuickAdd({ label, onAdd }: { label: string; onAdd: (amount: number) => void }) {
  return <span className="seed-quick" role="group" aria-label={`${label} 빠른 증가`}>{quickSteps.map((step) => <button key={step} type="button" aria-label={`${label}에 ${step / 10_000}만 원 더하기`} onClick={() => onAdd(step)}>+{step / 10_000}만</button>)}</span>
}

export default function SeedBuilderPage() {
  const navigate = useNavigate()
  const clientId = useCurrentClientId()
  const [selectedMonth, setSelectedMonth] = useState(() => monthKey(new Date()))
  const [records, setRecords] = useState<Record<string, MonthRecord>>({})
  const [draft, setDraft] = useState<MonthRecord>(emptyRecord)
  const [showExpenses, setShowExpenses] = useState(false)
  const [showIrregular, setShowIrregular] = useState(false)
  const [showExtraIncome, setShowExtraIncome] = useState(false)
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [confirmedCash, setConfirmedCash] = useState('')
  const [sharePrice, setSharePrice] = useState('')
  const [pendingOffset, setPendingOffset] = useState<number | null>(null)
  const [entries, setEntries] = useState<Record<string, Entry[]>>({})
  const [entryForm, setEntryForm] = useState({ date: '', amount: '', memo: '' })
  const [entryBusy, setEntryBusy] = useState(false)
  const [masked, setMasked] = useState(() => readStore('seed-builder-mask') === '1')
  const [onboardDone, setOnboardDone] = useState(() => readStore('seed-builder-onboarded') === '1')
  const [onboardStep, setOnboardStep] = useState(0)
  const [showAllChanges, setShowAllChanges] = useState(false)
  const [showTable, setShowTable] = useState(false)
  const [annualGoal, setAnnualGoal] = useState('')
  const [confirmTransfer, setConfirmTransfer] = useState(false)
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false)
  const [latestCheck, setLatestCheck] = useState<{ date: string; input: FlowCheckInput } | null>(null)
  amountMask = masked
  // 수입·급여일은 '우리 집 수입'(시작하기·돈 흐름 점검과 같은 값). 기록 안 한 이번 달·다음 달은 그 값으로 채워 두고,
  // 이번 달 이후의 수입을 고치면 우리 집 수입도 바로 바뀐다. 지난달 기록은 그달 실제 값이라 건드리지 않는다
  const incomeStore = useHouseholdIncome()
  const incomeBase = incomeStore.value
  const blankFor = (key: string): MonthRecord => (key >= monthKey(new Date()) && incomeBase ? { ...emptyRecord(), ...incomeBase } : emptyRecord())

  const year = Number(selectedMonth.slice(0, 4))
  const month = Number(selectedMonth.slice(5))
  useEffect(() => {
    setRecords({})
    setEntries({})
    setDraft(emptyRecord())
    if (!clientId) { setLoading(false); return }
    let active = true
    setLoading(true)
    setLoadError('')
    apiFetch(`/api/ui/seed-builder?year=${year}`, { cacheMs: 0, retries: 0 })
      .then((response) => {
        if (!active) return
        const rows = response.data as Array<MonthRecord & { month: string; entries?: Entry[] }>
        setEntries(Object.fromEntries(rows.map((row) => [row.month, row.entries ?? []])))
        const loaded = Object.fromEntries(rows.map(({ month: key, entries: _entries, ...record }) => {
          const defaults = emptyRecord()
          return [key, { ...defaults, ...record, expenses: { ...defaults.expenses, ...record.expenses }, extraIncome: { ...defaults.extraIncome, ...record.extraIncome } }]
        }))
        setRecords(loaded)
        setDraft(loaded[selectedMonth] ?? blankFor(selectedMonth))
        // 월 자동 입금(목표 트래커가 따르는 값)이 이번 달 계획의 기준 — 다른 화면에서 바꿨어도 여기 계획이 같이 보이게 한다
        const nowKey = monthKey(new Date())
        void apiFetch('/api/ui/investment-prefs', { cacheMs: 0, retries: 0 }).then((prefsRes) => {
          const deposit = Number(prefsRes?.data?.monthly_deposit)
          if (!active || !(deposit >= 10_000)) return
          setRecords((current) => current[nowKey] && current[nowKey].plan !== deposit ? { ...current, [nowKey]: { ...current[nowKey], plan: deposit } } : current)
          setDraft((current) => selectedMonth === nowKey && current.plan !== deposit ? { ...current, plan: deposit } : current)
        }).catch(() => {})
      })
      .catch((error: unknown) => { if (active) setLoadError(error instanceof Error ? error.message : String(error)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [clientId, year])

  const expenseTotal = sumValues(draft.expenses)
  const extraIncomeTotal = sumValues(draft.extraIncome)
  const income = monthIncome(draft)
  const paydays = [
    ...(draft.ownPayday && draft.ownIncome > 0 ? [{ day: draft.ownPayday, label: '본인', amount: draft.ownIncome }] : []),
    ...(draft.household === 'dual-income' && draft.partnerPayday && draft.partnerIncome > 0 ? [{ day: draft.partnerPayday, label: '배우자', amount: draft.partnerIncome }] : []),
  ].sort((first, second) => first.day - second.day)
  const available = monthAvailable(draft)
  const isDeficit = income > 0 && available < 0
  const isTight = !isDeficit && income > 0 && draft.plan > 0 && draft.plan <= available && draft.plan >= available * 0.8
  const dirty = JSON.stringify(draft) !== JSON.stringify(records[selectedMonth] ?? blankFor(selectedMonth))
  const previousKey = monthKey(new Date(year, month - 2, 15))
  const previous = records[previousKey]
  const previousExpense = previous ? sumValues(previous.expenses) : null
  const previousAvailable = previous ? monthAvailable(previous) : null
  const availableChange = previousAvailable !== null && (income > 0 || expenseTotal > 0) ? available - previousAvailable : null
  const currentSaved = records[selectedMonth]
  const savedAvailable = currentSaved ? monthAvailable(currentSaved) : 0
  const expenseChanges = currentSaved && previous
    ? expenseLabels.map(({ key, label }) => ({ label, key, current: currentSaved.expenses[key], previous: previous.expenses[key], difference: currentSaved.expenses[key] - previous.expenses[key] }))
    : []
  const changedRows = expenseChanges.filter((entry) => entry.previous > 0 || entry.current > 0).sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference))
  const visibleRows = showAllChanges ? changedRows : changedRows.slice(0, 3)
  const riseTip = changedRows.filter((entry) => entry.difference > 0 && !oneOffKeys.includes(entry.key) && entry.key !== 'tax').sort((a, b) => b.difference - a.difference)[0]
  const currentKey = monthKey(new Date())
  const nextKey = monthKey(new Date(Number(currentKey.slice(0, 4)), Number(currentKey.slice(5)), 15))
  const isFuture = selectedMonth > currentKey
  const savedOf = (key: string) => entriesSaved(entries[key])
  const savedNow = savedOf(selectedMonth)
  const depositedNow = entriesDeposited(entries[selectedMonth])
  const annualSaved = Object.keys(entries).filter((key) => key.startsWith(`${year}-`)).reduce((sum, key) => sum + savedOf(key), 0)
  const maxBar = Math.max(1, ...Array.from({ length: 12 }, (_, index) => { const key = `${year}-${String(index + 1).padStart(2, '0')}`; return Math.max(savedOf(key), records[key]?.plan ?? 0) }))
  const canSkip = !records[selectedMonth] && !isFuture && !dirty && (entries[selectedMonth] ?? []).length === 0
  const hasAnyRecord = Object.keys(records).length > 0 || Object.keys(entries).length > 0
  const onboarding = !onboardDone && !!clientId && !loadError && (loading || !hasAnyRecord)
  const finishOnboarding = () => { setOnboardDone(true); writeStore('seed-builder-onboarded', '1') }
  const ratioGoal = available > 0 ? Math.floor(available * 0.3 / 1000) * 1000 : 0
  const annualGoalValue = Number(annualGoal)
  const remainingMonths = 13 - month
  const annualPerMonth = annualGoal !== '' && Number.isSafeInteger(annualGoalValue) && annualGoalValue > 0
    ? Math.ceil(Math.max(0, annualGoalValue - (annualSaved - savedNow)) / remainingMonths / 1000) * 1000 : null
  const reserveMonths = expenseTotal > 0 ? draft.reserve / expenseTotal : null
  const conservativeAvailable = (() => {
    const values = [1, 2, 3].map((back) => records[monthKey(new Date(year, month - 1 - back, 15))]).filter((record): record is MonthRecord => !!record && record.status === 'recorded' && monthIncome(record) > 0)
      .map((record) => monthAvailable(record) - sumValues(record.extraIncome))
    return values.length >= 2 ? Math.min(...values) : null
  })()
  const cash = Number(confirmedCash)
  const price = Number(sharePrice)
  const canCompare = confirmedCash !== '' && sharePrice !== '' && Number.isSafeInteger(cash) && cash >= 0 && Number.isSafeInteger(price) && price > 0

  // 우리 집 수입은 늦게 도착할 수 있다 — 아직 아무것도 적지 않은 빈 달이면 그때 채운다
  const incomeBaseJson = JSON.stringify(incomeBase)
  useEffect(() => {
    if (loading || records[selectedMonth]) return
    setDraft((current) => (JSON.stringify(current) === JSON.stringify(emptyRecord()) ? blankFor(selectedMonth) : current))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomeBaseJson, loading, selectedMonth])

  // 점검에서 정한 평소 한 달 지출을 이번 달 지출 칸으로 가져올 수 있게 최근 점검을 읽어 둔다
  useEffect(() => {
    if (!clientId) return
    const today = todayKst()
    apiFetch(`/api/ui/money-flow?from=${today}&to=${today}`, { cacheMs: 0, retries: 0 })
      .then((res) => { const c = Array.isArray(res?.checks) ? res.checks[0] : null; setLatestCheck(c?.input ? { date: String(c.date), input: c.input } : null) })
      .catch(() => {})
  }, [clientId])

  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const changeMonth = (offset: number, force = false) => {
    if (dirty && !force) { setPendingOffset(offset); return }
    setPendingOffset(null)
    const next = monthKey(new Date(year, month - 1 + offset, 15))
    setSelectedMonth(next)
    setEntryForm({ date: '', amount: '', memo: '' })
    setDraft(next.slice(0, 4) === selectedMonth.slice(0, 4) ? records[next] ?? blankFor(next) : blankFor(next))
    setNotice('')
  }

  const updateAmount = (field: 'reserve' | 'plan', value: string) => {
    const parsed = Number(value)
    setDraft((current) => ({ ...current, [field]: Number.isFinite(parsed) ? parsed : 0 }))
    setNotice('')
  }

  // 수입 칸을 고칠 때 — 이번 달 이후면 우리 집 수입에도 바로 저장한다(이번 달 저장 버튼을 누르지 않아도 남는다)
  const editIncome = (patch: Partial<MonthRecord>) => {
    const next = { ...draft, ...patch }
    setDraft(next)
    setNotice('')
    if (selectedMonth >= monthKey(new Date())) incomeStore.set(incomeOf(next))
  }
  const incomeMismatch = !!incomeBase && incomeStore.saved && selectedMonth >= monthKey(new Date()) && !sameIncome(incomeOf(draft), incomeBase)

  const fillFromCheck = () => {
    if (!latestCheck) return
    const { input } = latestCheck
    const seed = toSeedExpenses([...input.fixed, ...input.variable, ...input.irregular.map((i) => ({ categoryId: i.categoryId, amount: irregularMonthly(i), payment: i.payment }))])
    setDraft((current) => ({ ...current, expenses: { ...emptyRecord().expenses, ...seed }, reserve: input.reserveMonthly }))
    setNotice(`${latestCheck.date} 점검의 평소 한 달 지출(현금 기준, 환급 뺀 금액)과 비상자금 적립을 채웠습니다. 이번 달에 다르게 나간 것만 고치고 저장하세요.`)
  }

  const fillFromPrevious = () => {
    if (!previous) return
    setDraft((current) => ({
      ...current, household: previous.household, ownIncome: previous.ownIncome, partnerIncome: previous.partnerIncome,
      ownPayday: previous.ownPayday, partnerPayday: previous.partnerPayday,
      expenses: { ...current.expenses, ...Object.fromEntries(recurringExpenseKeys.map((key) => [key, previous.expenses[key]])) },
    }))
    setNotice('지난달 반복 항목(수입·급여일·생활비류)을 채웠습니다. 카드대금·세금·추가 수입·목표는 채우지 않았으니 이번 달 금액을 직접 입력하세요.')
  }

  // 이번 달 계획과 월 자동 입금은 같은 숫자다 — 목표 트래커·가상 계좌 입금이 월 자동 입금을 따르므로, 저장할 때 그쪽도 함께 맞춘다
  const syncDepositToPlan = async (plan: number): Promise<string | null> => {
    if (plan < 10_000) return null
    try {
      const res = await apiFetch('/api/ui/investment-prefs', { cacheMs: 0, retries: 0 })
      const current = Number(res?.data?.monthly_deposit)
      if (!Number.isFinite(current) || current === plan) return null
      await apiFetch('/api/ui/investment-prefs', { method: 'POST', body: JSON.stringify({ monthly_deposit: plan, deposit_day: Number(res?.data?.deposit_day) || 1 }), cacheMs: 0, timeoutMs: 15_000 })
      return `월 자동 입금도 ${krw(plan)}으로 맞췄습니다. 목표 트래커에도 반영됩니다.`
    } catch (error) {
      return `계획은 저장했지만 월 자동 입금은 바꾸지 못했습니다: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  const save = async (): Promise<boolean> => {
    if (!clientId || loading || loadError) return false
    if ([draft.ownIncome, draft.partnerIncome, draft.reserve, draft.plan, ...Object.values(draft.expenses), ...Object.values(draft.extraIncome)].some((amount) => !Number.isSafeInteger(amount) || amount < 0)
      || [draft.ownPayday, draft.partnerPayday].some((day) => day !== null && (!Number.isInteger(day) || day < 1 || day > 31))) {
      setNotice('금액은 0원 이상의 정수로 입력해 주세요.')
      return false
    }
    setSaving(true)
    setNotice('')
    try {
      const toSave: MonthRecord = { ...draft, status: 'recorded' }
      await apiFetch('/api/ui/seed-builder', { method: 'PUT', body: JSON.stringify({ month: selectedMonth, ...toSave }), cacheMs: 0 })
      setRecords((current) => ({ ...current, [selectedMonth]: { ...toSave, expenses: { ...draft.expenses }, extraIncome: { ...draft.extraIncome } } }))
      setDraft(toSave)
      const synced = selectedMonth === monthKey(new Date()) ? await syncDepositToPlan(toSave.plan) : null
      setNotice(synced ? `이번 달 기록을 저장했습니다. ${synced}` : '이번 달 기록을 저장했습니다.')
      return true
    } catch (error) {
      setNotice(`저장 실패: ${error instanceof Error ? error.message : String(error)}`)
      return false
    } finally {
      setSaving(false)
    }
  }

  const toggleMask = () => { setMasked((current) => { writeStore('seed-builder-mask', current ? '0' : '1'); return !current }) }
  const exportYear = () => {
    const payload = { year, exportedAt: new Date().toISOString(), months: Object.entries(records).map(([key, record]) => ({ month: key, ...record, entries: entries[key] ?? [] })) }
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `seed-builder-${year}.json`
    link.click()
    URL.revokeObjectURL(url)
  }
  const deleteAll = async () => {
    if (!clientId || loading) return
    setSaving(true)
    try {
      await apiFetch('/api/ui/seed-builder', { method: 'DELETE', body: JSON.stringify({ confirm: 'delete-all' }), cacheMs: 0 })
      setRecords({}); setEntries({}); setDraft(emptyRecord()); setConfirmDeleteAll(false)
      setNotice('시드 만들기 기록을 모두 삭제했습니다. 가상 시드·자동 입금·자동매매는 그대로입니다.')
    } catch (error) {
      setNotice(`삭제 실패: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSaving(false)
    }
  }

  const skipMonth = async () => {
    if (!clientId || loading || loadError || !canSkip) return
    setSaving(true)
    try {
      const skipped: MonthRecord = { ...emptyRecord(), status: 'skipped' }
      await apiFetch('/api/ui/seed-builder', { method: 'PUT', body: JSON.stringify({ month: selectedMonth, ...skipped }), cacheMs: 0 })
      setRecords((current) => ({ ...current, [selectedMonth]: skipped }))
      setDraft(skipped)
      setNotice('이 달을 건너뜀으로 표시했습니다. 금액을 입력하고 저장하면 기록된 달로 바뀝니다.')
    } catch (error) {
      setNotice(`저장 실패: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSaving(false)
    }
  }

  const entryRequest = async (body: Record<string, unknown>) => {
    if (!clientId || loading || loadError) return null
    setEntryBusy(true)
    try {
      return await apiFetch('/api/ui/seed-builder', { method: 'POST', body: JSON.stringify(body), cacheMs: 0 })
    } catch (error) {
      setNotice(`저장 실패: ${error instanceof Error ? error.message : String(error)}`)
      return null
    } finally {
      setEntryBusy(false)
    }
  }
  const patchEntry = (id: string, change: Partial<Entry>) => setEntries((current) => ({ ...current, [selectedMonth]: (current[selectedMonth] ?? []).map((entry) => entry.id === id ? { ...entry, ...change } : entry) }))

  const addEntry = async () => {
    const amount = Number(entryForm.amount)
    if (entryForm.amount === '' || !Number.isSafeInteger(amount) || amount < 1) { setNotice('확보 금액은 1원 이상의 정수로 입력해 주세요.'); return }
    const date = entryForm.date || (selectedMonth === currentKey ? todayKst() : `${selectedMonth}-01`)
    const response = await entryRequest({ action: 'add-entry', month: selectedMonth, date, amount, memo: entryForm.memo.trim() })
    if (!response) return
    const entry: Entry = { id: String(response.id), date, amount, deposited: 0, memo: entryForm.memo.trim(), cancelled: false }
    setEntries((current) => ({ ...current, [selectedMonth]: [...(current[selectedMonth] ?? []), entry].sort((a, b) => a.date.localeCompare(b.date)) }))
    setEntryForm({ date: '', amount: '', memo: '' })
    setNotice('확보 내역을 기록했습니다.')
  }
  const toggleCancel = async (entry: Entry) => {
    if (!await entryRequest({ action: entry.cancelled ? 'restore-entry' : 'cancel-entry', id: entry.id })) return
    patchEntry(entry.id, { cancelled: !entry.cancelled })
  }
  const applyDeposit = async (entry: Entry, value: string) => {
    const deposited = Number(value)
    if (value === '' || !Number.isSafeInteger(deposited) || deposited < 0 || deposited > entry.amount) { setNotice(`입금 기록은 0원 이상, 이 내역의 확보 금액(${krw(entry.amount)}) 이하로 입력해 주세요.`); return }
    if (!await entryRequest({ action: 'set-deposit', id: entry.id, deposited })) return
    patchEntry(entry.id, { deposited })
    setNotice('입금 기록을 저장했습니다. 계좌 잔고를 확인한 값은 아닙니다.')
  }

  const householdButtons = (
    <div className="seed-segments" role="group" aria-label="가구 형태">
      {HOUSEHOLDS.map(([value, label]) => <button key={value} type="button" className={draft.household === value ? 'is-active' : ''} aria-pressed={draft.household === value} onClick={() => editIncome({ household: value, partnerIncome: value === 'dual-income' ? draft.partnerIncome : 0, partnerPayday: value === 'dual-income' ? draft.partnerPayday : null })}>{label}</button>)}
    </div>
  )

  return (
    <main className={`seed-builder${masked ? ' is-masked' : ''}`}>
      <header className="seed-header">
        <div><span className="seed-eyebrow">투자 전 단계</span><h1>시드 만들기</h1><p>큰 돈의 흐름을 보고, 이번 달 모을 수 있는 금액을 정합니다.</p></div>
        <div className="seed-header-tools"><button type="button" className="seed-mask-button" aria-pressed={masked} onClick={toggleMask}>{masked ? <EyeOff size={15} /> : <Eye size={15} />} 금액 가리기</button></div>
        <div className="seed-month-nav" aria-label="기록 월 선택">
          <button type="button" title="이전 달" aria-label="이전 달" onClick={() => changeMonth(-1)}><ChevronLeft size={18} /></button>
          <strong>{year}년 {month}월</strong>
          <button type="button" title="다음 달" aria-label="다음 달" onClick={() => changeMonth(1)} disabled={selectedMonth >= nextKey}><ChevronRight size={18} /></button>
        </div>
      </header>

      {pendingOffset !== null && <div className="seed-move-banner" role="alertdialog" aria-label="저장하지 않은 입력">
        <p>저장하지 않은 입력이 있습니다. 이동하면 입력 중인 값이 사라집니다.</p>
        <div>
          <button type="button" className="seed-primary" disabled={saving} onClick={async () => { if (await save()) changeMonth(pendingOffset, true) }}>저장하고 이동</button>
          <button type="button" className="seed-secondary" onClick={() => changeMonth(pendingOffset, true)}>버리고 이동</button>
          <button type="button" className="seed-link-button" onClick={() => setPendingOffset(null)}>취소</button>
        </div>
      </div>}

      <section className="seed-overview" aria-label="시드 현황">
        <div><span>{isFuture ? '계획 (예정)' : '이번 달 계획'}</span><strong>{krw(records[selectedMonth]?.plan ?? 0)}</strong></div>
        <div><span>실제로 모은 돈</span><strong>{krw(savedNow)}</strong>{(records[selectedMonth]?.plan ?? 0) > 0 && !isFuture && <small>계획의 {Math.round(savedNow / (records[selectedMonth]?.plan ?? 1) * 100)}%</small>}</div>
        <div><span>입금 기록</span><strong>{krw(depositedNow)}</strong></div>
        <div><span>올해 모은 돈</span><strong>{krw(annualSaved)}</strong></div>
      </section>

      <section className="seed-chart-section">
        <div className="seed-section-title"><div><h2>{year}년 월별 시드</h2><p>입력해 모은 금액만 실적으로 표시합니다.</p></div><span>사용자 기록 · 투자 수익 제외</span></div>
        <div className="seed-chart" role="img" aria-label={`${year}년 월별 확보금: ${Array.from({ length: 12 }, (_, index) => { const key = `${year}-${String(index + 1).padStart(2, '0')}`; const record = records[key]; const label = key > currentKey ? (record?.plan ? `계획 ${krw(record.plan)}(예정)` : '기록 없음') : record?.status === 'skipped' ? '건너뜀' : record ? `${krw(savedOf(key))}${record.plan ? `, 계획 ${krw(record.plan)}` : ''}` : '기록 없음'; return `${index + 1}월 ${label}` }).join(', ')}`}>
          {Array.from({ length: 12 }, (_, index) => {
            const key = `${year}-${String(index + 1).padStart(2, '0')}`
            const record = records[key]
            const saved = savedOf(key)
            const plan = record?.plan ?? 0
            const future = key > currentKey
            let bar
            if (future) bar = plan > 0 ? <div className="seed-bar-future" style={{ height: `${Math.max(4, plan / maxBar * 100)}%` }} /> : <div className="seed-bar-none" aria-hidden="true" />
            else if (record?.status === 'skipped') bar = <div className="seed-bar-skipped">–</div>
            else if (record) bar = saved ? <div className="seed-bar" style={{ height: `${Math.max(4, saved / maxBar * 100)}%` }} /> : <div className="seed-bar-zero">0</div>
            else bar = <div className="seed-bar-none" aria-hidden="true" />
            return <div className={`seed-chart-column${selectedMonth === key ? ' is-selected' : ''}`} key={key}><div className="seed-bar-area">{bar}{!future && plan > 0 && record?.status !== 'skipped' && <div className="seed-plan-tick" aria-hidden="true" style={{ bottom: `${plan / maxBar * 100}%` }} />}</div><span>{index + 1}월</span></div>
          })}
        </div>
        <Detail><p className="seed-chart-legend">실선 막대 = 확보 내역 합계 · 가로선 = 그달 계획 · “0” = 기록했지만 모으지 않은 달 · “–” = 건너뜀 · 빈 점선 = 기록 없음 · 채운 점선 = 다음 달 계획(예정)</p></Detail>
        <Detail><button type="button" className="seed-link-button" aria-expanded={showTable} onClick={() => setShowTable(!showTable)}>{showTable ? '표 접기' : '표로 보기'}</button></Detail>
        {showTable && <div className="seed-table-wrap"><table className="seed-table"><caption>{year}년 월별 시드</caption><thead><tr><th scope="col">월</th><th scope="col">상태</th><th scope="col">계획</th><th scope="col">확보</th><th scope="col">입금 기록</th></tr></thead><tbody>
          {Array.from({ length: 12 }, (_, index) => { const key = `${year}-${String(index + 1).padStart(2, '0')}`; const record = records[key]; const state = key > currentKey ? (record?.plan ? '계획(예정)' : '기록 없음') : record?.status === 'skipped' ? '건너뜀' : record ? '기록됨' : '기록 없음'; return <tr key={key}><th scope="row">{index + 1}월</th><td>{state}</td><td>{krw(record?.plan ?? 0)}</td><td>{krw(savedOf(key))}</td><td>{krw(entriesDeposited(entries[key]))}</td></tr> })}
        </tbody></table></div>}
        {annualSaved === 0 && <p className="seed-empty">첫 금액을 저장하면 이곳에서 시드가 쌓이는 추이를 볼 수 있습니다.</p>}
      </section>

      {onboarding ? (loading ? <section className="seed-editor"><p className="seed-empty">기록을 불러오는 중입니다.</p></section> : <section className="seed-onboarding" aria-label="처음 시작하기">
        <div className="seed-section-title"><div><h2>처음 시작하기 · {onboardStep + 1}/3</h2><p>세 가지만 대략 적으면 이번 달 시작할 수 있어요. 언제든 건너뛸 수 있고 정확하지 않아도 됩니다.</p></div></div>
        {onboardStep === 0 && <div className="seed-input-group">
          <h3>수입</h3>
          {householdButtons}
          <label>{draft.household === 'solo' ? '월수입' : '본인 월수입'} <input type="number" inputMode="numeric" min="0" step="1000" value={draft.ownIncome || ''} placeholder="0" aria-describedby="hint-ob-own" onChange={(event) => editIncome({ ownIncome: Number(event.target.value) || 0 })} /> <span>원</span></label>
          <AmountHint id="hint-ob-own" value={draft.ownIncome} />
          {draft.household === 'dual-income' && <><label>배우자 월수입 <input type="number" inputMode="numeric" min="0" step="1000" value={draft.partnerIncome || ''} placeholder="0" aria-describedby="hint-ob-partner" onChange={(event) => editIncome({ partnerIncome: Number(event.target.value) || 0 })} /> <span>원</span></label><AmountHint id="hint-ob-partner" value={draft.partnerIncome} /></>}
        </div>}
        {onboardStep === 1 && <div className="seed-input-group">
          <h3>이번 달 큰 지출</h3>
          {latestCheck && <button type="button" className="seed-secondary" onClick={fillFromCheck}>지금 상태 점검 값 가져오기</button>}
          <label>한 달 지출 합계(대략) <input type="number" inputMode="numeric" min="0" step="10000" value={expenseTotal || ''} placeholder="0" aria-describedby="hint-ob-expense" onChange={(event) => { const value = Number(event.target.value); setDraft((current) => ({ ...current, expenses: { ...emptyRecord().expenses, other: Number.isFinite(value) ? value : 0 } })) }} /> <span>원</span></label>
          <AmountHint id="hint-ob-expense" value={expenseTotal} />
          <p className="seed-payday-help">항목을 나누지 않고 합계만 적어도 됩니다. 지금은 &lsquo;기타&rsquo;로 기록되고, 나중에 항목별로 나눌 수 있습니다. 카드대금까지 포함한 대략의 금액이면 충분합니다.</p>
        </div>}
        {onboardStep === 2 && <div className="seed-input-group">
          <h3>이번 달 시드 목표</h3>
          <p className="seed-payday-help">월수입 {krw(income)} − 지출 {krw(expenseTotal)} = 참고 여력 <strong className={isDeficit ? 'seed-negative' : ''}>{signedKrw(available)}</strong>. 0원도 정상적인 목표입니다.</p>
          <label>시작 목표 <input type="number" inputMode="numeric" min="0" step="1000" value={draft.plan || ''} placeholder="0" aria-describedby="hint-ob-plan" onChange={(event) => updateAmount('plan', event.target.value)} /> <span>원</span></label>
          <AmountHint id="hint-ob-plan" value={draft.plan} />
          <QuickAdd label="시작 목표" onAdd={(step) => updateAmount('plan', String(draft.plan + step))} />
          {isDeficit && <p className="seed-warning">이번 달은 지출이 수입보다 많습니다. 목표를 0원으로 두고 쉬어가도 괜찮습니다.</p>}
        </div>}
        <div className="seed-actions">
          <button type="button" className="seed-link-button" onClick={() => { finishOnboarding() }}>자세히 직접 입력하기</button>
          <p role="status">{notice}</p>
          {onboardStep > 0 && <button type="button" className="seed-secondary" onClick={() => setOnboardStep(onboardStep - 1)}>이전</button>}
          {onboardStep < 2 ? <button type="button" className="seed-primary" onClick={() => setOnboardStep(onboardStep + 1)}>{onboardStep === 1 && expenseTotal === 0 ? '건너뛰기' : '다음'}</button>
            : <button type="button" className="seed-primary" disabled={saving} onClick={async () => { if (await save()) finishOnboarding() }}><Save size={16} /> 저장하고 시작</button>}
        </div>
      </section>) : <>
      <section className="seed-editor">
        <div className="seed-section-title"><div><h2>이번 달 돈의 흐름</h2><p>큰 금액만 입력해도 됩니다. 항목별 거래 내역은 필요하지 않습니다.</p></div></div>
        {(previous || latestCheck) && <div className="seed-fill-row">
          {latestCheck && <button type="button" className="seed-secondary" onClick={fillFromCheck}>지금 상태 점검 값으로 지출 채우기</button>}
          {previous && <button type="button" className="seed-secondary" onClick={fillFromPrevious}>지난달 값 채우기</button>}
          <Detail><span>점검 값은 평소 한 달 기준(비정기는 1년 ÷ 12)입니다. 지난달 값은 수입·급여일·식비 등 반복 항목만 채우고 일시 항목은 복사하지 않습니다.</span></Detail>
        </div>}
        {incomeMismatch && incomeBase && <p className="seed-warning">이 달 수입이 우리 집 수입(시작하기·돈 흐름 점검과 같은 값)과 다릅니다. <button type="button" className="seed-link-button" onClick={() => setDraft((current) => ({ ...current, ...incomeBase }))}>우리 집 수입으로 맞추기</button> 이 달만 다르다면 그대로 저장해도 됩니다.</p>}
        <div className="seed-form-grid">
          <div className="seed-input-group">
            <h3>수입</h3>
            {householdButtons}
            <label> {draft.household === 'solo' ? '월수입' : '본인 월수입'} <input type="number" inputMode="numeric" min="0" step="1000" value={draft.ownIncome || ''} placeholder="0" aria-describedby="hint-own-income" onChange={(event) => editIncome({ ownIncome: Number(event.target.value) || 0 })} /> <span>원</span></label>
            <AmountHint id="hint-own-income" value={draft.ownIncome} />
            {draft.household === 'dual-income' && <label>배우자 월수입 <input type="number" inputMode="numeric" min="0" step="1000" value={draft.partnerIncome || ''} placeholder="0" aria-describedby="hint-partner-income" onChange={(event) => editIncome({ partnerIncome: Number(event.target.value) || 0 })} /> <span>원</span></label>}
            {draft.household === 'dual-income' && <AmountHint id="hint-partner-income" value={draft.partnerIncome} />}
            <div className="seed-paydays">
              <label>본인 급여일 <input type="number" inputMode="numeric" min="1" max="31" value={draft.ownPayday ?? ''} placeholder="선택" onChange={(event) => editIncome({ ownPayday: event.target.value === '' ? null : Number(event.target.value) })} /> <span>일</span></label>
              {draft.household === 'dual-income' && <label>배우자 급여일 <input type="number" inputMode="numeric" min="1" max="31" value={draft.partnerPayday ?? ''} placeholder="선택" onChange={(event) => editIncome({ partnerPayday: event.target.value === '' ? null : Number(event.target.value) })} /> <span>일</span></label>}
            </div>
            {paydays.length > 0 && <p className="seed-payday-summary">{paydays.map((entry) => `${entry.day}일 ${entry.label} ${krw(entry.amount)}`).join(' · ')}</p>}
            <button className="seed-link-button" type="button" onClick={() => setShowExtraIncome(!showExtraIncome)}>{showExtraIncome ? '추가 수입 접기' : '인센티브·휴가비 등 추가 수입'}</button>
            {showExtraIncome && <div className="seed-optional-inputs">{extraIncomeLabels.map(({ key, label }) => <label key={key}>{label}<input type="number" inputMode="numeric" min="0" step="1000" value={draft.extraIncome[key] || ''} placeholder="0" onChange={(event) => { const value = Number(event.target.value); setDraft((current) => ({ ...current, extraIncome: { ...current.extraIncome, [key]: Number.isFinite(value) ? value : 0 } })); setNotice('') }} /><span>원</span></label>)}</div>}
            <Detail><p className="seed-payday-help">월수입 합계 {krw(income)}{extraIncomeTotal > 0 ? ` (일시 수입 ${krw(extraIncomeTotal)} 포함)` : ''}. 아직 받지 않은 급여·일시 수입을 월초 투자 현금으로 계산하지 않습니다.</p></Detail>
          </div>
          <div className="seed-input-group">
            <h3>지출 <span>{krw(expenseTotal)}</span></h3>
            {expenseLabels.slice(0, showExpenses ? 8 : 4).map(({ key, label }) => <label key={key}>{label}<input type="number" inputMode="numeric" min="0" step="1000" value={draft.expenses[key] || ''} placeholder="0" onChange={(event) => { const value = Number(event.target.value); setDraft((current) => ({ ...current, expenses: { ...current.expenses, [key]: Number.isFinite(value) ? value : 0 } })); setNotice('') }} /><span>원</span></label>)}
            <button className="seed-link-button" type="button" onClick={() => setShowExpenses(!showExpenses)}>{showExpenses ? '간단히 보기' : '세금·카드대금 등도 입력'}</button>
            {showExpenses && <p className="seed-payday-help">카드대금은 위 항목에 이미 적은 사용액을 제외한 미분류 금액만 입력하세요. 중복 입력하면 지출이 두 번 계산됩니다.</p>}
            {showExpenses && <button className="seed-link-button" type="button" onClick={() => setShowIrregular(!showIrregular)}>{showIrregular ? '비정기 지출 접기' : '수도·가스·계절성 세금 입력'}</button>}
            {showExpenses && showIrregular && <div className="seed-optional-inputs">{expenseLabels.slice(8).map(({ key, label }) => <label key={key}>{label}<input type="number" inputMode="numeric" min="0" step="1000" value={draft.expenses[key] || ''} placeholder="0" onChange={(event) => { const value = Number(event.target.value); setDraft((current) => ({ ...current, expenses: { ...current.expenses, [key]: Number.isFinite(value) ? value : 0 } })); setNotice('') }} /><span>원</span></label>)}<p className="seed-payday-help">2개월치 공과금은 납부한 달에 전액 적습니다. 세금·보험에 이미 포함한 금액은 다시 넣지 마세요.</p></div>}
            <Detail>{previousExpense !== null && <p className="seed-compare">지난달 총지출 {krw(previousExpense)} · 이번 달 {krw(Math.abs(expenseTotal - previousExpense))} {expenseTotal >= previousExpense ? '증가' : '감소'}</p>}</Detail>
          </div>
        </div>
        <div className="seed-plan-row">
          <div><h3>시드 계획</h3><p>월수입 - 지출 - 남겨둘 생활·비상자금 = 월간 참고 여력 <strong className={isDeficit ? 'seed-negative' : ''}>{isDeficit ? `적자 ${krw(Math.abs(available))}` : krw(available)}</strong>. 투자 시기는 급여 입금과 다음 필수 지출을 확인해 결정합니다.</p></div>
          <div className="seed-plan-field"><label>남겨둘 돈 <input type="number" inputMode="numeric" min="0" step="1000" value={draft.reserve || ''} placeholder="0" aria-describedby="hint-reserve" onChange={(event) => updateAmount('reserve', event.target.value)} /> 원</label><AmountHint id="hint-reserve" value={draft.reserve} /><QuickAdd label="여유금" onAdd={(step) => updateAmount('reserve', String(draft.reserve + step))} /></div>
          <div className="seed-plan-field"><label>이번 달 목표 <input type="number" inputMode="numeric" min="0" step="1000" value={draft.plan || ''} placeholder="0" aria-describedby="hint-plan" onChange={(event) => updateAmount('plan', event.target.value)} /> 원</label><AmountHint id="hint-plan" value={draft.plan} /><QuickAdd label="계획금" onAdd={(step) => updateAmount('plan', String(draft.plan + step))} /></div>
        </div>
        <div className="seed-goal-tools" aria-label="목표 정하기 도움">
          <strong>목표 정하기 도움 <Detail><small>제안값일 뿐이며 누르기 전에는 바뀌지 않습니다. 최종 금액은 직접 정합니다.</small></Detail></strong>
          <div>
            {ratioGoal > 0 && <button type="button" className="seed-secondary" onClick={() => updateAmount('plan', String(ratioGoal))}>여력의 30% 채우기 ({krw(ratioGoal)})</button>}
            {previous && previous.plan > 0 && <button type="button" className="seed-secondary" onClick={() => updateAmount('plan', String(previous.plan))}>지난달 목표 그대로 ({krw(previous.plan)})</button>}
            <label>올해 목표 총액 <input type="number" inputMode="numeric" min="0" step="10000" value={annualGoal} placeholder="선택" onChange={(event) => setAnnualGoal(event.target.value)} /> 원</label>
            {annualPerMonth !== null && <button type="button" className="seed-secondary" onClick={() => updateAmount('plan', String(annualPerMonth))}>연 목표 역산으로 채우기 ({krw(annualPerMonth)})</button>}
          </div>
          <Detail><p className="seed-payday-help">연 목표 역산은 올해 이미 확보한 돈을 뺀 나머지를 이번 달 포함 남은 {remainingMonths}개월로 나눈 값입니다. 못 모은 달의 부족분을 자동으로 다음 달에 더하지는 않습니다.</p></Detail>
        </div>
        <Detail>{reserveMonths !== null && <p className="seed-payday-help" id="seed-buffer">안전 완충 {reserveMonths.toFixed(1)}개월치 (남겨둘 돈 ÷ 이번 달 지출). 정해진 기준은 없으며 참고용입니다. 미달이어도 확보를 막지 않습니다.</p>}</Detail>
        <Detail>{conservativeAvailable !== null && <p className="seed-payday-help">최근 3개월 중 가장 낮은 달 기준 보수적 여력 {signedKrw(conservativeAvailable)} (일시 수입 제외). 소득이 들쭉날쭉하면 목표의 참고로 쓰세요.</p>}</Detail>
        <Detail>{availableChange !== null && <p className="seed-compare seed-available-change">지난달 대비 투자 여력 <strong className={availableChange >= 0 ? 'seed-positive' : 'seed-negative'}>{availableChange >= 0 ? '+' : '-'}{krw(Math.abs(availableChange))}</strong> · 이번 달 입력값 기준이며 지출·수입이 바뀌면 다시 계산됩니다.</p>}</Detail>
        {isDeficit && <div className="seed-rest-box" role="status">
          <p><strong>이번 달은 지출이 수입보다 {krw(Math.abs(available))} 많습니다.</strong> 이런 달은 시드 목표를 쉬어가도 괜찮습니다. 쉬어도 기록은 정상적으로 남습니다.</p>
          {draft.plan > 0 && <button type="button" className="seed-secondary" onClick={() => setDraft((current) => ({ ...current, plan: 0 }))}>이번 달 목표 0원으로 쉬기</button>}
        </div>}
        {!isDeficit && income > 0 && draft.plan > available && <p className="seed-warning">목표가 참고 여력을 넘습니다. 필요한 생활비를 먼저 확보했는지 확인해 주세요.</p>}
        {isTight && <p className="seed-warning">여력 대부분을 목표로 잡았습니다(빠듯함). 예상 밖 지출에 대비해 여유를 남겨 둘지 확인해 보세요.</p>}
        {draft.status === 'skipped' && <p className="seed-empty">이 달은 건너뜀으로 표시되어 있습니다. 금액을 입력하고 저장하면 기록된 달로 바뀝니다.</p>}
        {isFuture && <p className="seed-empty">다음 달은 계획만 입력할 수 있습니다. 확보와 입금 기록은 그 달이 된 뒤에 남길 수 있습니다.</p>}
        <div className="seed-actions">{canSkip && <button type="button" className="seed-link-button" onClick={() => void skipMonth()} disabled={saving}>이 달은 건너뛰기</button>}{dirty && <span className="seed-dirty-badge">저장 안 됨</span>}<p role="status">{!clientId ? '로그인 정보가 확인되면 저장할 수 있습니다.' : loading ? '기록을 불러오는 중입니다.' : loadError ? `불러오기 실패: ${loadError}` : notice}</p><button type="button" className="seed-primary" onClick={() => void save()} disabled={!clientId || loading || saving || !!loadError}><Save size={16} /> {saving ? '저장 중' : '이번 달 저장'}</button></div>
      </section>
      <section className="seed-entries" aria-label="확보 내역">
        <div className="seed-section-title"><div><h2>확보 내역</h2><p>실제로 따로 모아 둔 돈을 날짜별로 기록합니다. 내역은 바로 저장되고, 취소해도 기록은 남습니다.</p></div><Detail><span>입금 기록 = 증권계좌에 넣었다는 내 기록 (잔고 확인 아님)</span></Detail></div>
        {isFuture ? <p className="seed-empty">다음 달에는 확보 내역을 기록할 수 없습니다.</p> : <>
          {(entries[selectedMonth] ?? []).length === 0 ? <p className="seed-empty">아직 기록한 확보 내역이 없습니다. 0원인 달도 정상입니다.</p> : <ul className="seed-entry-list">
            {(entries[selectedMonth] ?? []).map((entry) => <li key={entry.id} className={entry.cancelled ? 'is-cancelled' : ''}>
              <span className="seed-entry-date">{entry.date.slice(5).replace('-', '/')}</span>
              <strong>{krw(entry.amount)}</strong>
              <span className="seed-entry-memo">{entry.memo}{entry.cancelled ? ' (취소됨)' : ''}</span>
              {entry.cancelled
                ? <button type="button" className="seed-link-button" disabled={entryBusy} onClick={() => void toggleCancel(entry)}>되돌리기</button>
                : <span className="seed-entry-actions">
                  <label>입금 <input type="number" inputMode="numeric" min="0" max={entry.amount} step="1000" defaultValue={entry.deposited || ''} placeholder="0" aria-label={`${entry.date} 입금 기록 금액`} onBlur={(event) => { if (Number(event.target.value || 0) !== entry.deposited) void applyDeposit(entry, event.target.value === '' ? '0' : event.target.value) }} /> 원</label>
                  <button type="button" className="seed-link-button" disabled={entryBusy} onClick={() => void toggleCancel(entry)}>취소</button>
                </span>}
            </li>)}
          </ul>}
          <div className="seed-entry-form">
            <label>날짜 <input type="date" min={`${selectedMonth}-01`} max={selectedMonth === currentKey ? todayKst() : `${selectedMonth}-31`} value={entryForm.date || (selectedMonth === currentKey ? todayKst() : `${selectedMonth}-01`)} onChange={(event) => setEntryForm((current) => ({ ...current, date: event.target.value }))} /></label>
            <label>확보 금액 <input type="number" inputMode="numeric" min="1" step="1000" value={entryForm.amount} placeholder="0" aria-describedby="hint-entry" onChange={(event) => setEntryForm((current) => ({ ...current, amount: event.target.value }))} /> 원</label>
            <span className="seed-plan-field"><AmountHint id="hint-entry" value={Number(entryForm.amount) || 0} /><QuickAdd label="기록액" onAdd={(step) => setEntryForm((current) => ({ ...current, amount: String((Number(current.amount) || 0) + step) }))} /></span>
            <label>메모 <input type="text" maxLength={100} value={entryForm.memo} placeholder="선택" onChange={(event) => setEntryForm((current) => ({ ...current, memo: event.target.value }))} /></label>
            <button type="button" className="seed-secondary" disabled={entryBusy || !clientId || loading || !!loadError} onClick={() => void addEntry()}>+ 확보 기록</button>
            {savedNow > 0 && <button type="button" className="seed-link-button" onClick={() => document.getElementById('seed-next-step')?.scrollIntoView?.({ behavior: 'smooth' })}>다음 행동 보기 <ArrowRight size={14} /></button>}
          </div>
        </>}
      </section>
      <Detail><section className="seed-insights">
        <div className="seed-section-title"><div><h2>지출 변화 보기</h2><p>저장된 큰 항목을 비교합니다. 필요한 지출을 줄이라고 판단하지 않습니다.</p></div></div>
        {currentSaved && <p className="seed-insight-tip">이번 달 지출 {krw(Object.values(currentSaved.expenses).reduce((sum, value) => sum + value, 0))} · 월간 계산상 여력 {signedKrw(savedAvailable)} · 실제 시드 확보 {krw(savedNow)}. {savedAvailable > savedNow ? `차이 ${krw(savedAvailable - savedNow)}은 계획을 돌아볼 참고값이며 모두 써버린 돈이라는 뜻은 아닙니다.` : '필요한 생활비와 추가 입금 여부를 함께 확인하세요.'}</p>}
        {changedRows.length > 0 ? <>
          <div className="seed-expense-rows">
            {visibleRows.map((entry) => <div key={entry.key}><strong>{entry.label}{oneOffKeys.includes(entry.key) && <em className="seed-oneoff">일시</em>}</strong><span>{krw(entry.previous)} → {krw(entry.current)}</span><span className={entry.difference > 0 && !oneOffKeys.includes(entry.key) ? 'seed-rise' : ''}>{entry.difference === 0 ? '변동 없음' : `${entry.difference > 0 ? '+' : '-'}${krw(Math.abs(entry.difference))}`}</span></div>)}
          </div>
          {changedRows.length > 3 && <button type="button" className="seed-link-button" aria-expanded={showAllChanges} onClick={() => setShowAllChanges(!showAllChanges)}>{showAllChanges ? '변동 큰 3개만 보기' : `전체 ${changedRows.length}개 항목 보기`}</button>}
          {riseTip && <p className="seed-insight-tip">{riseTip.label} 지출이 지난달보다 {krw(riseTip.difference)} 늘었습니다. 반복되는 지출인지 확인해 보세요. 이 중 월 {krw(Math.min(riseTip.difference, 10_000))}을 실제로 줄여 시드로 확보한다면 1년 추가 원금은 {krw(Math.min(riseTip.difference, 10_000) * 12)}입니다. 자동으로 모인 돈은 아닙니다. 세금·공과금 같은 일시 항목은 반복 지출로 판단하지 않습니다.</p>}
        </> : <p className="seed-empty">이번 달과 지난달 기록을 저장하면 항목별 변화가 보입니다.</p>}
      </section></Detail>
      <Detail><p className="seed-next-note">지난달 기록은 변화 비교에만 사용합니다. 새 달 수입·급여일은 우리 집 수입으로 미리 채우고, 카드대금·고정비·비정기 항목은 그달 금액을 직접 입력하거나 점검 값으로 채운 뒤 투자 여력을 확인합니다.</p></Detail>
      <section className="seed-next-step" id="seed-next-step">
        <div className="seed-section-title"><div><h2>시드에 맞는 다음 행동</h2><p>저렴한 종목을 억지로 고르지 않아도 됩니다. 매수하지 않고 모으는 것도 선택입니다.</p></div></div>
        <div className="seed-next-inputs">
          <label>증권계좌에서 직접 확인한 가용 현금 <input type="number" inputMode="numeric" min="0" step="1000" value={confirmedCash} placeholder="0" onChange={(event) => setConfirmedCash(event.target.value)} /> 원</label>
          <label>관심 종목 또는 ETF의 현재 1주 가격 <input type="number" inputMode="numeric" min="1" step="1" value={sharePrice} placeholder="선택 입력" onChange={(event) => setSharePrice(event.target.value)} /> 원</label>
        </div>
        {canCompare && <p className="seed-buy-check">{cash < price ? `현재 금액으로는 1주를 살 수 없습니다. 가격 기준으로 ${krw(price - cash)}이 더 필요합니다. 기다리거나, 투자 근거가 있는 다른 선택지를 검토하세요.` : `가격만 비교하면 최대 ${Math.floor(cash / price).toLocaleString('ko-KR')}주입니다. 수수료·가격 변동·남겨둘 현금을 빼면 실제 가능 수량은 더 적을 수 있습니다.`}</p>}
        {canCompare && cash < price && (records[selectedMonth]?.plan ?? 0) > 0 && <p className="seed-next-note">적립 주기 계산: 이번 달 계획 {krw(records[selectedMonth]?.plan ?? 0)}을 매달 모두 모은다고 가정하면 부족분 {krw(price - cash)}을 채우는 데 약 {Math.ceil((price - cash) / (records[selectedMonth]?.plan ?? 1))}개월 걸립니다. 그동안 가격이 바뀔 수 있고, 종목 추천이 아니라 단순 산술입니다.</p>}
        <Detail><p className="seed-next-note">ETF도 가격뿐 아니라 추종 대상·위험·비용을 확인해야 합니다. 잦은 매매는 작은 시드를 빠르게 키운다는 보장이 없으며 비용과 손실 위험이 있습니다.</p></Detail>
        <button type="button" className="seed-secondary" disabled={!Number.isSafeInteger(cash) || cash <= 0 || confirmedCash === ''} onClick={() => setConfirmTransfer(true)}><ArrowRight size={16} /> 확인한 금액으로 시뮬레이터 보기</button>
        {confirmTransfer && <div className="seed-transfer-sheet" role="alertdialog" aria-label="시뮬레이터로 전달할 값 확인">
          <p><strong>전달되는 값:</strong> 증권계좌에서 확인했다고 입력한 가용 현금 {krw(cash)} (이번 화면 이동에만 사용)</p>
          <p><strong>전달하지 않는 것:</strong> 수입·지출 기록, 확보 내역, 입금 기록, 목표. 가상 시드·저장된 계획·자동매매도 바뀌지 않습니다.</p>
          <div><button type="button" className="seed-primary" onClick={() => navigate('/simulator', { state: { seedBuilderCapital: cash } })}>확인하고 이동</button><button type="button" className="seed-link-button" onClick={() => setConfirmTransfer(false)}>취소</button></div>
        </div>}
        <Detail><p className="seed-next-note">이 금액은 이번 화면 이동에만 전달됩니다. 가상 시드·기존 저장 계획·자동매매는 바뀌지 않습니다.</p></Detail>
      </section>
      </>}
      <Detail><section className="seed-manage" aria-label="내 기록 관리">
        <strong>내 기록 관리</strong>
        <p>이 기록은 본인 계정에서만 조회되며, 지워도 가상 시드·자동 입금·자동매매 설정은 바뀌지 않습니다.</p>
        <div>
          <button type="button" className="seed-secondary" onClick={exportYear} disabled={Object.keys(records).length === 0}>{year}년 기록 내려받기 (JSON)</button>
          {!confirmDeleteAll
            ? <button type="button" className="seed-link-button" onClick={() => setConfirmDeleteAll(true)} disabled={!clientId || loading}>시드 만들기 기록 전체 삭제</button>
            : <span className="seed-delete-confirm" role="alertdialog" aria-label="전체 삭제 확인">모든 연도의 월 기록과 확보 내역이 삭제되며 되돌릴 수 없습니다. <button type="button" className="seed-primary" disabled={saving} onClick={() => void deleteAll()}>삭제</button> <button type="button" className="seed-link-button" onClick={() => setConfirmDeleteAll(false)}>취소</button></span>}
        </div>
      </section></Detail>
      <p className="seed-disclaimer"><Wallet size={15} /> 이 기록은 가상 시드·자동 입금·자동매매에 반영되지 않습니다. 투자 원금과 수익도 구분됩니다.</p>
    </main>
  )
}