import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react'
import { apiFetch } from '../../lib/api'
import {
  FLOW_CATEGORIES, categoryById, classifyMemo, compareSummaries, parseQuickLines, suggestCategories, summarizeItems,
  type CutLevel, type FlowItem, type LearnedRule, type Payment,
} from '../../../../src/lib/moneyFlow'
import '../accumulate/accumulate.css'
import './money-flow.css'

type Entry = { id: string; date: string; amount: number; memo: string; categoryId: string; cut: CutLevel | null; mustPart: number | null; payment: Payment }
type Draft = { key: string; amount: number; memo: string; categoryId: string; autoCategoryId: string; known: boolean; payment: Payment }
type Tab = 'record' | 'month'

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
  const [tab, setTab] = useState<Tab>('record')
  const [month, setMonth] = useState(thisMonth)
  const [entries, setEntries] = useState<Entry[]>([])
  const [rules, setRules] = useState<LearnedRule[]>([])
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
      setRules(Array.isArray(res?.rules) ? res.rules : [])
    } catch (error) {
      setNotice(`불러오기 실패: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setLoading(false)
    }
  }, [month])
  useEffect(() => { void load() }, [load])

  const monthEntries = entries.filter((e) => e.date.startsWith(month))
  // 기준 = 이 달 이전에 기록이 있는 가장 최근 달. 그사이 달을 건너뛰었어도 그 기록이 기준으로 남는다
  const baseMonth = entries.map((e) => e.date.slice(0, 7)).filter((m) => m < month).sort().pop() ?? null
  const baseEntries = baseMonth ? entries.filter((e) => e.date.startsWith(baseMonth)) : []
  const suggestions = suggestCategories(entries.slice(0, 60).map((e) => e.categoryId))

  const readInput = () => {
    const { parsed, failed: bad } = parseQuickLines(text)
    setFailed(bad)
    setNotice('')
    setDrafts(parsed.map((p, i) => {
      const result = classifyMemo(p.memo, rules)
      return { key: `${Date.now()}-${i}`, amount: p.amount, memo: p.memo, categoryId: result.categoryId, autoCategoryId: result.categoryId, known: result.source !== 'none', payment: 'cash' }
    }))
  }
  const updateDraft = (key: string, patch: Partial<Draft>) => setDrafts((list) => list.map((d) => d.key === key ? { ...d, ...patch } : d))

  const saveDrafts = async () => {
    if (drafts.length === 0 || saving) return
    if (date > today) { setNotice('오늘 이후 날짜는 기록할 수 없습니다.'); return }
    setSaving(true)
    try {
      const body = {
        action: 'add-entries',
        // 자동 분류를 고쳤거나, 모르던 메모를 직접 고른 경우만 기억한다
        entries: drafts.map((d) => ({ date, amount: d.amount, memo: d.memo, categoryId: d.categoryId, payment: d.payment, learn: d.memo !== '' && (!d.known || d.categoryId !== d.autoCategoryId) })),
      }
      await apiFetch('/api/ui/money-flow', { method: 'POST', body: JSON.stringify(body), cacheMs: 0 })
      setNotice(`${drafts.length}건 기록했습니다.`)
      setDrafts([])
      setText('')
      setFailed([])
      if (!date.startsWith(month)) setMonth(date.slice(0, 7))
      else await load()
    } catch (error) {
      setNotice(`저장 실패: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSaving(false)
    }
  }

  const changeCategory = async (entry: Entry, categoryId: string) => {
    try {
      await apiFetch('/api/ui/money-flow', { method: 'POST', body: JSON.stringify({ action: 'update-entry', id: entry.id, date: entry.date, amount: entry.amount, memo: entry.memo, categoryId, payment: entry.payment, cut: entry.cut, mustPart: entry.mustPart, learn: entry.memo !== '' }), cacheMs: 0 })
      setEntries((list) => list.map((e) => e.id === entry.id ? { ...e, categoryId } : e))
      if (entry.memo) setNotice(`"${entry.memo}"은(는) 다음부터 ${categoryById(categoryId)?.label}(으)로 분류합니다.`)
      void load()
    } catch (error) {
      setNotice(`수정 실패: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const removeEntry = async (entry: Entry) => {
    if (!window.confirm(`${entry.memo || '메모 없음'} ${krw(entry.amount)} 기록을 지울까요?`)) return
    try {
      await apiFetch('/api/ui/money-flow', { method: 'POST', body: JSON.stringify({ action: 'delete-entry', id: entry.id }), cacheMs: 0 })
      setEntries((list) => list.filter((e) => e.id !== entry.id))
    } catch (error) {
      setNotice(`삭제 실패: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

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
        </div>
      </section>

      {notice && <p className="acc-note mf-notice" role="status">{notice}</p>}

      {tab === 'record' && (
        <>
          <section className="acc-card">
            <h2>빠른 기록</h2>
            <label className="acc-field">
              <span>무엇을 얼마에 (여러 줄 붙여넣기 가능)</span>
              <textarea
                className="mf-input" rows={2} value={text} placeholder={'냉동피자 4판 15170\n배민 치킨 2만원'}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !text.includes('\n')) { event.preventDefault(); readInput() } }}
              />
            </label>
            <div className="mf-row">
              <label className="acc-field mf-date"><span>날짜</span><input type="date" value={date} max={today} onChange={(event) => setDate(event.target.value)} /></label>
              <button type="button" className="acc-primary" onClick={readInput} disabled={!text.trim()}>읽기</button>
            </div>
            {failed.length > 0 && <p className="acc-warn">금액을 못 찾은 줄: {failed.join(' / ')}. 금액을 숫자로 적어 주세요(예: 15170, 1.5만원).</p>}

            {drafts.length > 0 && (
              <div className="mf-drafts" aria-label="저장 전 확인">
                {drafts.map((d) => (
                  <div key={d.key} className="mf-draft">
                    <div className="mf-draft-head"><strong>{d.memo || '메모 없음'}</strong><span>{krw(d.amount)}</span></div>
                    {!d.known && (
                      <div className="mf-chips" role="group" aria-label="분류 고르기">
                        <span className="acc-note">어디에 넣을까요?</span>
                        {suggestions.map((id) => (
                          <button key={id} type="button" className={d.categoryId === id ? 'is-active' : ''} aria-pressed={d.categoryId === id} onClick={() => updateDraft(d.key, { categoryId: id })}>{categoryById(id)?.label}</button>
                        ))}
                      </div>
                    )}
                    <div className="mf-draft-tools">
                      <CategorySelect label={`${d.memo || '메모 없음'} 분류`} value={d.categoryId} onChange={(id) => updateDraft(d.key, { categoryId: id })} />
                      <select aria-label={`${d.memo || '메모 없음'} 결제 수단`} value={d.payment} onChange={(event) => updateDraft(d.key, { payment: event.target.value as Payment })}>
                        <option value="cash">카드·현금</option>
                        <option value="point_regular">포인트(매달 꾸준히)</option>
                        <option value="point_once">포인트(이번만)</option>
                      </select>
                      <button type="button" className="acc-link" onClick={() => setDrafts((list) => list.filter((x) => x.key !== d.key))}>빼기</button>
                    </div>
                    <p className="mf-cut">{KIND_LABEL[categoryById(d.categoryId)!.kind]} · {CUT_LABEL[categoryById(d.categoryId)!.cut]}</p>
                  </div>
                ))}
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
                      <span className="mf-memo">{e.memo || '메모 없음'}{e.payment !== 'cash' && <em className="mf-point">{e.payment === 'point_once' ? '포인트·이번만' : '포인트'}</em>}</span>
                      <strong>{krw(e.amount)}</strong>
                    </div>
                    <div className="mf-list-tools">
                      <CategorySelect label={`${e.memo || '메모 없음'} 분류 바꾸기`} value={e.categoryId} onChange={(id) => void changeCategory(e, id)} />
                      <button type="button" className="mf-icon" aria-label={`${e.memo || '메모 없음'} 삭제`} onClick={() => void removeEntry(e)}><Trash2 size={15} /></button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {tab === 'month' && <MonthView month={month} thisMonth={thisMonth} setMonth={setMonth} entries={monthEntries} baseMonth={baseMonth} baseEntries={baseEntries} loading={loading} />}

      <p className="acc-note mf-foot">기록은 본인 계정에만 저장됩니다. 투자 가능액 계산은 <Link to="/seed-builder">시드 만들기</Link>에서 합니다.</p>
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
