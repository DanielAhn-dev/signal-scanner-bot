import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { futureValue, REALISTIC_ANNUAL_PCT, suggestMonthly } from '../../lib/startPlan'
import { useJourney } from '../../lib/journey'
import { EMPTY_HOUSEHOLD_INCOME, HOUSEHOLDS, householdTotal, useHouseholdIncome, withHousehold, type HouseholdIncome } from '../../lib/householdIncome'
import {
  FLOW_CATEGORIES, categoryById, compareSummaries, evaluateFlowCheck, toSeedExpenses,
  type CutLevel, type FlowCheckInput, type FlowItem, type FlowKind, type IrregularItem, type Payment,
} from '../../../../src/lib/moneyFlow'

export type SavedCheck = { id: string; date: string; label: string; input: FlowCheckInput }
type Entry = { date: string; amount: number; categoryId: string; payment: Payment; cut: CutLevel | null; mustPart: number | null }
type Row = FlowItem & { key: string }
type IrrRow = IrregularItem & { key: string }

const krw = (value: number) => `${value < 0 ? '−' : ''}${Math.abs(Math.round(value)).toLocaleString('ko-KR')}원`
const man = (value: number) => `${Math.round(value / 10_000).toLocaleString('ko-KR')}만원`
const CUT_LABEL: Record<CutLevel, string> = { must: '못 줄임', trim: '줄일 수 있음', drop: '끊을 수 있음' }
/** 결제 수단 고르기 — 환급·캐시백은 돌려받은 돈이라 그만큼 현금 지출에서 빠진다 */
export const PAYMENT_OPTIONS: Array<[Payment, string]> = [
  ['cash', '카드·현금'], ['point_regular', '포인트(매달 꾸준히)'], ['point_once', '포인트(이번만)'],
  ['refund_regular', '환급·캐시백(매달)'], ['refund_once', '환급·캐시백(이번만)'],
]
const newKey = () => Math.random().toString(36).slice(2)
const num = (v: string) => { const n = Math.round(Number(v.replace(/,/g, ''))); return Number.isFinite(n) && n > 0 ? n : 0 }
const catsOf = (kind: FlowKind) => FLOW_CATEGORIES.filter((c) => c.kind === kind)
const stripKeys = <T extends { key: string }>(rows: T[]) => rows.map(({ key: _key, ...rest }) => rest)
const kstMonth = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 7)
const rowKey = (r: { categoryId: string; payment?: Payment }) => `${r.categoryId}|${r.payment ?? 'cash'}`
/** 고정지출 줄 옆에 보여 줄 실제 기록 — 기준은 바꾸지 않고 비교만 한다 */
type Actual = { month: string; byKey: Map<string, number> }

/** 기록한 지출을 소분류·결제 수단별로 묶어 점검 줄로 만든다. 비정기 소분류는 그 달에 나간 1년치로 본다 */
export function rowsFromEntries(entries: Entry[]): { fixed: Row[]; variable: Row[]; irregular: IrrRow[] } {
  const groups = new Map<string, { categoryId: string; payment: Payment; amount: number; month: number }>()
  for (const e of entries) {
    const k = `${e.categoryId}|${e.payment}`
    const g = groups.get(k) ?? { categoryId: e.categoryId, payment: e.payment, amount: 0, month: Number(e.date.slice(5, 7)) }
    g.amount += e.amount
    groups.set(k, g)
  }
  const out = { fixed: [] as Row[], variable: [] as Row[], irregular: [] as IrrRow[] }
  for (const g of groups.values()) {
    const c = categoryById(g.categoryId)
    if (!c) continue
    if (c.kind === 'irregular') out.irregular.push({ key: newKey(), categoryId: c.id, label: c.label, yearlyAmount: g.amount, months: [g.month], payment: g.payment })
    else out[c.kind].push({ key: newKey(), categoryId: c.id, label: c.label, amount: g.amount, payment: g.payment })
  }
  return out
}

