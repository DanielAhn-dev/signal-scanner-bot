import { useRef, useState } from 'react'
import { useUserState } from '../../lib/userState'
import { useIndexEtfCandidates } from '../../lib/indexEtfLive'
import {
  HORIZON_LABEL, adviceFor, maturitiesDecidedIn, maturitiesDue, sanitizeMaturityState, suggestedInvest,
  type Maturity, type MaturityState,
} from '../../lib/maturity'

type Props = {
  /** 이번 달 YYYY-MM */
  month: string
  /** 이 달 투자금 '예·적금 만기' 칸에 더하고(+) 빼서(−) 저장. 저장이 성공해야 true */
  onApply: (delta: number) => Promise<boolean>
  krw: (amount: number) => string
}

const toWon = (text: string) => Math.max(0, Math.round(Number(text.replace(/,/g, '')) || 0))

/**
 * 이번 달 투자금 맨 위: 만기가 온 예·적금을 이 달 투자금에 넣을지 정한다.
 * 넣을 금액과 빼 둘 금액(다시 예·적금 등)을 나눠 적고, 넣은 금액만 이 달 일시 수입으로 더한다.
 */
export default function MaturityInbox({ month, onApply, krw }: Props) {
  const { value, set } = useUserState<MaturityState>('maturities')
  const etfView = useIndexEtfCandidates()
  const items = sanitizeMaturityState(value).items
  const due = maturitiesDue(items, month)
  const decided = maturitiesDecidedIn(items, month)
  const [invest, setInvest] = useState<Record<string, number>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const busy = useRef(false)

  if (due.length === 0 && decided.length === 0) return null

  const investOf = (item: Maturity) => Math.min(item.amount, invest[item.id] ?? suggestedInvest(item))
  const patchItem = (id: string, patch: (item: Maturity) => Maturity) => set({ items: items.map((i) => (i.id === id ? patch(i) : i)) })

  const run = async (item: Maturity, delta: number, after: () => void) => {
    if (busy.current) return
    busy.current = true
    setBusyId(item.id)
    try {
      if (delta === 0 || await onApply(delta)) after()
    } finally {
      busy.current = false
      setBusyId(null)
    }
  }
  const decide = (item: Maturity, amount: number) => run(item, amount, () => patchItem(item.id, (i) => ({ ...i, done: true, investedMonth: month, investedAmount: amount })))
  const undo = (item: Maturity) => run(item, -(item.investedAmount ?? 0), () => patchItem(item.id, ({ investedMonth: _m, investedAmount: _a, done: _d, ...rest }) => rest))

  return (
    <section className="seed-inbox" aria-label="만기 도착">
      {due.length > 0 && <h2>만기 도착 {due.length}건 · {krw(due.reduce((s, i) => s + i.amount, 0))}</h2>}
      {due.map((item) => {
        const amount = investOf(item)
        return (
          <div key={item.id} className="seed-inbox-item">
            <div className="seed-inbox-head">
              <strong>{item.name} {krw(item.amount)}</strong>
              <small>{item.date} 만기 · {HORIZON_LABEL[item.horizon]}</small>
            </div>
            <p className="seed-inbox-guide">갈 곳: {adviceFor(item.horizon, etfView).where}</p>
            <div className="seed-inbox-split">
              <label>투자금에 넣을 금액
                <input type="number" inputMode="numeric" min="0" step="10000" max={item.amount} aria-label={`${item.name} 투자금에 넣을 금액`} value={amount}
                  onChange={(e) => setInvest((cur) => ({ ...cur, [item.id]: Math.min(item.amount, toWon(e.target.value)) }))} />
              </label>
              <label>빼 둘 금액(다시 예·적금 등)
                <input type="number" inputMode="numeric" min="0" step="10000" max={item.amount} aria-label={`${item.name} 빼 둘 금액`} value={item.amount - amount}
                  onChange={(e) => setInvest((cur) => ({ ...cur, [item.id]: item.amount - Math.min(item.amount, toWon(e.target.value)) }))} />
              </label>
            </div>
            <div className="seed-inbox-actions">
              <button type="button" className="seed-primary" disabled={busyId !== null || amount <= 0} onClick={() => void decide(item, amount)}>{busyId === item.id ? '저장 중' : `${krw(amount)} 투자금에 넣기`}</button>
              <button type="button" className="seed-secondary" disabled={busyId !== null} onClick={() => void decide(item, 0)}>넣지 않고 넘기기</button>
            </div>
          </div>
        )
      })}
      {decided.length > 0 && (
        <div className="seed-inbox-item">
          {decided.map((item) => (
            <div key={item.id} className="seed-inbox-done">
              <span>{item.name}: {item.investedAmount ? `${krw(item.investedAmount)} 넣음` : '넣지 않음'}{item.investedAmount !== item.amount ? ` · ${krw(item.amount - (item.investedAmount ?? 0))} 뺌` : ''}</span>
              <button type="button" className="seed-link-button" disabled={busyId !== null} onClick={() => void undo(item)}>되돌리기</button>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
