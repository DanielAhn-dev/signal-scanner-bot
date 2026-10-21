import { useState } from 'react'
import More from '../../components/ui/More'
import { Trash2 } from 'lucide-react'
import { formatKrwMan } from '../../lib/format'
import { useUserState } from '../../lib/userState'
import { useIndexEtfCandidates } from '../../lib/indexEtfLive'
import {
  HORIZON_LABEL, MAX_ITEMS, adviceFor, daysUntil, ddayLabel, newMaturityId, sanitizeMaturityState, sortMaturities, statusOf, summarizeUpcoming,
  type Maturity, type MaturityHorizon, type MaturityState,
} from '../../lib/maturity'
import '../accumulate/accumulate.css'
import './money-flow.css'

const kstToday = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' })
const STATUS_TEXT = { overdue: '만기 지남', soon: '곧 만기', later: '', done: '처리함' } as const

/**
 * 만기 예·적금 기록 — 만기 때 "이 돈을 어디로 보낼지"를 미리 정해 둔다.
 * 상품 추천·금리 비교는 하지 않는다. 쓸 시점(3년 안 / 3~5년 / 5년 넘게)만 고르면 검증한 결론이 한 줄로 붙는다.
 */
export default function MaturityTab() {
  const { value, set } = useUserState<MaturityState>('maturities')
  const etfView = useIndexEtfCandidates()
  const items = sanitizeMaturityState(value).items
  const today = kstToday()
  const [name, setName] = useState('')
  const [manwon, setManwon] = useState('')
  const [date, setDate] = useState('')
  const [horizon, setHorizon] = useState<MaturityHorizon>('3to5')
  const [open, setOpen] = useState<string | null>(null)

  const amount = Math.round(Number(manwon.replace(/,/g, '')) * 10_000)
  const canAdd = name.trim().length > 0 && Number.isFinite(amount) && amount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date) && items.length < MAX_ITEMS
  const save = (next: Maturity[]) => set({ items: next })
  const [added, setAdded] = useState<string | null>(null)
  // 이름·만기일·금액이 같은 미처리 항목이 이미 있으면 중복 입력으로 본다(미래 만기는 이번 달 화면에 안 보여 다시 넣기 쉽다)
  const duplicate = canAdd && items.some((i) => !i.done && i.name === name.trim().slice(0, 30) && i.date === date && i.amount === amount)
  const add = () => {
    if (!canAdd) return
    const label = `${name.trim().slice(0, 30)} ${date}`
    save([...items, { id: newMaturityId(), name: name.trim().slice(0, 30), amount, date, horizon }])
    setName(''); setManwon(''); setDate('')
    setAdded(label)
  }
  const toggleDone = (id: string) => save(items.map((i) => (i.id === id ? { ...i, done: i.done ? undefined : true } : i)))
  const remove = (id: string) => { save(items.filter((i) => i.id !== id)); if (open === id) setOpen(null) }

  const sorted = sortMaturities(items)
  const summary = summarizeUpcoming(items)

  return (
    <>
      <section className="acc-card">
        <h2>만기 예·적금, 어디로 보낼지 미리</h2>
        <p className="acc-note">
          만기일과 이 돈을 쓸 시점만 적으면, 만기 때 갈 곳을 한 줄로 보여드립니다.
        </p>
        <More label="왜 미리 정하나"><p className="acc-note">만기 날 금리나 지수를 보고 판단하면 미루거나 흔들리기 쉽습니다. 상품을 추천하거나 수익을 비교하지 않습니다.</p></More>
        {summary.next && (
          <p className="acc-note">
            남은 만기 <strong>{summary.count}건 · {formatKrwMan(summary.amount)}</strong>.
            가장 가까운 것은 <strong>{summary.next.name}</strong> {ddayLabel(daysUntil(summary.next.date, today))}입니다.
          </p>
        )}
      </section>

      <section className="acc-card">
        <h3>만기 추가</h3>
        <label className="acc-field">
          <span>이름 (예: OO적금)</span>
          <input type="text" maxLength={30} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="mf-row">
          <label className="acc-field mf-date">
            <span>만기 때 받을 금액 (만원)</span>
            <input type="text" inputMode="numeric" value={manwon} placeholder="1000" onChange={(e) => setManwon(e.target.value)} />
          </label>
          <label className="acc-field mf-date">
            <span>만기일</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>
        <label className="acc-field">
          <span>이 돈을 쓸 시점</span>
          <select value={horizon} onChange={(e) => setHorizon(e.target.value as MaturityHorizon)}>
            {(Object.keys(HORIZON_LABEL) as MaturityHorizon[]).map((h) => <option key={h} value={h}>{HORIZON_LABEL[h]}</option>)}
          </select>
        </label>
        <p className="acc-note mf-small">잘 모르겠으면 "3~5년 뒤"로 두세요. 비상금은 여기 넣지 않습니다.</p>
        {duplicate && <p className="acc-note mf-small" role="alert">같은 이름·만기일·금액이 이미 아래 목록에 있습니다. 또 추가하면 중복으로 들어갑니다.</p>}
        <button type="button" className="acc-primary" disabled={!canAdd} onClick={add}>{duplicate ? '그래도 추가' : '추가'}</button>
        {added && <p className="acc-note mf-small" role="status">{added} 만기를 저장했습니다. 아래 "만기 순서"에서 확인하세요. 만기 달이 되기 전에는 이번 달 투자금 위쪽에 나오지 않습니다.</p>}
        {items.length >= MAX_ITEMS && <p className="acc-note mf-small">최대 {MAX_ITEMS}건까지 적을 수 있습니다. 처리한 항목을 지우고 추가하세요.</p>}
      </section>

      {sorted.length > 0 && (
        <section className="acc-card">
          <h3>만기 순서</h3>
          <ul className="mf-list">
            {sorted.map((item) => {
              const status = statusOf(item, today)
              const advice = adviceFor(item.horizon, etfView)
              const isOpen = open === item.id
              return (
                <li key={item.id} style={item.done ? { opacity: 0.55 } : undefined}>
                  <div className="mf-list-main">
                    <span className="mf-date-cell">{item.date}</span>
                    <span className="mf-memo">
                      {item.name}
                      <em className="mf-point">{HORIZON_LABEL[item.horizon]}</em>
                    </span>
                    <strong>{formatKrwMan(item.amount)}</strong>
                  </div>
                  <div className="mf-maturity-tools">
                    <span className="mf-maturity-info">
                      <span className={`mf-maturity-status${status === 'done' ? '' : ' is-live'}`}>
                        {status === 'done' ? STATUS_TEXT.done : `${ddayLabel(daysUntil(item.date, today))}${STATUS_TEXT[status] ? ` · ${STATUS_TEXT[status]}` : ''}`}
                      </span>
                      <button type="button" className="acc-link mf-maturity-toggle" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : item.id)}>
                        {isOpen ? '접기' : '갈 곳 보기'}
                      </button>
                    </span>
                    <span className="mf-maturity-actions">
                      {/* 투자금에 넣을지 정한 건 그 달 투자금 화면에서만 되돌린다(넣은 금액도 함께 빼야 해서) */}
                      {item.investedMonth
                        ? <span className="mf-maturity-status">{Number(item.investedMonth.slice(5))}월 투자금 {item.investedAmount ? formatKrwMan(item.investedAmount) : '넣지 않음'}</span>
                        : <button type="button" className={`mf-chip-btn${item.done ? '' : ' is-primary'}`} onClick={() => toggleDone(item.id)}>{item.done ? '처리 취소' : '처리했어요'}</button>}
                      <button type="button" className="mf-icon mf-icon-quiet" aria-label={`${item.name} 삭제`} onClick={() => remove(item.id)}><Trash2 size={16} /></button>
                    </span>
                  </div>
                  {isOpen && (
                    <div className="mf-notice">
                      <p className="acc-note"><strong>{advice.where}</strong></p>
                      <ul className="acc-note">{advice.steps.map((s) => <li key={s}>{s}</li>)}</ul>
                      <p className="acc-note mf-small">{advice.why}</p>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
          <p className="acc-note mf-small">수익을 보장하지 않습니다.</p>
          <More label="이 안내의 용도·세금 확인"><p className="acc-note mf-small">같은 규칙을 만기마다 반복해 판단을 줄이는 용도입니다. "3~5년 뒤"는 지수 비중을 절반 안팎으로 제한하는 안전한 쪽입니다. 이자 소득이 합쳐서 연 1,000만원(건보료)·2,000만원(종합과세)을 넘는지는 직접 확인하세요.</p></More>
        </section>
      )}
    </>
  )
}
