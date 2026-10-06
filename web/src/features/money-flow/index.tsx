import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react'
import { apiFetch } from '../../lib/api'
import {
  FLOW_CATEGORIES, SMALL_UNKNOWN_LIMIT, categoryById, classifyMemo, compareSummaries, needsItemName, parseQuickLines, suggestCategories, summarizeItems,
  type CutLevel, type FlowItem, type LearnedRule, type Payment,
} from '../../../../src/lib/moneyFlow'
import FlowCheck, { type SavedCheck } from './FlowCheck'
import '../accumulate/accumulate.css'
import './money-flow.css'

type Entry = { id: string; mine?: boolean; editedBy?: 'me' | 'partner' | null; deletedBy?: 'me' | 'partner' | null; date: string; amount: number; memo: string; categoryId: string; cut: CutLevel | null; mustPart: number | null; payment: Payment }
// baseMemo = 붙여 넣은 그대로, item = 통로(네이버페이·쿠팡 등) 이름만 있을 때 덧붙인 산 물건, memo = 저장할 메모
type Draft = { key: string; date: string; amountGuessed: boolean; amount: number; baseMemo: string; item: string; askItem: boolean; memo: string; categoryId: string; autoCategoryId: string; known: boolean; payment: Payment }
type Tab = 'record' | 'month' | 'check'

const krw = (value: number) => `${Math.round(value).toLocaleString('ko-KR')}원`
const kstToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
const shiftMonth = (month: string, delta: number) => {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}
const monthEnd = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
}
const CUT_LABEL: Record<CutLevel, string> = { must: '못 줄임', trim: '줄일 수 있음', drop: '끊을 수 있음' }
const KIND_LABEL = { fixed: '고정', variable: '변동', irregular: '비정기' } as const
const toItem = (entry: Entry): FlowItem => ({ categoryId: entry.categoryId, amount: entry.amount, payment: entry.payment, cut: entry.cut ?? undefined, mustPart: entry.mustPart ?? undefined })