function CatSelect({ kind, value, onChange, label }: { kind: FlowKind; value: string; onChange: (id: string) => void; label: string }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {catsOf(kind).map((c) => <option key={c.id} value={c.id}>{c.major} · {c.label}</option>)}
    </select>
  )
}

function ItemRows({ kind, rows, setRows, actual }: { kind: 'fixed' | 'variable'; rows: Row[]; setRows: (rows: Row[]) => void; actual?: Actual }) {
  const update = (key: string, patch: Partial<Row>) => setRows(rows.map((r) => r.key === key ? { ...r, ...patch } : r))
  // 같은 분류·결제 수단 줄이 여럿이면(전기·가스를 따로 적은 경우) 기록은 합계로만 비교한다 — 어느 줄 몫인지 알 수 없어 바꾸기 버튼은 없다
  const actualNote = (r: Row) => {
    const recorded = actual?.byKey.get(rowKey(r))
    const group = rows.filter((x) => rowKey(x) === rowKey(r))
    if (recorded === undefined || group[0].key !== r.key) return null
    const base = group.reduce((sum, x) => sum + x.amount, 0)
    if (recorded === base) return null
    const month = `${Number(actual!.month.slice(5))}월`
    return (
      <p className="acc-note mf-actual">
        {month} 기록 {krw(recorded)}{group.length > 1 ? ` · 이 분류 ${group.length}줄 합계 ${krw(base)}` : ''} ({recorded > base ? '기준보다 ' + krw(recorded - base) + ' 많음' : '기준보다 ' + krw(base - recorded) + ' 적음'})
        {group.length === 1 && <> <button type="button" className="acc-link" onClick={() => update(r.key, { amount: recorded, mustPart: r.mustPart && r.mustPart > recorded ? recorded : r.mustPart })}>기록 금액으로 바꾸기</button></>}
      </p>
    )
  }
  return (
    <div className="mf-check-rows">
      {rows.map((r, i) => {
        const level = r.cut ?? categoryById(r.categoryId)?.cut ?? 'trim'
        const name = r.label || `${kind === 'fixed' ? '고정' : '변동'} ${i + 1}`
        return (
          <div key={r.key} className="mf-check-row">
            <input className="mf-check-name" aria-label={`${name} 이름`} value={r.label ?? ''} placeholder="이름(선택)" maxLength={40} onChange={(e) => update(r.key, { label: e.target.value })} />
            <CatSelect kind={kind} label={`${name} 분류`} value={r.categoryId} onChange={(id) => update(r.key, { categoryId: id, cut: undefined })} />
            <input type="number" inputMode="numeric" min="0" aria-label={`${name} 월 금액`} value={r.amount || ''} placeholder="월 금액" onChange={(e) => update(r.key, { amount: num(e.target.value) })} />
            <select aria-label={`${name} 줄일 수 있나`} value={level} onChange={(e) => update(r.key, { cut: e.target.value as CutLevel })}>
              {(['must', 'trim', 'drop'] as const).map((l) => <option key={l} value={l}>{CUT_LABEL[l]}</option>)}
            </select>
            {level !== 'must' && <input type="number" inputMode="numeric" min="0" aria-label={`${name} 못 줄이는 몫`} value={r.mustPart || ''} placeholder="이 중 못 줄이는 몫(선택)" onChange={(e) => update(r.key, { mustPart: Math.min(num(e.target.value), r.amount) || undefined })} />}
            <select aria-label={`${name} 결제 수단`} value={r.payment ?? 'cash'} onChange={(e) => update(r.key, { payment: e.target.value as Payment })}>
              {PAYMENT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <button type="button" className="acc-link" onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>빼기</button>
            {actualNote(r)}
          </div>
        )
      })}
      <button type="button" className="acc-link" onClick={() => setRows([...rows, { key: newKey(), categoryId: catsOf(kind)[0].id, amount: 0, label: '' }])}>+ {kind === 'fixed' ? '고정지출' : '변동지출'} 추가</button>
    </div>
  )
}

function IrregularRows({ rows, setRows }: { rows: IrrRow[]; setRows: (rows: IrrRow[]) => void }) {
  const update = (key: string, patch: Partial<IrrRow>) => setRows(rows.map((r) => r.key === key ? { ...r, ...patch } : r))
  return (
    <div className="mf-check-rows">
      {rows.map((r, i) => {
        const name = r.label || `비정기 ${i + 1}`
        return (
          <div key={r.key} className="mf-check-row">
            <input className="mf-check-name" aria-label={`${name} 이름`} value={r.label} placeholder="이름(예: 자동차보험)" maxLength={40} onChange={(e) => update(r.key, { label: e.target.value })} />
            <CatSelect kind="irregular" label={`${name} 분류`} value={r.categoryId} onChange={(id) => update(r.key, { categoryId: id })} />
            <input type="number" inputMode="numeric" min="0" aria-label={`${name} 1년 금액`} value={r.yearlyAmount || ''} placeholder="1년 합계" onChange={(e) => update(r.key, { yearlyAmount: num(e.target.value) })} />
            <div className="mf-months" role="group" aria-label={`${name} 나가는 달`}>
              {Array.from({ length: 12 }, (_, m) => m + 1).map((m) => (
                <button key={m} type="button" aria-pressed={r.months.includes(m)} className={r.months.includes(m) ? 'is-active' : ''} onClick={() => update(r.key, { months: r.months.includes(m) ? r.months.filter((x) => x !== m) : [...r.months, m].sort((a, b) => a - b) })}>{m}</button>
              ))}
            </div>
            <button type="button" className="acc-link" onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>빼기</button>
          </div>
        )
      })}
      <button type="button" className="acc-link" onClick={() => setRows([...rows, { key: newKey(), categoryId: 'tax', label: '', yearlyAmount: 0, months: [] }])}>+ 비정기 지출 추가</button>
    </div>
  )
}

export default function FlowCheck({ entries, checks, onSaved, fromStart }: { entries: Entry[]; checks: SavedCheck[]; onSaved: () => Promise<void> | void; fromStart: boolean }) {
  const navigate = useNavigate()
  const latest = checks[0] ?? null
  const withKeys = <T,>(list: T[] | undefined) => (list ?? []).map((x) => ({ ...x, key: newKey() }))
  // 수입은 '우리 집 수입' 한 벌을 시작하기·시드 만들기와 같이 쓴다. 저장값이 생기기 전에는 지난 점검의 합계로 시작한다
  const incomeStore = useHouseholdIncome()
  const [household, setHousehold] = useState<HouseholdIncome>(() => (latest ? { ...EMPTY_HOUSEHOLD_INCOME, ownIncome: latest.input.monthlyIncome } : EMPTY_HOUSEHOLD_INCOME))
  const [householdLoaded, setHouseholdLoaded] = useState(false)
  const [reserve, setReserve] = useState(latest ? String(latest.input.reserveMonthly) : '')
  const [fixed, setFixed] = useState<Row[]>(() => withKeys(latest?.input.fixed))
  const [variable, setVariable] = useState<Row[]>(() => withKeys(latest?.input.variable))
  const [irregular, setIrregular] = useState<IrrRow[]>(() => withKeys(latest?.input.irregular))
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  // 저장하고 나면 길잡이의 다음 단계를 바로 보여 준다(시작하기에서 온 사람은 돌아가기 버튼이 그 역할)
  const journey = useJourney(saved && !fromStart)

  // 저장된 우리 집 수입이 있으면 그 값이 기준. 없고 지난 점검도 없으면 시드 만들기 기록에서 가져온 값을 보여 준다
  useEffect(() => {
    if (householdLoaded || !incomeStore.ready) return
    if (incomeStore.value && (incomeStore.saved || !latest)) setHousehold(incomeStore.value)
    setHouseholdLoaded(true)
  }, [incomeStore.ready, incomeStore.value, incomeStore.saved, householdLoaded, latest])
  const editHousehold = (next: HouseholdIncome) => { setHousehold(next); incomeStore.set(next) }
  const dual = household.household === 'dual-income'

  // 가장 최근에 기록한 달(이번 달 포함)의 지출로 채운다 — 매달 적지 않아도 마지막 기록이 기준
  const recordedMonth = entries.map((e) => e.date.slice(0, 7)).sort().pop() ?? null
  const recordedRows = useMemo(() => (recordedMonth ? rowsFromEntries(entries.filter((e) => e.date.startsWith(recordedMonth))) : null), [entries, recordedMonth])
  // 고정지출은 기준(평소 금액)이라 한 달 실제로 덮지 않는다. 공과금처럼 달마다 조금씩 다른 건 옆에 기록 금액만 보여 준다
  const fixedActual: Actual | undefined = recordedMonth && recordedRows ? { month: recordedMonth, byKey: new Map(recordedRows.fixed.map((r) => [rowKey(r), r.amount])) } : undefined
  const fillFromRecords = () => {
    if (!recordedMonth || !recordedRows) return
    const rows = recordedRows
    const merge = <T extends { categoryId: string; payment?: Payment }>(cur: T[], add: T[]) => [...cur.filter((r) => !add.some((a) => rowKey(a) === rowKey(r))), ...add]
    setVariable((cur) => merge(cur, rows.variable))
    setIrregular((cur) => merge(cur, rows.irregular))
    // 고정지출은 아직 없는 분류만 더한다
    setFixed((cur) => [...cur, ...rows.fixed.filter((a) => !cur.some((r) => rowKey(r) === rowKey(a)))])
    setNotice(`${recordedMonth.replace('-', '년 ')}월 기록으로 채웠습니다. 변동·비정기는 기록 금액으로 바꿨고, 고정지출은 평소 기준을 그대로 두고 기록 금액을 옆에 보여 줍니다(없던 분류만 추가).`)
  }

  const input: FlowCheckInput = useMemo(() => ({
    monthlyIncome: householdTotal(household), reserveMonthly: num(reserve),
    fixed: stripKeys(fixed).filter((r) => r.amount > 0), variable: stripKeys(variable).filter((r) => r.amount > 0),
    irregular: stripKeys(irregular).filter((r) => r.yearlyAmount > 0),
  }), [household, reserve, fixed, variable, irregular])
  const result = useMemo(() => evaluateFlowCheck(input), [input])
  const prev = latest && saved ? checks[1] ?? null : latest
  const prevResult = useMemo(() => (prev ? evaluateFlowCheck(prev.input) : null), [prev])
  const changes = prevResult ? compareSummaries(prevResult.summary, result.summary).filter((c) => c.difference !== 0).slice(0, 5) : []
  const hasAny = input.monthlyIncome > 0 && result.summary.consumption > 0
  const half = suggestMonthly(result.available)
  const dueMonths = Object.entries(result.irregularDueByMonth).sort((a, b) => b[1] - a[1]).slice(0, 3)

  const save = async () => {
    setSaving(true)
    setNotice('')
    try {
      const res = await apiFetch('/api/ui/money-flow', { method: 'POST', body: JSON.stringify({ action: 'save-check', label: `${kstMonth().replace('-', '년 ')}월 점검`, input }), cacheMs: 0 })
      if (res?.ok === false) throw new Error(res.error || '저장 실패')
      setSaved(true)
      setNotice('점검을 저장했습니다. 다음 점검은 이 결과와 비교합니다.')
      await onSaved()
    } catch (e) {
      setNotice(`저장 실패: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSaving(false)
    }
  }

  // 시드 만들기 이번 달 기록에 반영: 지출 큰 항목(현금 기준)·수입·비상자금 적립. 목표·확보 기록·일시 수입은 그대로 둔다
  const applyToSeed = async () => {
    if (!window.confirm('시드 만들기 이번 달 수입·지출·남겨둘 돈을 이 점검 값으로 바꿀까요? 이번 달 목표와 확보 기록은 그대로 둡니다.')) return
    try {
      const month = kstMonth()
      const rows: any[] = await apiFetch(`/api/ui/seed-builder?year=${month.slice(0, 4)}`, { cacheMs: 0, retries: 0 }).then((r) => (Array.isArray(r?.data) ? r.data : []))
      const cur = rows.find((r) => r?.month === month)
      // 수입은 사람별로 나눠 둔 우리 집 수입 그대로 — 합계만 넘기면 맞벌이가 '혼자'로 바뀐다
      const partnerIncome = dual ? household.partnerIncome : 0
      const seed = toSeedExpenses([...input.fixed, ...input.variable, ...input.irregular.map((i) => ({ categoryId: i.categoryId, amount: Math.round(i.yearlyAmount / 12), payment: i.payment }))])
      await apiFetch('/api/ui/seed-builder', {
        method: 'PUT', cacheMs: 0,
        body: JSON.stringify({
          month, status: 'recorded', household: household.household, ownIncome: household.ownIncome, partnerIncome,
          ownPayday: cur?.ownPayday ?? household.ownPayday, partnerPayday: dual ? cur?.partnerPayday ?? household.partnerPayday : null,
          expenses: { card: 0, water: 0, gas: 0, residentTax: 0, propertyTax: 0, vehicleTax: 0, taxAdjustment: 0, ...seed },
          extraIncome: { incentive: 0, vacation: 0, taxRefund: 0, other: 0, ...cur?.extraIncome }, reserve: input.reserveMonthly, plan: Number(cur?.plan ?? 0),
        }),
      })
      setNotice('시드 만들기 이번 달 기록에 반영했습니다.')
    } catch (e) {
      setNotice(`반영 실패: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return (
    <>
      <section className="acc-card">
        <h2>지금 상태 점검</h2>
        <p className="acc-note">한 번 해 두면 다음 점검 때 그대로 불러옵니다. 바뀐 것만 고치면 됩니다. 금액은 모두 한 달 기준입니다(비정기는 1년 합계).</p>
        <h3>우리 집 수입</h3>
        <div className="acc-seg" role="group" aria-label="가구 형태">
          {HOUSEHOLDS.map(([value, label]) => <button key={value} type="button" aria-pressed={household.household === value} className={household.household === value ? 'is-active' : ''} onClick={() => editHousehold(withHousehold(household, value))}>{label}</button>)}
        </div>
        <div className="acc-row">
          <label className="acc-field"><span>{household.household === 'solo' ? '월 수입(세후)' : '본인 월 수입(세후)'}</span><input type="number" inputMode="numeric" min="0" value={household.ownIncome || ''} onChange={(e) => editHousehold({ ...household, ownIncome: num(e.target.value) })} placeholder="0" /></label>
          {dual && <label className="acc-field"><span>배우자 월 수입(세후)</span><input type="number" inputMode="numeric" min="0" value={household.partnerIncome || ''} onChange={(e) => editHousehold({ ...household, partnerIncome: num(e.target.value) })} placeholder="0" /></label>}
        </div>
        <p className="acc-note">{dual && household.partnerIncome > 0 ? `합계 ${krw(householdTotal(household))}. ` : ''}시작하기·시드 만들기와 같은 값이라 여기서 고치면 바로 저장되고 거기에도 반영됩니다. 성과급처럼 가끔 들어오는 돈은 시드 만들기의 그달 추가 수입에 적습니다.</p>
        <div className="acc-row">
          <label className="acc-field"><span>매달 비상자금으로 떼는 돈</span><input type="number" inputMode="numeric" min="0" value={reserve} onChange={(e) => setReserve(e.target.value)} placeholder="0" /></label>
        </div>
      </section>

      <section className="acc-card">
        <h2>고정지출</h2>
        <p className="acc-note">매달 같은 날 거의 같은 금액(월세·관리비·통신·보험·구독·학원 등). 이름은 내가 알아보기 쉽게 적으면 됩니다. 돌려받는 돈(교통 환급·캐시백)은 같은 분류로 한 줄 더 넣고 결제 수단을 '환급·캐시백'으로 고르면 그만큼 빠집니다. 공과금처럼 달마다 조금씩 다른 건 평소 금액(높은 쪽)을 적으세요. 기록이 있으면 옆에 실제 금액이 보이고, 바꿀지는 직접 고릅니다.</p>
        <ItemRows kind="fixed" rows={fixed} setRows={setFixed} actual={fixedActual} />
      </section>

      <section className="acc-card">
        <h2>변동지출</h2>
        {recordedMonth
          ? <button type="button" className="acc-primary" onClick={fillFromRecords}>{recordedMonth.replace('-', '년 ')}월 기록으로 채우기</button>
          : <p className="acc-note">빠른 기록에 한 달 정도 적어 두면 여기서 한 번에 채울 수 있습니다. 지금은 대략 금액을 직접 넣어도 됩니다.</p>}
        <ItemRows kind="variable" rows={variable} setRows={setVariable} />
      </section>

      <section className="acc-card">
        <h2>비정기 지출</h2>
        <p className="acc-note">1년에 몇 번 나가는 돈(재산세·자동차보험·명절·여행 등). 1년 합계와 나가는 달을 고르면 평소 매달 떼어 둘 금액을 계산합니다.</p>
        <IrregularRows rows={irregular} setRows={setIrregular} />
      </section>

      {notice && <p className="acc-note mf-notice" role="status">{notice}</p>}

      {hasAny && (
        <section className="acc-card" aria-label="점검 결과">
          <h2>결과</h2>
          <dl className="acc-tiles">
            <div className="is-main"><dt>지금 투자 가능액(월)</dt><dd>{krw(result.available)}</dd><small>수입 − 현금 지출 − 비상자금 적립</small></div>
            <div><dt>최대로 줄이면</dt><dd>{krw(result.maxIfCut)}</dd><small>못 줄이는 지출만 남길 때</small></div>
            <div><dt>줄일 여지</dt><dd>{krw(result.room)}</dd></div>
            <div><dt>고정지출 비율</dt><dd>{result.fixedRatio === null ? '-' : `${Math.round(result.fixedRatio * 100)}%`}</dd></div>
          </dl>
          {result.summary.pointRegular + result.summary.pointOnce + result.summary.refundRegular + result.summary.refundOnce > 0 && (
            <p className="acc-note">포인트·환급이 없으면 투자 가능액은 <strong>{krw(result.availableWithoutPoints)}</strong>입니다.{result.summary.pointOnce + result.summary.refundOnce > 0 && ` "이번만" 포인트·환급(${krw(result.summary.pointOnce + result.summary.refundOnce)})이 끝나면 ${krw(result.availableWithoutOncePoints)}.`}{result.summary.refundRegular > 0 && ` 매달 돌려받는 ${krw(result.summary.refundRegular)}은 투자 가능액에 이미 들어 있습니다.`}</p>
          )}
          {result.topCuttable.length > 0 && (
            <>
              <h3>줄일 여지가 큰 곳</h3>
              <ul className="mf-changes">
                {result.topCuttable.slice(0, 3).map((t) => <li key={t.categoryId}><span>{categoryById(t.categoryId)?.label} <small>{t.drop > 0 ? '끊을 수 있음' : '줄일 수 있음'}</small></span><span>{krw(t.trim + t.drop)}</span></li>)}
              </ul>
              <p className="acc-note">줄이라는 뜻이 아닙니다. 줄인다면 어디가 큰지 보여 드릴 뿐입니다.</p>
            </>
          )}
          <h3>비상자금 기준</h3>
          <p className="acc-note">못 줄이는 생활비 한 달 <strong>{krw(result.mustMonthly)}</strong> → 3개월 {man(result.mustMonthly * 3)} · 6개월 {man(result.mustMonthly * 6)}. 위기 때는 끊을 수 있는 건 끊으므로 전체 지출보다 이 기준이 현실적입니다.</p>
          {dueMonths.length > 0 && <p className="acc-note">목돈이 나가는 달: {dueMonths.map(([m, v]) => `${m}월 ${man(v)}`).join(' · ')}. 평소 매달 {krw(input.irregular.reduce((s, i) => s + Math.round(i.yearlyAmount / 12), 0))}씩 떼어 두면 그 달에 투자를 멈추지 않아도 됩니다.</p>}

          {result.available > 0 ? (
            <>
              <h3>이 돈을 매달 넣으면</h3>
              <table className="acc-table" aria-label="적립 예상">
                <thead><tr><th>매달</th><th>10년 뒤</th><th>20년 뒤</th></tr></thead>
                <tbody>
                  {[...new Set([half, Math.floor(result.available / 10_000) * 10_000])].filter((m) => m > 0).map((m) => (
                    <tr key={m}><td>{man(m)}{m === half ? ' (절반)' : ' (전부)'}</td><td>{man(futureValue(0, m, 10, REALISTIC_ANNUAL_PCT))}</td><td>{man(futureValue(0, m, 20, REALISTIC_ANNUAL_PCT))}</td></tr>
                  ))}
                </tbody>
              </table>
              <p className="acc-note mf-basis">가정: 지수 장기 평균 연 {REALISTIC_ANNUAL_PCT}%로 매달 말 적립(물가 반영 전 금액). 과거 평균일 뿐 보장이 아니며, 중간에 크게 떨어지는 해가 있습니다. 해마다 범위는 <Link to="/plan">계획 점검</Link>, 무엇을 살지는 <Link to="/accumulate">모아가기</Link>에서 봅니다. 절반을 기본으로 두는 이유는 예상 밖 지출에도 적립을 멈추지 않기 위해서입니다.</p>
            </>
          ) : <p className="acc-warn">지금은 지출이 수입보다 많거나 남는 돈이 없습니다. 이런 달은 투자보다 지출 점검이 먼저입니다. 가상 계좌 연습은 괜찮습니다.</p>}

          {prev && prevResult && (
            <>
              <h3>{prev.date} 점검보다</h3>
              <p className="acc-note">투자 가능액 {krw(prevResult.available)} → <strong>{krw(result.available)}</strong> ({result.available - prevResult.available >= 0 ? '+' : ''}{krw(result.available - prevResult.available)})</p>
              {changes.length > 0 && <ul className="mf-changes">{changes.map((c) => <li key={c.categoryId}><span>{categoryById(c.categoryId)?.label}</span><span className={c.difference > 0 ? 'is-up' : 'is-down'}>{c.difference > 0 ? '+' : '−'}{krw(Math.abs(c.difference))}</span></li>)}</ul>}
            </>
          )}

          <div className="mf-check-actions">
            <button type="button" className="acc-primary" disabled={saving} onClick={() => void save()}>{saving ? '저장 중…' : '이 점검 저장'}</button>
            <button type="button" className="acc-link" onClick={() => void applyToSeed()}>시드 만들기 이번 달에 반영</button>
            {fromStart && <button type="button" className="acc-link" onClick={() => navigate('/start')}>시작하기로 돌아가기</button>}
          </div>
          {journey && journey.next.key !== 'money' && (
            <p className="acc-summary">다음 할 일: <strong>{journey.next.label}</strong> — {journey.next.desc} <Link to={`/${journey.next.route}`}>지금 하기 →</Link></p>
          )}
        </section>
      )}
    </>
  )
}
