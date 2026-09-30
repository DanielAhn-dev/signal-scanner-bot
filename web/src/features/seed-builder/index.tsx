import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, ChevronLeft, ChevronRight, Save, Wallet } from 'lucide-react'
import { apiFetch } from '../../lib/api'
import { useCurrentClientId } from '../../stores/profileStore'
import './seed-builder.css'

type Household = 'solo' | 'single-income' | 'dual-income'
type ExpenseKey = 'food' | 'housing' | 'vehicle' | 'education' | 'tax' | 'subscriptions' | 'other' | 'card' | 'water' | 'gas' | 'residentTax' | 'propertyTax' | 'vehicleTax' | 'taxAdjustment'
type ExtraIncomeKey = 'incentive' | 'vacation' | 'taxRefund' | 'other'
type MonthRecord = {
  household: Household
  ownIncome: number
  partnerIncome: number
  ownPayday: number | null
  partnerPayday: number | null
  expenses: Record<ExpenseKey, number>
  extraIncome: Record<ExtraIncomeKey, number>
  reserve: number
  plan: number
  saved: number
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
  household: 'solo', ownIncome: 0, partnerIncome: 0, ownPayday: null, partnerPayday: null,
  expenses: { food: 0, housing: 0, vehicle: 0, education: 0, tax: 0, subscriptions: 0, other: 0, card: 0, water: 0, gas: 0, residentTax: 0, propertyTax: 0, vehicleTax: 0, taxAdjustment: 0 },
  extraIncome: { incentive: 0, vacation: 0, taxRefund: 0, other: 0 },
  reserve: 0, plan: 0, saved: 0,
})

