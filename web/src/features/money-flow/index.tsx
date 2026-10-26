import More from '../../components/ui/More'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Pencil, Trash2 } from 'lucide-react'
import { apiFetch } from '../../lib/api'
import {
  FLOW_CATEGORIES, SMALL_UNKNOWN_LIMIT, UNRECORDED_CATEGORY_ID, categoryById, checkForMonth, fixedCashOf, fixedOutsideCardOf, investableOf, irregularFundOf, savingCashOf, irregularForMonth, classifyMemo, compareSummaries, detectPayment, isRefund, monthSpending, needsItemName, parseQuickLines, splitCashWord, splitPartnerWord, suggestCategories, summarizeItems,
  type CutLevel, type FlowItem, type LearnedRule, type Payment,
} from '../../../../src/lib/moneyFlow'
import FlowCheck, { PAYMENT_OPTIONS, type SavedCheck } from './FlowCheck'
import { looksLikeBlockStatement, parseBlockStatement, statementNotice } from '../../lib/statementPaste'
import { cardDetailToReplace } from './cardDetail'
import MonthTotals, { shiftMonth, type MonthTotalRow } from './MonthTotals'
import '../accumulate/accumulate.css'
import './money-flow.css'
import { confirmDialog } from '../../components/ConfirmDialog'

// mine = 내가 기록함, forWhom = 누구 몫(보는 사람 기준). 기록은 한 사람이 해도 지출은 대부분 공용이라 둘은 다르다
type ForWhom = 'shared' | 'me' | 'partner'
// 무엇으로 냈나: card = 월 합계(명세서) 안, cash = 현금·계좌이체 — 합계 밖이라 더한다
type PaidWith = 'card' | 'cash'
type Entry = { id: string; mine?: boolean; forWhom?: ForWhom; editedBy?: 'me' | 'partner' | null; deletedBy?: 'me' | 'partner' | null; date: string; amount: number; memo: string; categoryId: string; cut: CutLevel | null; mustPart: number | null; payment: Payment; paidWith?: PaidWith }
// baseMemo = 붙여 넣은 그대로, item = 통로(네이버페이·쿠팡 등) 이름만 있을 때 덧붙인 산 물건, memo = 저장할 메모
// titleEdited = 저장 전에 제목(memo)을 사용자가 고쳤다 — 명세서의 원래 이름(baseMemo)은 "무슨 가게인지 모르는" 이름일 수 있어 기억해 두면 다음 명세서에서 바로 분류된다
type Draft = { key: string; forWhom: ForWhom; date: string; amountGuessed: boolean; amount: number; baseMemo: string; item: string; askItem: boolean; memo: string; titleEdited: boolean; categoryId: string; autoCategoryId: string; known: boolean; payment: Payment; paidWith: PaidWith }
type EditForm = { id: string; date: string; amount: number; memo: string; categoryId: string; forWhom: ForWhom; payment: Payment; paidWith: PaidWith }