function CategorySelect({ value, onChange, label }: { value: string; onChange: (id: string) => void; label: string }) {
  const groups = useMemo(() => {
    const map = new Map<string, typeof FLOW_CATEGORIES>()
    for (const c of FLOW_CATEGORIES) {
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

export default function MoneyFlowPage() {
  const today = kstToday()
  const thisMonth = today.slice(0, 7)
  const [params] = useSearchParams()
  const [tab, setTab] = useState<Tab>(() => (params.get('tab') === 'check' ? 'check' : 'record'))
  const fromStart = params.get('from') === 'start'
  const [checks, setChecks] = useState<SavedCheck[]>([])
  const [checksLoaded, setChecksLoaded] = useState(false)
  const [month, setMonth] = useState(thisMonth)
  const [entries, setEntries] = useState<Entry[]>([])
  const [deleted, setDeleted] = useState<Entry[]>([])
  const [rules, setRules] = useState<LearnedRule[]>([])
  const [partnerShared, setPartnerShared] = useState(false)
  const [scope, setScope] = useState<'home' | 'me'>('home')
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')
  const [text, setText] = useState('')
  const [date, setDate] = useState(today)
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [failed, setFailed] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      // 매달 적을 필요는 없다. 비교 기준(마지막으로 기록한 달)을 찾으려고 12개월 전부터 가져온다
      const res = await apiFetch(`/api/ui/money-flow?from=${shiftMonth(month, -12)}-01&to=${monthEnd(month)}`, { cacheMs: 0, retries: 0 })
      setEntries(Array.isArray(res?.entries) ? res.entries : [])
      setDeleted(Array.isArray(res?.deleted) ? res.deleted : [])
      setRules(Array.isArray(res?.rules) ? res.rules : [])
      setPartnerShared(res?.partnerShared === true)
      setChecks(Array.isArray(res?.checks) ? res.checks : [])
      setChecksLoaded(true)
    } catch (error) {
      setNotice(`불러오기 실패: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setLoading(false)
    }
  }, [month])
  useEffect(() => { void load() }, [load])

  // 부부 연결로 상대 기록이 오면 '우리 집'(합계)과 '나만'을 고를 수 있다. 상대 기록은 읽기만 한다
  const scoped = partnerShared && scope === 'home' ? entries : entries.filter((e) => e.mine !== false)
  const monthEntries = scoped.filter((e) => e.date.startsWith(month))
  // 기준 = 이 달 이전에 기록이 있는 가장 최근 달. 그사이 달을 건너뛰었어도 그 기록이 기준으로 남는다
  const baseMonth = scoped.map((e) => e.date.slice(0, 7)).filter((m) => m < month).sort().pop() ?? null
  const baseEntries = baseMonth ? scoped.filter((e) => e.date.startsWith(baseMonth)) : []
  const suggestions = suggestCategories(entries.filter((e) => e.mine !== false).slice(0, 60).map((e) => e.categoryId))

  const readInput = () => {
    const { parsed, failed: bad } = parseQuickLines(text, today)
    setFailed(bad)
    setNotice('')
    setDrafts(parsed.map((p, i) => {
      const result = classifyMemo(p.memo, rules)
      // 줄 맨 앞에 날짜(261001 등)가 있으면 그 날짜, 없으면 아래 날짜 칸
      return { key: `${Date.now()}-${i}`, date: p.date ?? date, amountGuessed: p.amountGuessed, amount: p.amount, baseMemo: p.memo, item: '', askItem: needsItemName(p.memo), memo: p.memo, categoryId: result.categoryId, autoCategoryId: result.categoryId, known: result.source !== 'none', payment: 'cash' }
    }))
  }
  const updateDraft = (key: string, patch: Partial<Draft>) => setDrafts((list) => list.map((d) => d.key === key ? { ...d, ...patch } : d))
  // 산 물건을 적으면 메모에 덧붙이고 다시 분류한다
  const setDraftItem = (d: Draft, item: string) => {
    const memo = `${d.baseMemo} ${item.trim()}`.trim()
    const result = classifyMemo(memo, rules)
    updateDraft(d.key, { item, memo, categoryId: result.categoryId, autoCategoryId: result.categoryId, known: result.source !== 'none' })
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
        entries: drafts.map((d) => ({ date: d.date, amount: d.amount, memo: d.memo, categoryId: d.categoryId, payment: d.payment, learn: d.memo !== '' && ((!d.known && !isQuiet(d)) || d.categoryId !== d.autoCategoryId) })),
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
    return apiFetch('/api/ui/money-flow', { method: 'POST', body: JSON.stringify({ action: 'update-entry', id: entry.id, date: next.date, amount: next.amount, memo: next.memo, categoryId: next.categoryId, payment: next.payment, cut: next.cut, mustPart: next.mustPart && next.mustPart <= next.amount ? next.mustPart : null, learn }), cacheMs: 0 })
  }

  const changeAmount = async (entry: Entry, amount: number) => {
    if (!Number.isSafeInteger(amount) || amount < 1 || amount === entry.amount) return
    try {
      await updateEntry(entry, { amount }, false)
      setNotice(`${entry.memo || '메모 없음'} 금액을 ${krw(amount)}으로 고쳤습니다.`)
      void load()
    } catch (error) {
      setNotice(`수정 실패: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const changeCategory = async (entry: Entry, categoryId: string) => {
    try {
      await updateEntry(entry, { categoryId }, entry.memo !== '')
      setEntries((list) => list.map((e) => e.id === entry.id ? { ...e, categoryId } : e))
      if (entry.memo) setNotice(`"${entry.memo}"은(는) 다음부터 ${categoryById(categoryId)?.label}(으)로 분류합니다.`)
      void load()
    } catch (error) {
      setNotice(`수정 실패: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const removeEntry = async (entry: Entry) => {
    const whose = entry.mine === false ? ' 배우자가 적은 기록입니다. 배우자 화면에도 "배우자가 지움"으로 보이고 둘 다 되돌릴 수 있습니다.' : ''
    if (!window.confirm(`${entry.memo || '메모 없음'} ${krw(entry.amount)} 기록을 지울까요?${whose}`)) return
    try {
      await apiFetch('/api/ui/money-flow', { method: 'POST', body: JSON.stringify({ action: 'delete-entry', id: entry.id }), cacheMs: 0 })
      setEntries((list) => list.filter((e) => e.id !== entry.id))
      void load()
    } catch (error) {
      setNotice(`삭제 실패: ${error instanceof Error ? error.message : String(error)}`)
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
  const monthDeleted = deleted.filter((e) => e.date.startsWith(month) && (partnerShared && scope === 'home' ? true : e.mine !== false))

  const renderDraft = (d: Draft) => (
    <div key={d.key} className="mf-draft">
      <div className="mf-draft-head"><strong>{d.baseMemo || '메모 없음'}</strong></div>
      <div className="mf-draft-fields">
        <label><span>날짜</span><input type="date" aria-label={`${d.baseMemo || '메모 없음'} 날짜`} value={d.date} max={today} onChange={(event) => updateDraft(d.key, { date: event.target.value })} /></label>
        <label className={d.amountGuessed ? 'is-guessed' : ''}><span>{d.amountGuessed ? '금액 확인' : '금액'}</span><input type="number" inputMode="numeric" min="1" aria-label={`${d.baseMemo || '메모 없음'} 금액`} value={d.amount || ''} onChange={(event) => updateDraft(d.key, { amount: Math.round(Number(event.target.value) || 0), amountGuessed: false })} /></label>
      </div>
      {d.amountGuessed && <p className="acc-warn mf-cut">"원"이 없고 숫자가 여러 개라 가장 큰 수를 금액으로 골랐습니다. 맞는지 확인해 주세요. 금액 뒤에 "원"을 붙이면 헷갈리지 않습니다.</p>}
      {d.askItem && d.amount >= SMALL_UNKNOWN_LIMIT && (
        <label className="acc-field mf-item">
          <span>뭘 샀나요? 네이버페이·쿠팡처럼 뭐든 파는 곳은 이름만으로 분류할 수 없어요</span>
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
        <select aria-label={`${d.baseMemo || '메모 없음'} 결제 수단`} value={d.payment} onChange={(event) => updateDraft(d.key, { payment: event.target.value as Payment })}>
          <option value="cash">카드·현금</option>
          <option value="point_regular">포인트(매달 꾸준히)</option>
          <option value="point_once">포인트(이번만)</option>
        </select>
        <button type="button" className="acc-link" onClick={() => setDrafts((list) => list.filter((x) => x.key !== d.key))}>빼기</button>
      </div>
      <p className="mf-cut">{KIND_LABEL[categoryById(d.categoryId)!.kind]} · {CUT_LABEL[categoryById(d.categoryId)!.cut]}</p>
    </div>
  )

  return (
    <div className="acc mf">
      <header>
        <p className="acc-eyebrow">돈 흐름</p>
        <h1>지출, 줄일 수 있는 것과 없는 것</h1>
        <p>한 달만 적어 봐도 지출 구조가 보입니다. 매달 적을 필요는 없고, 다시 적는 달은 마지막으로 적은 달과 비교합니다. 쓴 직후 한 줄로 적으면 알아서 나눕니다. 포인트로 낸 것도 소비에 넣고, 현금 지출과 따로 봅니다. 화면은 줄이라고 판단하지 않습니다.</p>
      </header>

      <section className="acc-card">
        <div className="acc-seg" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'record'} className={tab === 'record' ? 'is-active' : ''} onClick={() => setTab('record')}>기록</button>
          <button type="button" role="tab" aria-selected={tab === 'month'} className={tab === 'month' ? 'is-active' : ''} onClick={() => setTab('month')}>이번 달 보기</button>
          <button type="button" role="tab" aria-selected={tab === 'check'} className={tab === 'check' ? 'is-active' : ''} onClick={() => setTab('check')}>지금 상태 점검</button>
        </div>
      </section>

      {partnerShared && (
        <section className="acc-card">
          <div className="acc-seg" role="group" aria-label="누구 지출">
            <button type="button" aria-pressed={scope === 'home'} className={scope === 'home' ? 'is-active' : ''} onClick={() => setScope('home')}>우리 집 합계</button>
            <button type="button" aria-pressed={scope === 'me'} className={scope === 'me' ? 'is-active' : ''} onClick={() => setScope('me')}>나만</button>
          </div>
          <p className="acc-note">배우자가 공유한 기록도 함께 셉니다. 서로의 기록을 고치거나 지울 수 있고, 누가 고치고 지웠는지 표시됩니다. 지운 기록은 둘 다 되돌릴 수 있습니다.</p>
        </section>
      )}

      {notice && <p className="acc-note mf-notice" role="status">{notice}</p>}

      {tab === 'record' && (
        <>
          <section className="acc-card">
            <h2>빠른 기록</h2>
            <label className="acc-field">
              <span>무엇을 얼마에 (여러 줄 붙여넣기 가능)</span>
              <small className="acc-note">가게 이름이면 충분해요. 네이버페이·쿠팡처럼 뭐든 파는 곳은 산 물건을 적어 주세요. 마트는 품목 없이 장보기로 한 번에 봅니다.</small>
              <textarea
                className="mf-input" rows={2} value={text} placeholder={'261002 CU제기점 1800원\n네이버페이 물티슈 12900원'}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !text.includes('\n')) { event.preventDefault(); readInput() } }}
              />
            </label>
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
          </section>

          <section className="acc-card">
            <div className="mf-month-nav">
              <button type="button" aria-label="이전 달" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={18} /></button>
              <h2>{month.replace('-', '년 ')}월 기록 {monthEntries.length}건</h2>
              <button type="button" aria-label="다음 달" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= thisMonth}><ChevronRight size={18} /></button>
            </div>
            {loading ? <p className="acc-note">불러오는 중…</p> : monthEntries.length === 0 ? <p className="acc-note">아직 기록이 없습니다.</p> : (
              <ul className="mf-list">
                {monthEntries.map((e) => (
                  <li key={e.id}>
                    <div className="mf-list-main">
                      <span className="mf-date-cell">{e.date.slice(5).replace('-', '/')}</span>
                      <span className="mf-memo">{e.mine === false && <em className="mf-point mf-partner">배우자</em>}{e.memo || '메모 없음'}{e.payment !== 'cash' && <em className="mf-point">{e.payment === 'point_once' ? '포인트·이번만' : '포인트'}</em>}{e.editedBy && <em className="mf-point mf-edited">{e.editedBy === 'me' ? '내가 고침' : '배우자가 고침'}</em>}</span>
                      <strong>{krw(e.amount)}</strong>
                    </div>
                    <div className="mf-list-tools">
                      <CategorySelect label={`${e.memo || '메모 없음'} 분류 바꾸기`} value={e.categoryId} onChange={(id) => void changeCategory(e, id)} />
                      <input key={`${e.id}-${e.amount}`} className="mf-amount-edit" type="number" inputMode="numeric" min="1" aria-label={`${e.memo || '메모 없음'} 금액 고치기`} defaultValue={e.amount} onBlur={(event) => void changeAmount(e, Math.round(Number(event.target.value)))} />
                      <button type="button" className="mf-icon" aria-label={`${e.memo || '메모 없음'} 삭제`} onClick={() => void removeEntry(e)}><Trash2 size={15} /></button>
                    </div>
                  </li>
                ))}
              </ul>
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
                      <button type="button" className="acc-link" aria-label={`${e.memo || '메모 없음'} 되돌리기`} onClick={() => void restoreEntry(e)}>되돌리기</button>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        </>
      )}

      {tab === 'check' && (checksLoaded
        ? <FlowCheck entries={scoped} checks={checks} onSaved={load} fromStart={fromStart} />
        : <p className="acc-note mf-notice">불러오는 중…</p>)}

      {tab === 'month' && <MonthView month={month} thisMonth={thisMonth} setMonth={setMonth} entries={monthEntries} baseMonth={baseMonth} baseEntries={baseEntries} loading={loading} />}

      <p className="acc-note mf-foot">기록은 본인 계정에 저장되고, <Link to="/family">부부 연결</Link>에서 지출 공유를 켠 배우자만 함께 봅니다. 투자 가능액 계산은 <Link to="/seed-builder">시드 만들기</Link>에서 합니다.</p>
    </div>
  )
}

const monthLabel = (month: string) => `${month.slice(0, 4)}년 ${Number(month.slice(5))}월`

function MonthView({ month, thisMonth, setMonth, entries, baseMonth, baseEntries, loading }: { month: string; thisMonth: string; setMonth: (m: string) => void; entries: Entry[]; baseMonth: string | null; baseEntries: Entry[]; loading: boolean }) {
  const summary = useMemo(() => summarizeItems(entries.map(toItem)), [entries])
  const prev = useMemo(() => summarizeItems(baseEntries.map(toItem)), [baseEntries])
  const changes = compareSummaries(prev, summary).filter((c) => c.difference !== 0).slice(0, 5)
  const cut = summary.cashByCut
  const cashTotal = Math.max(1, cut.must + cut.trim + cut.drop)
  return (
    <>
      <section className="acc-card">
        <div className="mf-month-nav">
          <button type="button" aria-label="이전 달" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={18} /></button>
          <h2>{month.replace('-', '년 ')}월</h2>
          <button type="button" aria-label="다음 달" onClick={() => setMonth(shiftMonth(month, 1))} disabled={month >= thisMonth}><ChevronRight size={18} /></button>
        </div>
        {loading ? <p className="acc-note">불러오는 중…</p> : entries.length === 0 ? <p className="acc-note">이 달은 기록하지 않았습니다. 매달 적을 필요는 없습니다.{baseMonth && ` 지금 기준은 ${monthLabel(baseMonth)} 기록입니다.`}</p> : (
          <>
            <dl className="acc-tiles">
              <div className="is-main"><dt>현금 지출</dt><dd>{krw(summary.cash)}</dd></div>
              <div><dt>생활 소비(포인트 포함)</dt><dd>{krw(summary.consumption)}</dd></div>
              <div><dt>포인트가 메운 금액</dt><dd>{krw(summary.pointRegular + summary.pointOnce)}</dd>{summary.pointOnce > 0 && <small>이번만 포인트 {krw(summary.pointOnce)}는 다음 달엔 현금이 됩니다</small>}</div>
              <div><dt>고정 · 변동 · 비정기</dt><dd className="mf-small">{krw(summary.byKind.fixed)} · {krw(summary.byKind.variable)} · {krw(summary.byKind.irregular)}</dd></div>
            </dl>
            <h3>현금 지출, 줄일 수 있나</h3>
            <div className="mf-bar" aria-hidden="true">
              <span className="is-must" style={{ width: `${(cut.must / cashTotal) * 100}%` }} />
              <span className="is-trim" style={{ width: `${(cut.trim / cashTotal) * 100}%` }} />
              <span className="is-drop" style={{ width: `${(cut.drop / cashTotal) * 100}%` }} />
            </div>
            <dl className="acc-facts" aria-label="줄일 수 있나">
              {(['must', 'trim', 'drop'] as const).map((level) => (
                <div key={level}><dt><i className={`mf-key is-${level}`} />{CUT_LABEL[level]}</dt><dd>{krw(cut[level])}</dd></div>
              ))}
            </dl>
            <p className="acc-note">기본값은 소분류마다 정해져 있습니다. 바꾸는 기능은 지금 상태 점검에서 제공할 예정입니다.</p>
          </>
        )}
      </section>

      {!loading && entries.length > 0 && (
        <section className="acc-card">
          <h2>어디에 썼나</h2>
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
          <p className="acc-note">마지막으로 기록한 달과 비교합니다. 기록한 것만 비교하므로, 한쪽 달을 덜 적었으면 차이가 크게 보일 수 있습니다.</p>
        </section>
      )}
    </>
  )
}