const krw = (amount: number) => `${Math.round(amount).toLocaleString('ko-KR')}원`
const signedKrw = (amount: number) => `${amount < 0 ? '-' : ''}${krw(Math.abs(amount))}`
const recurringExpenseKeys: ExpenseKey[] = ['food', 'housing', 'vehicle', 'education', 'tax', 'subscriptions', 'other']
const sumValues = (values: Record<string, number>) => Object.values(values).reduce((sum, value) => sum + value, 0)
const monthIncome = (record: MonthRecord) => record.ownIncome + (record.household === 'dual-income' ? record.partnerIncome : 0) + sumValues(record.extraIncome)
// 여력은 0으로 자르지 않는다. 적자 규모를 그대로 보여줘야 이번 달 목표를 쉬어갈지 판단할 수 있다.
const monthAvailable = (record: MonthRecord) => monthIncome(record) - sumValues(record.expenses) - record.reserve
const monthKey = (date: Date) => date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).slice(0, 7)

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

  const year = Number(selectedMonth.slice(0, 4))
  const month = Number(selectedMonth.slice(5))
  useEffect(() => {
    setRecords({})
    setDraft(emptyRecord())
    if (!clientId) { setLoading(false); return }
    let active = true
    setLoading(true)
    setLoadError('')
    apiFetch(`/api/ui/seed-builder?year=${year}`, { cacheMs: 0, retries: 0 })
      .then((response) => {
        if (!active) return
        const loaded = Object.fromEntries((response.data as Array<MonthRecord & { month: string }>).map(({ month: key, ...record }) => {
          const defaults = emptyRecord()
          return [key, { ...defaults, ...record, expenses: { ...defaults.expenses, ...record.expenses }, extraIncome: { ...defaults.extraIncome, ...record.extraIncome } }]
        }))
        setRecords(loaded)
        setDraft(loaded[selectedMonth] ?? emptyRecord())
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
  const dirty = JSON.stringify(draft) !== JSON.stringify(records[selectedMonth] ?? emptyRecord())
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
  const subscriptionChange = expenseChanges.find((entry) => entry.key === 'subscriptions')
  const annualSaved = Object.entries(records).filter(([key]) => key.startsWith(`${year}-`)).reduce((sum, [, record]) => sum + record.saved, 0)
  const maxBar = Math.max(1, ...Array.from({ length: 12 }, (_, index) => records[`${year}-${String(index + 1).padStart(2, '0')}`]?.saved ?? 0))
  const cash = Number(confirmedCash)
  const price = Number(sharePrice)
  const canCompare = confirmedCash !== '' && sharePrice !== '' && Number.isSafeInteger(cash) && cash >= 0 && Number.isSafeInteger(price) && price > 0

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
    setDraft(next.slice(0, 4) === selectedMonth.slice(0, 4) ? records[next] ?? emptyRecord() : emptyRecord())
    setNotice('')
  }

  const updateAmount = (field: 'ownIncome' | 'partnerIncome' | 'reserve' | 'plan' | 'saved', value: string) => {
    const parsed = Number(value)
    setDraft((current) => ({ ...current, [field]: Number.isFinite(parsed) ? parsed : 0 }))
    setNotice('')
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

  const save = async (): Promise<boolean> => {
    if (!clientId || loading || loadError) return false
    if ([draft.ownIncome, draft.partnerIncome, draft.reserve, draft.plan, draft.saved, ...Object.values(draft.expenses), ...Object.values(draft.extraIncome)].some((amount) => !Number.isSafeInteger(amount) || amount < 0)
      || [draft.ownPayday, draft.partnerPayday].some((day) => day !== null && (!Number.isInteger(day) || day < 1 || day > 31))) {
      setNotice('금액은 0원 이상의 정수로 입력해 주세요.')
      return false
    }
    setSaving(true)
    setNotice('')
    try {
      await apiFetch('/api/ui/seed-builder', { method: 'PUT', body: JSON.stringify({ month: selectedMonth, ...draft }), cacheMs: 0 })
      setRecords((current) => ({ ...current, [selectedMonth]: { ...draft, expenses: { ...draft.expenses }, extraIncome: { ...draft.extraIncome } } }))
      setNotice('이번 달 기록을 저장했습니다.')
      return true
    } catch (error) {
      setNotice(`저장 실패: ${error instanceof Error ? error.message : String(error)}`)
      return false
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="seed-builder">
      <header className="seed-header">
        <div><span className="seed-eyebrow">투자 전 단계</span><h1>시드 만들기</h1><p>큰 돈의 흐름을 보고, 이번 달 모을 수 있는 금액을 정합니다.</p></div>
        <div className="seed-month-nav" aria-label="기록 월 선택">
          <button type="button" title="이전 달" aria-label="이전 달" onClick={() => changeMonth(-1)}><ChevronLeft size={18} /></button>
          <strong>{year}년 {month}월</strong>
          <button type="button" title="다음 달" aria-label="다음 달" onClick={() => changeMonth(1)} disabled={selectedMonth >= monthKey(new Date())}><ChevronRight size={18} /></button>
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
        <div><span>이번 달 계획</span><strong>{krw(records[selectedMonth]?.plan ?? 0)}</strong></div>
        <div><span>실제로 모은 돈</span><strong>{krw(records[selectedMonth]?.saved ?? 0)}</strong></div>
        <div><span>올해 모은 돈</span><strong>{krw(annualSaved)}</strong></div>
      </section>

      <section className="seed-chart-section">
        <div className="seed-section-title"><div><h2>{year}년 월별 시드</h2><p>입력해 모은 금액만 실적으로 표시합니다.</p></div><span>사용자 기록 · 투자 수익 제외</span></div>
        <div className="seed-chart" role="img" aria-label={`${year}년 월별 확보금: ${Array.from({ length: 12 }, (_, index) => { const record = records[`${year}-${String(index + 1).padStart(2, '0')}`]; return `${index + 1}월 ${record ? krw(record.saved) : '기록 없음'}` }).join(', ')}`}>
          {Array.from({ length: 12 }, (_, index) => {
            const key = `${year}-${String(index + 1).padStart(2, '0')}`
            const record = records[key]
            const saved = record?.saved ?? 0
            return <div className={`seed-chart-column${selectedMonth === key ? ' is-selected' : ''}`} key={key}><div className="seed-bar-area">{record ? (saved ? <div className="seed-bar" style={{ height: `${Math.max(4, saved / maxBar * 100)}%` }} /> : <div className="seed-bar-zero">0</div>) : <div className="seed-bar-none" aria-hidden="true" />}</div><span>{index + 1}월</span></div>
          })}
        </div>
        <p className="seed-chart-legend">실선 막대 = 기록한 확보금 · “0” = 기록했지만 모으지 않은 달 · 점선 = 아직 기록 없음</p>
        {annualSaved === 0 && <p className="seed-empty">첫 금액을 저장하면 이곳에서 시드가 쌓이는 추이를 볼 수 있습니다.</p>}
      </section>

      <section className="seed-editor">
        <div className="seed-section-title"><div><h2>이번 달 돈의 흐름</h2><p>큰 금액만 입력해도 됩니다. 항목별 거래 내역은 필요하지 않습니다.</p></div></div>
        {previous && <div className="seed-fill-row"><button type="button" className="seed-secondary" onClick={fillFromPrevious}>지난달 값 채우기</button><span>수입·급여일·식비 등 반복 항목만 채웁니다. 일시 항목은 복사하지 않습니다.</span></div>}
        <div className="seed-form-grid">
          <div className="seed-input-group">
            <h3>수입</h3>
            <div className="seed-segments" role="group" aria-label="가구 형태">
              {([['solo', '혼자'], ['single-income', '외벌이'], ['dual-income', '맞벌이']] as const).map(([value, label]) => <button key={value} type="button" className={draft.household === value ? 'is-active' : ''} aria-pressed={draft.household === value} onClick={() => setDraft((current) => ({ ...current, household: value, partnerIncome: value === 'dual-income' ? current.partnerIncome : 0, partnerPayday: value === 'dual-income' ? current.partnerPayday : null }))}>{label}</button>)}
            </div>
            <label> {draft.household === 'solo' ? '월수입' : '본인 월수입'} <input type="number" min="0" step="1000" value={draft.ownIncome || ''} placeholder="0" onChange={(event) => updateAmount('ownIncome', event.target.value)} /> <span>원</span></label>
            {draft.household === 'dual-income' && <label>배우자 월수입 <input type="number" min="0" step="1000" value={draft.partnerIncome || ''} placeholder="0" onChange={(event) => updateAmount('partnerIncome', event.target.value)} /> <span>원</span></label>}
            <div className="seed-paydays">
              <label>본인 급여일 <input type="number" min="1" max="31" value={draft.ownPayday ?? ''} placeholder="선택" onChange={(event) => { setDraft((current) => ({ ...current, ownPayday: event.target.value === '' ? null : Number(event.target.value) })); setNotice('') }} /> <span>일</span></label>
              {draft.household === 'dual-income' && <label>배우자 급여일 <input type="number" min="1" max="31" value={draft.partnerPayday ?? ''} placeholder="선택" onChange={(event) => { setDraft((current) => ({ ...current, partnerPayday: event.target.value === '' ? null : Number(event.target.value) })); setNotice('') }} /> <span>일</span></label>}
            </div>
            {paydays.length > 0 && <p className="seed-payday-summary">{paydays.map((entry) => `${entry.day}일 ${entry.label} ${krw(entry.amount)}`).join(' · ')}</p>}
            <button className="seed-link-button" type="button" onClick={() => setShowExtraIncome(!showExtraIncome)}>{showExtraIncome ? '추가 수입 접기' : '인센티브·휴가비 등 추가 수입'}</button>
            {showExtraIncome && <div className="seed-optional-inputs">{extraIncomeLabels.map(({ key, label }) => <label key={key}>{label}<input type="number" min="0" step="1000" value={draft.extraIncome[key] || ''} placeholder="0" onChange={(event) => { const value = Number(event.target.value); setDraft((current) => ({ ...current, extraIncome: { ...current.extraIncome, [key]: Number.isFinite(value) ? value : 0 } })); setNotice('') }} /><span>원</span></label>)}</div>}
            <p className="seed-payday-help">월수입 합계 {krw(income)}{extraIncomeTotal > 0 ? ` (일시 수입 ${krw(extraIncomeTotal)} 포함)` : ''}. 아직 받지 않은 급여·일시 수입을 월초 투자 현금으로 계산하지 않습니다.</p>
          </div>
          <div className="seed-input-group">
            <h3>지출 <span>{krw(expenseTotal)}</span></h3>
            {expenseLabels.slice(0, showExpenses ? 8 : 4).map(({ key, label }) => <label key={key}>{label}<input type="number" min="0" step="1000" value={draft.expenses[key] || ''} placeholder="0" onChange={(event) => { const value = Number(event.target.value); setDraft((current) => ({ ...current, expenses: { ...current.expenses, [key]: Number.isFinite(value) ? value : 0 } })); setNotice('') }} /><span>원</span></label>)}
            <button className="seed-link-button" type="button" onClick={() => setShowExpenses(!showExpenses)}>{showExpenses ? '간단히 보기' : '세금·카드대금 등도 입력'}</button>
            {showExpenses && <p className="seed-payday-help">카드대금은 위 항목에 이미 적은 사용액을 제외한 미분류 금액만 입력하세요. 중복 입력하면 지출이 두 번 계산됩니다.</p>}
            {showExpenses && <button className="seed-link-button" type="button" onClick={() => setShowIrregular(!showIrregular)}>{showIrregular ? '비정기 지출 접기' : '수도·가스·계절성 세금 입력'}</button>}
            {showExpenses && showIrregular && <div className="seed-optional-inputs">{expenseLabels.slice(8).map(({ key, label }) => <label key={key}>{label}<input type="number" min="0" step="1000" value={draft.expenses[key] || ''} placeholder="0" onChange={(event) => { const value = Number(event.target.value); setDraft((current) => ({ ...current, expenses: { ...current.expenses, [key]: Number.isFinite(value) ? value : 0 } })); setNotice('') }} /><span>원</span></label>)}<p className="seed-payday-help">2개월치 공과금은 납부한 달에 전액 적습니다. 세금·보험에 이미 포함한 금액은 다시 넣지 마세요.</p></div>}
            {previousExpense !== null && <p className="seed-compare">지난달 총지출 {krw(previousExpense)} · 이번 달 {krw(Math.abs(expenseTotal - previousExpense))} {expenseTotal >= previousExpense ? '증가' : '감소'}</p>}
          </div>
        </div>
        <div className="seed-plan-row">
          <div><h3>시드 계획</h3><p>월수입 - 지출 - 남겨둘 생활·비상자금 = 월간 참고 여력 <strong className={isDeficit ? 'seed-negative' : ''}>{isDeficit ? `적자 ${krw(Math.abs(available))}` : krw(available)}</strong>. 투자 시기는 급여 입금과 다음 필수 지출을 확인해 결정합니다.</p></div>
          <label>남겨둘 돈 <input type="number" min="0" step="1000" value={draft.reserve || ''} placeholder="0" onChange={(event) => updateAmount('reserve', event.target.value)} /> 원</label>
          <label>이번 달 목표 <input type="number" min="0" step="1000" value={draft.plan || ''} placeholder="0" onChange={(event) => updateAmount('plan', event.target.value)} /> 원</label>
          <label>실제로 모은 돈 <input type="number" min="0" step="1000" value={draft.saved || ''} placeholder="0" onChange={(event) => updateAmount('saved', event.target.value)} /> 원</label>
        </div>
        {availableChange !== null && <p className="seed-compare seed-available-change">지난달 대비 투자 여력 <strong className={availableChange >= 0 ? 'seed-positive' : 'seed-negative'}>{availableChange >= 0 ? '+' : '-'}{krw(Math.abs(availableChange))}</strong> · 이번 달 입력값 기준이며 지출·수입이 바뀌면 다시 계산됩니다.</p>}
        {isDeficit && <div className="seed-rest-box" role="status">
          <p><strong>이번 달은 지출이 수입보다 {krw(Math.abs(available))} 많습니다.</strong> 이런 달은 시드 목표를 쉬어가도 괜찮습니다. 쉬어도 기록은 정상적으로 남습니다.</p>
          {draft.plan > 0 && <button type="button" className="seed-secondary" onClick={() => setDraft((current) => ({ ...current, plan: 0 }))}>이번 달 목표 0원으로 쉬기</button>}
        </div>}
        {!isDeficit && income > 0 && draft.plan > available && <p className="seed-warning">목표가 참고 여력을 넘습니다. 필요한 생활비를 먼저 확보했는지 확인해 주세요.</p>}
        {isTight && <p className="seed-warning">여력 대부분을 목표로 잡았습니다(빠듯함). 예상 밖 지출에 대비해 여유를 남겨 둘지 확인해 보세요.</p>}
        <div className="seed-actions">{dirty && <span className="seed-dirty-badge">저장 안 됨</span>}<p role="status">{!clientId ? '로그인 정보가 확인되면 저장할 수 있습니다.' : loading ? '기록을 불러오는 중입니다.' : loadError ? `불러오기 실패: ${loadError}` : notice}</p><button type="button" className="seed-primary" onClick={() => void save()} disabled={!clientId || loading || saving || !!loadError}><Save size={16} /> {saving ? '저장 중' : '이번 달 저장'}</button></div>
      </section>
      <section className="seed-insights">
        <div className="seed-section-title"><div><h2>지출 변화 보기</h2><p>저장된 큰 항목을 비교합니다. 필요한 지출을 줄이라고 판단하지 않습니다.</p></div></div>
        {currentSaved && <p className="seed-insight-tip">이번 달 지출 {krw(Object.values(currentSaved.expenses).reduce((sum, value) => sum + value, 0))} · 월간 계산상 여력 {signedKrw(savedAvailable)} · 실제 시드 확보 {krw(currentSaved.saved)}. {savedAvailable > currentSaved.saved ? `차이 ${krw(savedAvailable - currentSaved.saved)}은 계획을 돌아볼 참고값이며 모두 써버린 돈이라는 뜻은 아닙니다.` : '필요한 생활비와 추가 입금 여부를 함께 확인하세요.'}</p>}
        {expenseChanges.length > 0 ? <>
          <div className="seed-expense-rows">
            {expenseChanges.map((entry) => <div key={entry.key}><strong>{entry.label}</strong><span>{krw(entry.previous)} → {krw(entry.current)}</span><span className={entry.difference > 0 ? 'seed-rise' : ''}>{entry.difference === 0 ? '변동 없음' : `${entry.difference > 0 ? '+' : '-'}${krw(Math.abs(entry.difference))}`}</span></div>)}
          </div>
          {subscriptionChange && subscriptionChange.difference > 0 && <p className="seed-insight-tip">통신·구독 지출이 지난달보다 {krw(subscriptionChange.difference)} 늘었습니다. 반복되는 지출인지 확인해 보세요. 이 중 월 {krw(Math.min(subscriptionChange.difference, 10_000))}을 실제로 줄여 시드로 확보한다면 1년 추가 원금은 {krw(Math.min(subscriptionChange.difference, 10_000) * 12)}입니다. 자동으로 모인 돈은 아닙니다.</p>}
        </> : <p className="seed-empty">이번 달과 지난달 기록을 저장하면 항목별 변화가 보입니다.</p>}
      </section>
      <p className="seed-next-note">지난달 기록은 변화 비교에만 사용합니다. 새 달 수입·카드대금·고정비·비정기 항목은 자동으로 가져오지 않으며, 그달 금액을 직접 입력한 뒤 투자 여력을 확인합니다.</p>
      <section className="seed-next-step">
        <div className="seed-section-title"><div><h2>시드에 맞는 다음 행동</h2><p>저렴한 종목을 억지로 고르지 않아도 됩니다. 매수하지 않고 모으는 것도 선택입니다.</p></div></div>
        <div className="seed-next-inputs">
          <label>증권계좌에서 직접 확인한 가용 현금 <input type="number" min="0" step="1000" value={confirmedCash} placeholder="0" onChange={(event) => setConfirmedCash(event.target.value)} /> 원</label>
          <label>관심 종목 또는 ETF의 현재 1주 가격 <input type="number" min="1" step="1" value={sharePrice} placeholder="선택 입력" onChange={(event) => setSharePrice(event.target.value)} /> 원</label>
        </div>
        {canCompare && <p className="seed-buy-check">{cash < price ? `현재 금액으로는 1주를 살 수 없습니다. 가격 기준으로 ${krw(price - cash)}이 더 필요합니다. 기다리거나, 투자 근거가 있는 다른 선택지를 검토하세요.` : `가격만 비교하면 최대 ${Math.floor(cash / price).toLocaleString('ko-KR')}주입니다. 수수료·가격 변동·남겨둘 현금을 빼면 실제 가능 수량은 더 적을 수 있습니다.`}</p>}
        <p className="seed-next-note">ETF도 가격뿐 아니라 추종 대상·위험·비용을 확인해야 합니다. 잦은 매매는 작은 시드를 빠르게 키운다는 보장이 없으며 비용과 손실 위험이 있습니다.</p>
        <button type="button" className="seed-secondary" disabled={!Number.isSafeInteger(cash) || cash <= 0 || confirmedCash === ''} onClick={() => navigate('/simulator', { state: { seedBuilderCapital: cash } })}><ArrowRight size={16} /> 확인한 금액으로 시뮬레이터 보기</button>
        <p className="seed-next-note">이 금액은 이번 화면 이동에만 전달됩니다. 가상 시드·기존 저장 계획·자동매매는 바뀌지 않습니다.</p>
      </section>
      <p className="seed-disclaimer"><Wallet size={15} /> 이 기록은 가상 시드·자동 입금·자동매매에 반영되지 않습니다. 투자 원금과 수익도 구분됩니다.</p>
    </main>
  )
}