const krw = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`
const kstToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
const monthEnd = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
}
const CUT_LABEL: Record<CutLevel, string> = { must: '못 줄임', trim: '줄일 수 있음', drop: '끊을 수 있음' }
const KIND_LABEL = { fixed: '고정', variable: '변동', irregular: '비정기' } as const
const PAYMENT_TAG: Partial<Record<Payment, string>> = { point_regular: '포인트', point_once: '포인트·이번만', refund_regular: '환급·매달', refund_once: '환급·이번만' }
// 기본은 공용. 나·배우자는 한 사람만 쓴 게 분명할 때만 고른다(누구 카드로 냈는지가 아니라 누구를 위한 지출인지)
const WHOM_LABEL: Record<ForWhom, string> = { shared: '공용', me: '내 것', partner: '배우자 것' }
const whomOf = (entry: { forWhom?: ForWhom }): ForWhom => entry.forWhom ?? 'shared'
const paidOf = (entry: { paidWith?: PaidWith }): PaidWith => entry.paidWith ?? 'card'
/** 카드 세부(합계 안)와 현금 세부(합계 밖) 요약을 따로 낸다 */
const splitSummaries = (list: Entry[]) => ({
  card: summarizeItems(list.filter((e) => paidOf(e) !== 'cash').map(toItem)),
  cash: summarizeItems(list.filter((e) => paidOf(e) === 'cash').map(toItem)),
})
/**
 * 통장 기준(이번 달 나가는 돈)의 세부 기록: 카드는 지난달에 쓴 돈이 이 달에 빠져나가고, 현금은 낸 달에 나간다.
 * 월 합계 칸은 결제월 기준이라, 세부 기록과 맞춰 볼 때는 이 기준으로 골라야 기간이 같다.
 */
const paidBasis = (list: Entry[], month: string) => list.filter((e) => e.date.startsWith(paidOf(e) === 'cash' ? month : shiftMonth(month, -1)))

/** 그 달 통장 기준 투자 가능액(합계 칸과 예산이 있을 때만). 화면 맨 위 한 줄과 같은 값이다 */
function investFor(month: string, allEntries: Entry[], totals: MonthTotalRow[], checks: SavedCheck[]) {
  const plan = checkForMonth(checks, month)?.input ?? null
  const monthTotals = totals.filter((t) => t.month === month)
  if (!plan || monthTotals.length === 0) return { plan, invest: null as number | null }
  const split = splitSummaries(paidBasis(allEntries, month))
  const rec = monthSpending(monthTotals, split.card, split.cash, fixedOutsideCardOf(plan))
  const irregular = irregularForMonth(plan, Number(month.slice(5)), allEntries.filter((e) => e.date.startsWith(month)))
  return { plan, invest: investableOf(plan, rec.cash - fixedCashOf(plan) - irregular.total) }
}
const LIST_PAGE = 10
const toItem = (entry: Entry): FlowItem => ({ categoryId: entry.categoryId, amount: entry.amount, payment: entry.payment, cut: entry.cut ?? undefined, mustPart: entry.mustPart ?? undefined })

function WhomSelect({ value, onChange, label }: { value: ForWhom; onChange: (value: ForWhom) => void; label: string }) {
  return (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value as ForWhom)}>
      {(Object.keys(WHOM_LABEL) as ForWhom[]).map((key) => <option key={key} value={key}>{WHOM_LABEL[key]}</option>)}
    </select>
  )
}

function CategorySelect({ value, onChange, label }: { value: string; onChange: (id: string) => void; label: string }) {
  const groups = useMemo(() => {
    const map = new Map<string, typeof FLOW_CATEGORIES>()
    for (const c of FLOW_CATEGORIES) {
      if (c.id === UNRECORDED_CATEGORY_ID) continue
      const key = `${KIND_LABEL[c.kind]} · ${c.major}`
      map.set(key, [...(map.get(key) ?? []), c])
    }
    return [...map.entries()]
  }, [])
  return (
    <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      {groups.map(([group, items]) => (
        <optgroup key={group} label={group}>
          {items.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </optgroup>
      ))}
    </select>
  )
}

/**
 * ① 예산(mode=budget) · ② 지출 기록(record) 두 화면이 같은 데이터를 쓴다.
 * 예전 주소 ?tab=check는 예산으로, ?tab=maturity는 이번 달 투자금(모아 둔 시드)으로 보낸다.
 */
export default function MoneyFlowPage({ mode = 'record' }: { mode?: 'record' | 'budget' }) {
  const today = kstToday()
  const thisMonth = today.slice(0, 7)
  const [params] = useSearchParams()
  const budget = mode === 'budget' || params.get('tab') === 'check'
  const toMaturity = params.get('tab') === 'maturity'
  const fromStart = params.get('from') === 'start'
  const [checks, setChecks] = useState<SavedCheck[]>([])
  const [checksLoaded, setChecksLoaded] = useState(false)
  const [month, setMonth] = useState(thisMonth)
  // use = 이번 달 쓴 돈(이용월 기준, 입력·세부 기록) · pay = 이번 달 나가는 돈(통장 기준, 합계·투자 가능액). 평소 입력이 많아 쓴 돈이 먼저다
  const [view, setView] = useState<'use' | 'pay'>('use')
  // 세부 기록 목록은 길어지니 앞쪽만 보이고 더보기로 늘린다(달을 바꾸면 처음으로)
  const [listLimit, setListLimit] = useState(LIST_PAGE)
  useEffect(() => setListLimit(LIST_PAGE), [month])
  const [entries, setEntries] = useState<Entry[]>([])
  const [deleted, setDeleted] = useState<Entry[]>([])
  const [rules, setRules] = useState<LearnedRule[]>([])
  const [partnerShared, setPartnerShared] = useState(false)
  const [totals, setTotals] = useState<MonthTotalRow[]>([])
  const [totalsReady, setTotalsReady] = useState(true)
  const [scope, setScope] = useState<'home' | 'me'>('home')
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const [text, setText] = useState('')
  const [date, setDate] = useState(today)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [failed, setFailed] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState<EditForm | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // 매달 적을 필요는 없다. 비교 기준(마지막으로 기록한 달)과 비정기 작년 대비를 보려고 24개월 전부터 가져온다
      const res = await apiFetch(`/api/ui/money-flow?from=${shiftMonth(month, -24)}-01&to=${monthEnd(month)}`, { cacheMs: 0, retries: 0 })
      setEntries(Array.isArray(res?.entries) ? res.entries : [])
      setDeleted(Array.isArray(res?.deleted) ? res.deleted : [])
      setRules(Array.isArray(res?.rules) ? res.rules : [])
      setPartnerShared(res?.partnerShared === true)
      setTotals(Array.isArray(res?.totals) ? res.totals : [])
      setTotalsReady(res?.totalsReady !== false)
      setChecks(Array.isArray(res?.checks) ? res.checks : [])
      setChecksLoaded(true)
    } catch (error) {
      setNotice(`불러오기 실패: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setLoading(false)
    }
  }, [month])
  useEffect(() => { void load() }, [load])

  // 부부 연결로 상대 기록이 오면 '우리 집 합계'와 '배우자 것 빼고'를 고를 수 있다. 누가 적었든 배우자 것만 빠지고 공용은 남는다
  // 부부 연결 없이 혼자 둘 몫을 적는 사람도 있으니, 직접 골랐을 때만 거른다
  const scoped = partnerShared && scope === 'me' ? entries.filter((e) => whomOf(e) !== 'partner') : entries
  // 월 합계는 카드 단위라 누구 몫으로 나눌 수 없다. '배우자 것 빼고'에서는 내가 적은 칸만 센다
  const scopedTotals = partnerShared && scope === 'me' ? totals.filter((t) => t.mine) : totals
  const monthEntries = scoped.filter((e) => e.date.startsWith(month))
  // 이번 달 쓴 돈(이용월 기준): 카드로 쓴 것은 다음 달에 나간다
  const usage = splitSummaries(monthEntries)
  // 이번 달 나가는 돈(통장 기준): 카드는 지난달 이용분, 현금은 이 달 것
  const payEntries = paidBasis(scoped, month)
  const monthDetail = splitSummaries(payEntries)
  // 기준 = 이 달 이전에 기록(세부 또는 합계)이 있는 가장 최근 달. 그사이 달을 건너뛰었어도 그 기록이 기준으로 남는다
  const baseMonth = [...scoped.map((e) => (paidOf(e) === 'cash' ? e.date.slice(0, 7) : shiftMonth(e.date.slice(0, 7), 1))), ...scopedTotals.map((t) => t.month)].filter((m) => m < month).sort().pop() ?? null
  const baseEntries = baseMonth ? paidBasis(scoped, baseMonth) : []
  const headline = investFor(thisMonth, scoped, scopedTotals, checks)
  const suggestions = suggestCategories(entries.filter((e) => e.mine !== false).slice(0, 60).map((e) => e.categoryId))

  const readInput = () => {
    // 카드 명세서(현대카드·삼성 모니모)를 복사해 붙여넣은 글은 한 줄형("날짜 가게 금액원")으로 바꿔서 읽는다(이미 있는 건·취소는 뺌)
    let source = text
    let blockNotice = ''
    if (looksLikeBlockStatement(text)) {
      const converted = parseBlockStatement(text, today, entries.map((e) => ({ date: e.date, amount: e.amount })))
      source = converted.lines.join('\n')
      blockNotice = statementNotice(converted)
      setText(source)
    }
    const { parsed, failed: bad } = parseQuickLines(source, today)
    setFailed(bad)
    setNotice(blockNotice)
    setDrafts(parsed.map((p, i) => {
      // "배우자"는 어디에 있든 배우자 것 표시로 바꾸고(없으면 공용), 분류·학습은 그 단어를 뺀 메모로 한다
      // "현금"·서울페이·계좌이체 등이 있으면 현금으로 표시한다("현금" 단어는 뺀다)
      const cash = splitCashWord(p.memo)
      const { memo, forPartner } = splitPartnerWord(cash.memo)
      const result = classifyMemo(memo, rules)
      // 줄 맨 앞에 날짜(261001 등)가 있으면 그 날짜, 없으면 아래 날짜 칸
      return { key: `${Date.now()}-${i}`, forWhom: forPartner ? 'partner' : 'shared', date: p.date ?? date, amountGuessed: p.amountGuessed, amount: p.amount, baseMemo: memo, item: '', askItem: needsItemName(memo), memo, titleEdited: false, categoryId: result.categoryId, autoCategoryId: result.categoryId, known: result.source !== 'none', payment: detectPayment(memo), paidWith: cash.paidCash ? 'cash' : 'card' }
    }))
  }
  const updateDraft = (key: string, patch: Partial<Draft>) => setDrafts((list) => list.map((d) => d.key === key ? { ...d, ...patch } : d))
  // 산 물건을 적으면 메모에 덧붙이고 다시 분류한다
  const setDraftItem = (d: Draft, item: string) => {
    const memo = `${d.baseMemo} ${item.trim()}`.trim()
    const result = classifyMemo(memo, rules)
    updateDraft(d.key, { item, memo, categoryId: result.categoryId, autoCategoryId: result.categoryId, known: result.source !== 'none' })
  }
  // 제목을 고치면(예: "네이버파이낸셜(주) - 롯데쇼핑(주)e" → "롯데온 쇼핑") 저장할 메모가 바뀌고, 알아볼 수 있는 이름이면 다시 분류한다.
  // 알아볼 수 없는 이름이면 이미 고른 분류는 그대로 둔다
  const setDraftTitle = (d: Draft, memo: string) => {
    const result = classifyMemo(memo, rules)
    updateDraft(d.key, { memo, titleEdited: true, ...(result.source !== 'none' ? { categoryId: result.categoryId, autoCategoryId: result.categoryId, known: true } : {}) })
  }
  // 작은 금액은 분류를 몰라도 묻지 않는다(기타 생활로 두고, 접어 둔 목록에서 고칠 수 있다)
  const isQuiet = (d: Draft) => !d.known && d.amount > 0 && d.amount < SMALL_UNKNOWN_LIMIT
  const loudDrafts = drafts.filter((d) => !isQuiet(d))
  const quietDrafts = drafts.filter(isQuiet)

  const saveDrafts = async () => {
    if (drafts.length === 0 || saving) return
    if (drafts.some((d) => !d.date || d.date > today)) { setNotice('날짜가 비었거나 오늘 이후인 줄이 있습니다.'); return }
    if (drafts.some((d) => !Number.isSafeInteger(d.amount) || d.amount < 1)) { setNotice('금액이 비어 있는 줄이 있습니다.'); return }
    setSaving(true)
    try {
      const body = {
        action: 'add-entries',
        // 자동 분류를 고쳤거나, 모르던 메모를 직접 고른 경우만 기억한다(소액이라 묻지 않고 넘긴 줄은 기억하지 않는다)
        entries: drafts.map((d) => ({ date: d.date, amount: d.amount, memo: d.memo, categoryId: d.categoryId, payment: d.payment, forWhom: d.forWhom, paidWith: d.paidWith, learn: d.memo !== '' && ((!d.known && !isQuiet(d)) || d.categoryId !== d.autoCategoryId || (d.titleEdited && d.baseMemo !== '' && d.memo !== d.baseMemo)), ...(d.titleEdited && d.baseMemo && d.memo !== d.baseMemo ? { learnMemo: d.baseMemo } : {}) })),
      }
      await apiFetch('/api/ui/money-flow', { method: 'POST', body: JSON.stringify(body), cacheMs: 0 })
      setNotice(`${drafts.length}건 기록했습니다.`)
      setDrafts([])
      setText('')
      setFailed([])
      const latest = drafts.map((d) => d.date).sort().pop()!
      if (!latest.startsWith(month)) setMonth(latest.slice(0, 7))
      else await load()
    } catch (error) {
      setNotice(`저장 실패: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSaving(false)
    }
  }

  const updateEntry = (entry: Entry, patch: Partial<Entry>, learn: boolean) => {
    const next = { ...entry, ...patch }
    return apiFetch('/api/ui/money-flow', { method: 'POST', body: JSON.stringify({ action: 'update-entry', id: entry.id, date: next.date, amount: next.amount, memo: next.memo, categoryId: next.categoryId, payment: next.payment, forWhom: whomOf(next), paidWith: paidOf(next), cut: next.cut, mustPart: next.mustPart && next.mustPart <= next.amount ? next.mustPart : null, learn }), cacheMs: 0 })
  }

  // 목록은 읽기 전용으로 두고, 고칠 줄만 '고치기'를 눌러 펼친다
  const startEdit = (e: Entry) => setEditing({ id: e.id, date: e.date, amount: e.amount, memo: e.memo, categoryId: e.categoryId, forWhom: whomOf(e), payment: e.payment, paidWith: paidOf(e) })
  const patchEdit = (patch: Partial<EditForm>) => setEditing((form) => form ? { ...form, ...patch } : form)

  const saveEdit = async (entry: Entry) => {
    if (!editing || saving) return
    const memo = editing.memo.trim()
    if (!editing.date || editing.date > today) { setNotice('날짜가 비었거나 오늘 이후입니다.'); return }
    if (!Number.isSafeInteger(editing.amount) || editing.amount < 1) { setNotice('금액을 1원 이상으로 적어 주세요.'); return }
    // 분류를 바꿨을 때만 기억한다
    const learn = memo !== '' && editing.categoryId !== entry.categoryId
    setSaving(true)
    try {
      await updateEntry(entry, { date: editing.date, amount: editing.amount, memo, categoryId: editing.categoryId, forWhom: editing.forWhom, payment: editing.payment, paidWith: editing.paidWith }, learn)
      setNotice(learn ? `"${memo}"은(는) 다음부터 ${categoryById(editing.categoryId)?.label}(으)로 분류합니다.` : `${memo || '메모 없음'} 기록을 고쳤습니다.`)
      setEditing(null)
      if (!editing.date.startsWith(month)) setMonth(editing.date.slice(0, 7))
      else await load()
    } catch (error) {
      setNotice(`수정 실패: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSaving(false)
    }
  }

  const removeEntry = async (entry: Entry) => {
    const whose = entry.mine === false ? ' 배우자가 적은 기록입니다. 배우자 화면에도 "배우자가 지움"으로 보이고 둘 다 되돌릴 수 있습니다.' : ''
    if (!(await confirmDialog({ message: `${entry.memo || '메모 없음'} ${krw(entry.amount)} 기록을 지울까요?${whose}`, confirmLabel: '지우기', danger: true }))) return
    try {
      await apiFetch('/api/ui/money-flow', { method: 'POST', body: JSON.stringify({ action: 'delete-entry', id: entry.id }), cacheMs: 0 })
      setEntries((list) => list.filter((e) => e.id !== entry.id))
      void load()
    } catch (error) {
      setNotice(`삭제 실패: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // 명세서로 갈아끼우기 전에 그 달의 카드 세부(쪼개 적은 기록 등)를 한꺼번에 지운다 — 표시만 하는 삭제라 '지운 기록'에서 되돌릴 수 있다
  const bulkRef = useRef(false)
  const [bulkBusy, setBulkBusy] = useState(false)
  const replaceable = cardDetailToReplace(monthEntries)
  const removeMonthCardDetail = async () => {
    if (bulkRef.current || replaceable.length === 0) return
    const total = replaceable.reduce((s, e) => s + e.amount, 0)
    const label = month.replace('-', '년 ') + '월'
    if (!(await confirmDialog({
      message: `${label} 카드 세부 기록 ${replaceable.length}건(${krw(total)})을 모두 지울까요? 현금으로 낸 건·환급·포인트·배우자가 적은 기록은 남깁니다. 지운 기록은 아래 "지운 기록"에서 되돌릴 수 있습니다.`,
      confirmLabel: '모두 지우기', danger: true,
    }))) return
    bulkRef.current = true
    setBulkBusy(true)
    let done = 0
    let failed = 0
    try {
      for (const entry of replaceable) {
        try {
          await apiFetch('/api/ui/money-flow', { method: 'POST', body: JSON.stringify({ action: 'delete-entry', id: entry.id }), cacheMs: 0 })
          done++
        } catch {
          failed++
        }
      }
    } finally {
      bulkRef.current = false
      setBulkBusy(false)
      setNotice(failed === 0 ? `${label} 카드 세부 ${done}건을 지웠습니다. 이제 명세서를 붙여넣어 다시 올려 주세요.` : `${done}건 지움, ${failed}건은 지우지 못했습니다. 다시 눌러 주세요.`)
      await load()
    }
  }

  const restoreEntry = async (entry: Entry) => {
    try {
      await apiFetch('/api/ui/money-flow', { method: 'POST', body: JSON.stringify({ action: 'restore-entry', id: entry.id }), cacheMs: 0 })
      setNotice(`${entry.memo || '메모 없음'} 기록을 되돌렸습니다.`)
      void load()
    } catch (error) {
      setNotice(`되돌리기 실패: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const monthDeleted = deleted.filter((e) => e.date.startsWith(month) && !(partnerShared && scope === 'me' && e.forWhom === 'partner'))

  const renderDraft = (d: Draft) => (
    <div key={d.key} className="mf-draft">
      <div className="mf-draft-head">
        <input type="text" maxLength={100} aria-label={`${d.baseMemo || '메모 없음'} 제목`} value={d.memo} placeholder="무슨 지출인지 제목을 적어 주세요" onChange={(event) => setDraftTitle(d, event.target.value)} />
        {d.titleEdited && d.baseMemo && d.memo !== d.baseMemo && <small className="acc-note">명세서 이름: {d.baseMemo}</small>}
      </div>
      <div className="mf-draft-fields">
        <label><span>날짜</span><input type="date" aria-label={`${d.baseMemo || '메모 없음'} 날짜`} value={d.date} max={today} onChange={(event) => updateDraft(d.key, { date: event.target.value })} /></label>
        <label className={d.amountGuessed ? 'is-guessed' : ''}><span>{d.amountGuessed ? '금액 확인' : '금액'}</span><input type="number" inputMode="numeric" min="1" aria-label={`${d.baseMemo || '메모 없음'} 금액`} value={d.amount || ''} onChange={(event) => updateDraft(d.key, { amount: Math.round(Number(event.target.value) || 0), amountGuessed: false })} /></label>
      </div>
      {d.amountGuessed && <p className="acc-warn mf-cut">"원"이 없고 숫자가 여러 개라 가장 큰 수를 금액으로 골랐습니다. 맞는지 확인해 주세요. 금액 뒤에 "원"을 붙이면 헷갈리지 않습니다.</p>}
      {d.askItem && d.amount >= SMALL_UNKNOWN_LIMIT && (
        <label className="acc-field mf-item">
          <span>뭘 샀는지 알면 적어 주세요(선택). 비워 두면 "온라인 쇼핑"으로 넣습니다</span>
          <input type="text" aria-label={`${d.baseMemo} 산 물건`} value={d.item} placeholder="예: 물티슈, 운동화" onChange={(event) => setDraftItem(d, event.target.value)} />
        </label>
      )}
      {!d.known && !isQuiet(d) && !(d.askItem && !d.item.trim()) && (
        <div className="mf-chips" role="group" aria-label="분류 고르기">
          <span className="acc-note">어디에 넣을까요?</span>
          {suggestions.map((id) => (
            <button key={id} type="button" className={d.categoryId === id ? 'is-active' : ''} aria-pressed={d.categoryId === id} onClick={() => updateDraft(d.key, { categoryId: id })}>{categoryById(id)?.label}</button>
          ))}
        </div>
      )}
      <div className="mf-draft-tools">
        <CategorySelect label={`${d.baseMemo || '메모 없음'} 분류`} value={d.categoryId} onChange={(id) => updateDraft(d.key, { categoryId: id })} />
        <WhomSelect label={`${d.baseMemo || '메모 없음'} 누구 몫`} value={d.forWhom} onChange={(forWhom) => updateDraft(d.key, { forWhom })} />
        <label className="mf-cash-check"><input type="checkbox" checked={d.paidWith === 'cash'} onChange={(event) => updateDraft(d.key, { paidWith: event.target.checked ? 'cash' : 'card' })} />현금으로 냄</label>
        <select aria-label={`${d.baseMemo || '메모 없음'} 결제 수단`} value={d.payment} onChange={(event) => updateDraft(d.key, { payment: event.target.value as Payment })}>
          {PAYMENT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <button type="button" className="acc-remove" onClick={() => setDrafts((list) => list.filter((x) => x.key !== d.key))}>빼기</button>
      </div>
      <p className="mf-cut">{isRefund(d.payment) ? `돌려받은 돈 · ${categoryById(d.categoryId)!.label} 지출에서 빼고 그만큼 투자 가능액에 더합니다` : `${KIND_LABEL[categoryById(d.categoryId)!.kind]} · ${CUT_LABEL[categoryById(d.categoryId)!.cut]}`}</p>
    </div>
  )

  if (toMaturity) return <Navigate to="/seed-builder#maturity" replace />

  return (
    <div className="acc mf">
      {budget ? (
        <header>
          <h1>예산 설정</h1>
          <Link to="/money-flow" className="acc-secondary">지출 기록으로</Link>
        </header>
      ) : (
        <>
          <h2 className="mf-section-title">예산 설정</h2>
          <BudgetSummary check={checks[0] ?? null} loading={!checksLoaded} />
        </>
      )}

      {partnerShared && (
        <section className="acc-card">
          <div className="acc-seg" role="group" aria-label="누구 지출">
            <button type="button" aria-pressed={scope === 'home'} className={scope === 'home' ? 'is-active' : ''} onClick={() => setScope('home')}>우리 집 합계</button>
            <button type="button" aria-pressed={scope === 'me'} className={scope === 'me' ? 'is-active' : ''} onClick={() => setScope('me')}>배우자 것 빼고</button>
          </div>
          <p className="acc-note">배우자가 공유한 기록도 함께 셉니다.</p>
          <More label="배우자 기록 고치기·되돌리기"><p className="acc-note">'배우자 것 빼고'는 누가 적었든 배우자 것으로 표시한 기록만 뺍니다(공용은 남김). 서로의 기록을 고치거나 지울 수 있고, 누가 고치고 지웠는지 표시됩니다. 지운 기록은 둘 다 되돌릴 수 있습니다.</p></More>
        </section>
      )}

      {notice && <p className="acc-note mf-notice" role="status">{notice}</p>}

      {!budget && (
        <>
          <h2 className="mf-section-title">지출 기록</h2>
          {headline.plan && (
            <section className="acc-card" aria-label="이번 달 투자 가능액 한눈에">
              <div className="mf-invest">
                <span>{Number(thisMonth.slice(5))}월 투자 가능액 (통장 기준)</span>
                {headline.invest !== null
                  ? <strong className={headline.invest < 0 ? 'is-negative' : ''}>{krw(headline.invest)}</strong>
                  : <small>{Number(thisMonth.slice(5))}월 카드 결제금액을 "나가는 돈" 탭에 적으면 계산됩니다.</small>}
              </div>
            </section>
          )}
          <div className="acc-seg" role="group" aria-label="지출 보기">
            <button type="button" aria-pressed={view === 'use'} className={view === 'use' ? 'is-active' : ''} onClick={() => { setView('use'); if (month > thisMonth) setMonth(thisMonth) }}>이번 달 쓴 돈</button>
            <button type="button" aria-pressed={view === 'pay'} className={view === 'pay' ? 'is-active' : ''} onClick={() => setView('pay')}>이번 달 나가는 돈</button>
          </div>
          <p className="acc-note">{view === 'use' ? '쓴 날짜 기준으로 적고 확인합니다. 카드로 쓴 돈은 다음 달 통장에서 나갑니다.' : '통장에서 빠져나가는 돈 기준입니다. 이 달에 나가는 카드 결제금액은 지난달에 쓴 돈입니다.'}</p>
        </>
      )}

      {!budget && (
        <div className="mf-pane" hidden={view !== 'use'}>
          <section className="acc-card">
            <div className="mf-month-nav">
              <button type="button" aria-label="이전 달 쓴 돈" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={16} />{Number(shiftMonth(month, -1).slice(5))}월</button>
              <h2>{month.replace('-', '년 ')}월에 쓴 돈</h2>
              <button type="button" aria-label="다음 달 쓴 돈" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= thisMonth}>{Number(shiftMonth(month, 1).slice(5))}월<ChevronRight size={16} /></button>
            </div>
            <dl className="acc-facts" aria-label="이번 달 쓴 돈">
              <div><dt>카드로 쓴 돈 (세부 기록 합)</dt><dd>{krw(usage.card.cash)}</dd></div>
              <div><dt>현금으로 낸 돈</dt><dd>{krw(usage.cash.cash)}</dd></div>
            </dl>
            <p className="acc-note">카드로 쓴 {krw(usage.card.cash)}은 {Number(shiftMonth(month, 1).slice(5))}월에 통장에서 나갈 돈의 예상입니다. 명세서 전체를 올리면 실제 결제금액과 같아집니다.</p>
            <button type="button" className="acc-secondary" onClick={() => { setMonth(shiftMonth(month, 1)); setView('pay') }}>{Number(shiftMonth(month, 1).slice(5))}월에 나가는 돈 보기</button>
          </section>

          <details className="acc-card mf-detail" open>
            <summary><h2>자세히 적기 (선택)</h2><span className="acc-note">현금·계좌이체로 낸 돈과 환급만 적으면 됩니다. 나머지는 쓰고 싶을 때만.</span></summary>
            <label className="acc-field">
              <span>무엇을 얼마에 (여러 줄 붙여넣기 가능)</span>
              <small className="acc-note">가게 이름과 금액만 적어도 됩니다. 카드 명세서(현대카드·삼성 모니모)는 글자를 그대로 복사해 붙여넣으면 날짜·가게·금액을 읽습니다. 자세한 규칙은 아래 "쓰는 법"에서 봅니다.</small>
              <textarea
                className="mf-input" rows={2} value={text} placeholder={'261002 CU제기점 1800원\n네이버페이 물티슈 12900원'}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !text.includes('\n')) { event.preventDefault(); readInput() } }}
              />
            </label>
            <More label="쓰는 법과 예시 보기"><p className="acc-note">가게 이름이면 충분해요. 네이버페이·쿠팡 같은 온라인 결제는 그대로 적으면 "온라인 쇼핑"으로 들어갑니다(큰 금액은 산 물건을 붙이면 더 정확하지만 안 해도 됩니다). 마트는 품목 없이 장보기로 한 번에 봅니다. 계좌로 돌려받은 돈은 "모두의카드 환급 23000원"처럼 적으면 환급으로 읽어 지출에서 뺍니다. 누가 적고 누구 카드로 냈든 기본은 집 공용입니다. 배우자만 쓴 건 앞이든 중간이든 "배우자"를 넣으면 됩니다(예: 배우자 교통카드 62000원, 모두의카드 배우자 환급 23000원).</p></More>
            <div className="mf-row">
              <label className="acc-field mf-date"><span>날짜 (줄 앞에 날짜가 없을 때)</span><input type="date" value={date} max={today} onChange={(event) => setDate(event.target.value)} /></label>
              <button type="button" className="acc-primary" onClick={readInput} disabled={!text.trim()}>읽기</button>
            </div>
            {failed.length > 0 && <p className="acc-warn">금액을 못 찾은 줄: {failed.join(' / ')}. 금액을 숫자로 적어 주세요(예: 15170, 1.5만원).</p>}

            {drafts.length > 0 && (
              <div className="mf-drafts" aria-label="저장 전 확인">
                {loudDrafts.map(renderDraft)}
                {quietDrafts.length > 0 && (
                  <details className="mf-quiet">
                    <summary>{(SMALL_UNKNOWN_LIMIT / 10000).toLocaleString('ko-KR')}만 원 미만이라 묻지 않은 줄 {quietDrafts.length}건 · 기타 생활로 넣습니다</summary>
                    <p className="acc-note">작은 금액은 분류가 틀려도 점검 결론이 거의 바뀌지 않습니다. 고치고 싶으면 여기서 바꾸세요.</p>
                    {quietDrafts.map(renderDraft)}
                  </details>
                )}
                <button type="button" className="acc-primary" onClick={saveDrafts} disabled={saving}>{saving ? '저장 중…' : `${drafts.length}건 저장`}</button>
              </div>
            )}
          </details>

          <section className="acc-card">
            <h2>{month.replace('-', '년 ')}월 세부 기록 {monthEntries.length}건</h2>
            {monthEntries.length > 0 && (
              <p className="mf-list-sum" aria-label="세부 기록 합계">
                <strong>합계 {krw(usage.card.cash + usage.cash.cash)}</strong>
                <span>카드 {krw(usage.card.cash)} · 현금 {krw(usage.cash.cash)}</span>
              </p>
            )}
            {replaceable.length > 0 && (
              <div className="mf-row">
                <button type="button" className="acc-secondary" onClick={() => void removeMonthCardDetail()} disabled={bulkBusy}>
                  {bulkBusy ? '지우는 중…' : `이 달 카드 세부 모두 지우기 (${replaceable.length}건)`}
                </button>
                <span className="acc-note">명세서로 다시 올릴 때 먼저 지웁니다. 현금·환급·포인트 기록은 남습니다.</span>
              </div>
            )}
            {loading ? <p className="acc-note">불러오는 중…</p> : monthEntries.length === 0 ? <p className="acc-note">아직 기록이 없습니다.</p> : (
              <ul className="mf-list">
                {monthEntries.slice(0, listLimit).map((e) => {
                  const name = e.memo || '메모 없음'
                  const category = categoryById(e.categoryId)
                  if (editing?.id === e.id) {
                    return (
                      <li key={e.id} className="mf-editing">
                        <div className="mf-draft-fields">
                          <label><span>날짜</span><input type="date" aria-label={`${name} 날짜 고치기`} value={editing.date} max={today} onChange={(event) => patchEdit({ date: event.target.value })} /></label>
                          <label><span>금액</span><input type="number" inputMode="numeric" min="1" aria-label={`${name} 금액 고치기`} value={editing.amount || ''} onChange={(event) => patchEdit({ amount: Math.round(Number(event.target.value) || 0) })} /></label>
                          <label className="mf-span"><span>메모</span><input type="text" maxLength={100} aria-label={`${name} 메모 고치기`} value={editing.memo} onChange={(event) => patchEdit({ memo: event.target.value })} /></label>
                        </div>
                        <div className="mf-list-tools">
                          <CategorySelect label={`${name} 분류 바꾸기`} value={editing.categoryId} onChange={(categoryId) => patchEdit({ categoryId })} />
                          <WhomSelect label={`${name} 누구 몫 바꾸기`} value={editing.forWhom} onChange={(forWhom) => patchEdit({ forWhom })} />
                          <label className="mf-cash-check"><input type="checkbox" checked={editing.paidWith === 'cash'} onChange={(event) => patchEdit({ paidWith: event.target.checked ? 'cash' : 'card' })} />현금으로 냄</label>
                          <select aria-label={`${name} 결제 수단 바꾸기`} value={editing.payment} onChange={(event) => patchEdit({ payment: event.target.value as Payment })}>
                            {PAYMENT_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                          </select>
                        </div>
                        <div className="mf-list-tools">
                          <button type="button" className="acc-primary" onClick={() => void saveEdit(e)} disabled={saving}>{saving ? '저장 중…' : '저장'}</button>
                          <button type="button" className="acc-secondary" onClick={() => setEditing(null)}>취소</button>
                        </div>
                      </li>
                    )
                  }
                  return (
                    <li key={e.id}>
                      <div className="mf-list-main">
                        <span className="mf-date-cell">{e.date.slice(5).replace('-', '/')}</span>
                        <span className="mf-memo">
                          {whomOf(e) !== 'shared' && <em className="mf-point mf-partner">{WHOM_LABEL[whomOf(e)]}</em>}
                          {e.memo || '메모 없음'}
                          {PAYMENT_TAG[e.payment] && <em className="mf-point">{PAYMENT_TAG[e.payment]}</em>}
                          {paidOf(e) === 'cash' && <em className="mf-point mf-cash">현금</em>}
                          {e.mine === false && <em className="mf-point">배우자가 적음</em>}
                          {e.editedBy && <em className="mf-point mf-edited">{e.editedBy === 'me' ? '내가 고침' : '배우자가 고침'}</em>}
                          {category && <small>{category.label}</small>}
                        </span>
                        <strong>{isRefund(e.payment) ? '−' : ''}{krw(e.amount)}</strong>
                        <span className="mf-row-actions">
                          <button type="button" className="mf-icon" aria-label={`${name} 고치기`} onClick={() => startEdit(e)}><Pencil size={14} aria-hidden /><span>고치기</span></button>
                          <button type="button" className="mf-icon" aria-label={`${name} 지우기`} onClick={() => void removeEntry(e)}><Trash2 size={14} aria-hidden /><span>지우기</span></button>
                        </span>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
            {monthEntries.length > listLimit && (
              <button type="button" className="acc-secondary" onClick={() => setListLimit((n) => n + LIST_PAGE)}>더보기 ({monthEntries.length - listLimit}건 남음)</button>
            )}
            {monthDeleted.length > 0 && (
              <details className="mf-deleted">
                <summary>지운 기록 {monthDeleted.length}건</summary>
                <ul className="mf-list">
                  {monthDeleted.map((e) => (
                    <li key={e.id}>
                      <div className="mf-list-main">
                        <span className="mf-date-cell">{e.date.slice(5).replace('-', '/')}</span>
                        <span className="mf-memo">{e.memo || '메모 없음'} <em className="mf-point">{e.deletedBy === 'me' ? '내가 지움' : '배우자가 지움'}</em></span>
                        <strong>{krw(e.amount)}</strong>
                      </div>
                      <button type="button" className="acc-secondary" aria-label={`${e.memo || '메모 없음'} 되돌리기`} onClick={() => void restoreEntry(e)}>되돌리기</button>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        </div>
      )}

      {!budget && (
        <div className="mf-pane" hidden={view !== 'pay'}>
          <MonthTotals month={month} thisMonth={thisMonth} today={today} setMonth={setMonth} totals={scopedTotals.filter((t) => t.month === month || t.mine)} cardDetail={monthDetail.card} cashDetail={monthDetail.cash} records={monthEntries} plan={checkForMonth(checks, month)?.input ?? null} partnerShared={partnerShared} ready={totalsReady} onSaved={load} />
          <h2 className="mf-section-title">이번 달 보기</h2>
          <MonthView month={month} thisMonth={thisMonth} setMonth={setMonth} entries={payEntries} monthEntries={monthEntries} allEntries={scoped} totals={scopedTotals} checks={checks} baseMonth={baseMonth} baseEntries={baseEntries} loading={loading} />
        </div>
      )}

      {budget && (checksLoaded
        ? <FlowCheck entries={scoped} totals={scopedTotals} checks={checks} onSaved={load} fromStart={fromStart} />
        : <p className="acc-note mf-notice">불러오는 중…</p>)}

      <p className="acc-note mf-foot">기록은 본인 계정에 저장되고, <Link to="/family">부부 연결</Link>에서 지출 공유를 켠 배우자만 함께 봅니다. 투자 가능액 계산은 <Link to="/seed-builder">이번 달 투자금</Link>에서 합니다.</p>
    </div>
  )
}

/** 지출 기록 화면 맨 위 '예산 설정' 구역: 지금 예산 요약과 고치러 가는 버튼 */
function BudgetSummary({ check, loading }: { check: SavedCheck | null; loading: boolean }) {
  if (loading) return <section className="acc-card"><p className="acc-note">불러오는 중…</p></section>
  if (!check) {
    return (
      <section className="acc-card mf-budget">
        <p>아직 예산이 없습니다.</p>
        <Link to="/budget" className="acc-primary">예산 설정하기</Link>
      </section>
    )
  }
  const fund = check.input.irregular.reduce((sum, item) => sum + Math.round(item.yearlyAmount / 12), 0)
  return (
    <section className="acc-card mf-budget">
      <dl className="acc-facts">
        <div><dt>수입</dt><dd>{krw(check.input.monthlyIncome)}</dd></div>
        <div><dt>고정비</dt><dd>{krw(fixedCashOf(check.input))}</dd></div>
        <div><dt>비정기 적립</dt><dd>{krw(fund)}</dd></div>
        {savingCashOf(check.input) > 0 && <div><dt>저축·투자</dt><dd>{krw(savingCashOf(check.input))}</dd></div>}
        <div className="is-main"><dt>쓸 수 있는 돈 (변동 지출 전)</dt><dd>{krw(investableOf(check.input, 0))}</dd></div>
      </dl>
      <p className="acc-note">수입에서 저축·고정비·비정기 적립·비상금 적립을 뺀 돈입니다. 여기서 식비·생활비 같은 변동 지출을 쓰고 남는 게 투자 가능액입니다.</p>
      <Link to="/budget" className="acc-secondary">예산 고치기</Link>
    </section>
  )
}

const monthLabel = (month: string) => `${month.slice(0, 4)}년 ${Number(month.slice(5))}월`

/**
 * 최근 6개월: 카드 합계 · 고정비 · 비정기 · 나머지(변동). 나머지 = 합계 − 그 달 고정비 − 그 달에 나가는 비정기(점검에서 고른 달)
 * 기준은 그 달 말일까지 저장한 가장 최근 점검. 재산세·자동차세처럼 그 달에만 나간 돈이 나머지를 부풀리지 않게 뺀다
 * 합계를 안 적은 달은 세부 기록 합이라 실제보다 적을 수 있어 나머지를 계산하지 않는다
 */
function trendRows(month: string, allEntries: Entry[], totals: MonthTotalRow[], checks: SavedCheck[]) {
  return Array.from({ length: 6 }, (_, i) => shiftMonth(month, i - 5)).flatMap((m) => {
    const t = totals.filter((x) => x.month === m)
    // 합계는 결제월 기준이라 세부 기록도 통장 기준(카드는 지난달 이용분)으로 맞춘다. 비정기 실제는 낸 달 기록으로 찾는다
    const e = paidBasis(allEntries, m)
    const own = allEntries.filter((x) => x.date.startsWith(m))
    if (t.length === 0 && e.length === 0) return []
    const split = splitSummaries(e)
    const check = checkForMonth(checks, m)
    // 카드 밖 고정비(대출 자동이체 등)는 카드 합계에 없으니 점검 기준으로 더한다
    const spending = monthSpending(t, split.card, split.cash, fixedOutsideCardOf(check?.input))
    const cash = spending.cash
    // 칸별 금액(카드 이름별). 배우자 칸은 이름 뒤에 표시해 내 칸과 섞이지 않게 한다
    const slots = Object.fromEntries(t.map((x) => [slotName(x), x.amount]))
    const fixed = check ? fixedCashOf(check.input) : null
    // 비정기: 실제 낸 기록(예산 항목과 이름이 같은 세부 기록)이 있으면 실제, 없으면 1년 예산 중 이 달 몫. 예산에 없는 비정기 기록도 뺀다
    const irregular = check ? irregularForMonth(check.input, Number(m.slice(5)), own).total : null
    const rest = t.length > 0 && fixed !== null ? cash - fixed - (irregular ?? 0) : null
    // 그 달 투자 가능액 = 수입 − 고정 − 변동 − 비정기 적립 − 비상금 적립(예산 기준)
    const invest = check && rest !== null ? investableOf(check.input, rest) : null
    return [{ month: m, cash, cashPaid: spending.cashPaid, slots, fromTotals: t.length > 0, fixed, irregular, rest, invest }]
  })
}

const slotName = (t: MonthTotalRow) => (t.mine ? t.label : `${t.label}(배우자)`)

function MonthTrend({ rows, month }: { rows: ReturnType<typeof trendRows>; month: string }) {
  const max = Math.max(1, ...rows.map((r) => Math.max(0, r.rest ?? 0)))
  // 6개월 동안 나온 칸 이름을 처음 나온 순서대로 — 카드별 추이를 칸마다 본다
  const slotNames = [...new Set(rows.flatMap((r) => Object.keys(r.slots)))]
  const anyCash = rows.some((r) => r.cashPaid > 0)
  const anyRest = rows.some((r) => r.rest !== null)
  return (
    <section className="acc-card">
      <h2>지출 추이</h2>
      <div className="mf-trend-wrap">
        <table className="mf-trend" aria-label="최근 6개월 지출 추이">
          <thead><tr><th scope="col">달</th>{slotNames.map((n) => <th key={n} scope="col">{n}</th>)}{anyCash && <th scope="col">현금</th>}<th scope="col">지출 합계</th><th scope="col">고정비</th><th scope="col">비정기</th><th scope="col">나머지(변동)</th><th scope="col">투자 가능</th></tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const prevRest = rows.slice(0, i).reverse().find((x) => x.rest !== null)?.rest ?? null
              const diff = r.rest !== null && prevRest !== null ? r.rest - prevRest : null
              return (
                <tr key={r.month} className={r.month === month ? 'is-current' : ''}>
                  <th scope="row">{Number(r.month.slice(5))}월</th>
                  {slotNames.map((n) => <td key={n} className={r.slots[n] === undefined ? 'mf-trend-muted' : ''}>{r.slots[n] === undefined ? '—' : krw(r.slots[n])}</td>)}
                  {anyCash && <td>{r.cashPaid > 0 ? krw(r.cashPaid) : <span className="mf-trend-muted">—</span>}</td>}
                  <td>{krw(r.cash)}{!r.fromTotals && <small>세부 합</small>}</td>
                  <td className="mf-trend-muted">{r.fixed === null ? '—' : krw(r.fixed)}</td>
                  <td className="mf-trend-muted">{r.irregular === null || r.irregular === 0 ? '—' : krw(r.irregular)}</td>
                  <td>
                    {r.rest === null ? <span className="mf-trend-muted">—</span> : (
                      <span className="mf-trend-rest">
                        <span className="mf-trend-track" aria-hidden="true"><span className="mf-trend-bar" style={{ width: `${(Math.max(0, r.rest) / max) * 100}%` }} /></span>
                        <span>{krw(r.rest)}</span>
                        {diff !== null && diff !== 0 && <small className={diff > 0 ? 'is-up' : 'is-down'}>{diff > 0 ? '▲' : '▼'}{krw(Math.abs(diff))}</small>}
                      </span>
                    )}
                  </td>
                  <td className="mf-trend-invest">{r.invest === null ? <span className="mf-trend-muted">—</span> : krw(r.invest)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="acc-note">
        {anyRest
          ? '카드는 칸별 명세서 금액, 현금은 현금으로 표시한 세부 기록 합입니다. 나머지 = 지출 합계 − 고정비 − 그 달 비정기(실제 낸 금액, 안 적었으면 1년 예산 중 이 달 몫). 재산세·자동차세처럼 그 달에만 나간 돈을 빼고, 장보기·물건·간식 같은 지출이 줄었는지 봅니다. '
          : '예산을 저장하면 고정비를 뺀 나머지(변동 지출)도 달마다 보여 줍니다. '}
        합계를 안 적은 달은 세부 기록만 더한 값이라("세부 합") 나머지를 계산하지 않습니다. 환급은 뺀 금액입니다.
      </p>
    </section>
  )
}

/** entries = 통장 기준 세부 기록(카드는 지난달 이용분 + 이 달 현금), monthEntries = 이 달에 적은 기록 전체(비정기 실제 금액을 찾는 데 쓴다) */
function MonthView({ month, thisMonth, setMonth, entries, monthEntries, allEntries, totals, checks, baseMonth, baseEntries, loading }: { month: string; thisMonth: string; setMonth: (m: string) => void; entries: Entry[]; monthEntries: Entry[]; allEntries: Entry[]; totals: MonthTotalRow[]; checks: SavedCheck[]; baseMonth: string | null; baseEntries: Entry[]; loading: boolean }) {
  const summary = useMemo(() => summarizeItems(entries.map(toItem)), [entries])
  const monthTotals = totals.filter((t) => t.month === month)
  const hasTotals = monthTotals.length > 0
  const split = useMemo(() => splitSummaries(entries), [entries])
  const rec = monthSpending(monthTotals, split.card, split.cash, fixedOutsideCardOf(checkForMonth(checks, month)?.input))
  const unrecorded = rec.unrecordedCash + rec.unrecordedPoint
  const refunds = summary.refundRegular + summary.refundOnce
  const trend = trendRows(month, allEntries, totals, checks)
  // 1년 예산에 없던 비정기 = 비상금에서 나간 돈(변동 지출에서 빼고 따로 보여 준다)
  const plan = checkForMonth(checks, month)?.input ?? null
  const irregularMonth = irregularForMonth(plan, Number(month.slice(5)), monthEntries)
  const emergency = irregularMonth.emergency
  // 이 달 투자 가능액: 카드 합계와 예산이 있을 때만(합계가 없으면 지출이 덜 잡혀 부풀려진다)
  const variable = plan && hasTotals ? rec.cash - fixedCashOf(plan) - irregularMonth.total : null
  const invest = plan && variable !== null ? investableOf(plan, variable) : null
  // 공용이 아닌 기록이 하나라도 있으면 공용·나·배우자 현금(환급 뺀)과 돌려받은 돈을 나눠 보여 준다
  const byWho = useMemo(() => {
    if (entries.every((e) => whomOf(e) === 'shared')) return null
    const of = (who: ForWhom) => summarizeItems(entries.filter((e) => whomOf(e) === who).map(toItem))
    return { shared: of('shared'), me: of('me'), partner: of('partner') }
  }, [entries])
  const refundOf = (s: ReturnType<typeof summarizeItems>) => s.refundRegular + s.refundOnce
  const prev = useMemo(() => summarizeItems(baseEntries.map(toItem)), [baseEntries])
  const changes = compareSummaries(prev, summary).filter((c) => c.difference !== 0).slice(0, 5)
  const cut = summary.cashByCut
  const cashTotal = Math.max(1, cut.must + cut.trim + cut.drop + rec.unrecordedCash)
  return (
    <>
      <section className="acc-card">
        <h3>{monthLabel(month)}</h3>
        <p className="acc-note">통장에서 나가는 돈 기준입니다. 카드는 {Number(shiftMonth(month, -1).slice(5))}월에 쓴 기록, 현금은 {Number(month.slice(5))}월에 낸 기록입니다.</p>
        {!loading && (
          <div className="mf-invest" aria-label="이 달 투자 가능액">
            <span>{month > thisMonth ? '투자 가능액(예상 — 카드 결제 예정금액 기준)' : '투자 가능액'}</span>
            {invest !== null && plan && variable !== null
              ? <><strong className={invest < 0 ? 'is-negative' : ''}>{krw(invest)}</strong><small>수입 {krw(plan.monthlyIncome)}{savingCashOf(plan) > 0 && ` − 저축·투자 ${krw(savingCashOf(plan))}`} − 고정 {krw(fixedCashOf(plan))} − 변동 {krw(variable)} − 비정기 적립 {krw(irregularFundOf(plan))} − 비상금 적립 {krw(plan.reserveMonthly)}</small></>
              : <small>{plan ? '이 달 카드 합계를 적으면 계산됩니다.' : '예산을 설정하면 계산됩니다.'}</small>}
          </div>
        )}
        {loading ? <p className="acc-note">불러오는 중…</p> : entries.length === 0 && !hasTotals ? <p className="acc-note">이 달은 기록하지 않았습니다. 매달 적을 필요는 없습니다.{baseMonth && ` 지금 기준은 ${monthLabel(baseMonth)} 기록입니다.`}</p> : (
          <>
            <dl className="acc-tiles">
              <div className="is-main"><dt>현금 지출</dt><dd>{krw(rec.cash)}</dd>{(hasTotals || refunds > 0) && <small>{[hasTotals ? '칸 합계 기준' : '', refunds > 0 ? `돌려받은 ${krw(refunds)}을 뺀 금액` : ''].filter(Boolean).join(', ')}</small>}</div>
              {hasTotals && rec.detailedCash + rec.detailedPoint > 0 && <div><dt>세부 안 적음</dt><dd>{krw(unrecorded)}</dd><small>세부 기록 {krw(rec.detailedCash + rec.detailedPoint)} 밖, 어디에 썼는지 모르는 금액</small></div>}
              {rec.cashPaid > 0 && <div><dt>현금으로 낸 돈</dt><dd>{krw(rec.cashPaid)}</dd><small>세부 기록에서 현금으로 표시한 것, 카드 합계에 더함</small></div>}
              {emergency > 0 && <div><dt>비상금에서 나간 돈</dt><dd>{krw(emergency)}</dd><small>1년 예산에 없던 비정기 — 다음 달 비상금 적립에 더해 채워 넣기</small></div>}
              <div><dt>생활 소비(포인트 포함)</dt><dd>{krw(rec.consumption)}</dd></div>
              <div><dt>포인트·환급이 메운 금액</dt><dd>{krw(Math.max(rec.pointTotal, rec.detailedPoint) + refunds)}</dd>{summary.pointOnce + summary.refundOnce > 0 && <small>이번만 들어온 {krw(summary.pointOnce + summary.refundOnce)}는 다음 달엔 없을 수 있습니다</small>}</div>
              {byWho && <div><dt>누구 몫(현금)</dt><dd className="mf-small">공용 {krw(byWho.shared.cash)} · 나 {krw(byWho.me.cash)} · 배우자 {krw(byWho.partner.cash)}</dd>{refundOf(byWho.shared) + refundOf(byWho.me) + refundOf(byWho.partner) > 0 && <small>돌려받은 돈: 공용 {krw(refundOf(byWho.shared))} · 나 {krw(refundOf(byWho.me))} · 배우자 {krw(refundOf(byWho.partner))}</small>}</div>}
              <div><dt>고정 · 변동 · 비정기</dt><dd className="mf-small">{krw(summary.byKind.fixed)} · {krw(summary.byKind.variable)} · {krw(summary.byKind.irregular)}</dd></div>
            </dl>
            <h3>현금 지출, 줄일 수 있나</h3>
            <div className="mf-bar" aria-hidden="true">
              <span className="is-must" style={{ width: `${(cut.must / cashTotal) * 100}%` }} />
              <span className="is-trim" style={{ width: `${(cut.trim / cashTotal) * 100}%` }} />
              <span className="is-drop" style={{ width: `${(cut.drop / cashTotal) * 100}%` }} />
              {rec.unrecordedCash > 0 && <span className="is-unknown" style={{ width: `${(rec.unrecordedCash / cashTotal) * 100}%` }} />}
            </div>
            <dl className="acc-facts" aria-label="줄일 수 있나">
              {(['must', 'trim', 'drop'] as const).map((level) => (
                <div key={level}><dt><i className={`mf-key is-${level}`} />{CUT_LABEL[level]}</dt><dd>{krw(cut[level])}</dd></div>
              ))}
              {rec.unrecordedCash > 0 && <div><dt><i className="mf-key is-unknown" />모름(세부 안 적음)</dt><dd>{krw(rec.unrecordedCash)}</dd></div>}
            </dl>
            <p className="acc-note">기본값은 소분류마다 정해져 있습니다. 바꾸는 기능은 예산에서 제공할 예정입니다.</p>
          </>
        )}
      </section>

      {!loading && trend.length >= 2 && <MonthTrend rows={trend} month={month} />}

      {!loading && entries.length > 0 && (
        <section className="acc-card">
          <h2>어디에 썼나</h2>
          {hasTotals && unrecorded > 0 && <p className="acc-note">세부 기록한 {krw(rec.detailedCash + rec.detailedPoint)} 안에서만 나눴습니다. 나머지 {krw(unrecorded)}는 어디에 썼는지 모릅니다.</p>}
          <div className="mf-majors">
            {summary.byMajor.map((m) => (
              <details key={`${m.kind}-${m.major}`}>
                <summary><span>{m.major} <small>{KIND_LABEL[m.kind]}</small></span><strong>{krw(m.amount)}</strong></summary>
                <ul>
                  {summary.byCategory.filter((row) => { const c = categoryById(row.categoryId); return c?.major === m.major && c.kind === m.kind }).map((row) => (
                    <li key={row.categoryId}><span>{categoryById(row.categoryId)?.label} <small>{CUT_LABEL[categoryById(row.categoryId)!.cut]}</small></span><span>{krw(row.amount)}</span></li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        </section>
      )}

      {!loading && entries.length > 0 && baseMonth && changes.length > 0 && (
        <section className="acc-card">
          <h2>{monthLabel(baseMonth)} 기록보다</h2>
          <ul className="mf-changes">
            {changes.map((c) => (
              <li key={c.categoryId}><span>{categoryById(c.categoryId)?.label}</span><span className={c.difference > 0 ? 'is-up' : 'is-down'}>{c.difference > 0 ? '+' : '−'}{krw(Math.abs(c.difference))}</span></li>
            ))}
          </ul>
          <p className="acc-note">마지막으로 기록한 달과 비교합니다. 한쪽 달을 덜 적었으면 차이가 크게 보입니다.</p>
        </section>
      )}
    </>
  )
}
