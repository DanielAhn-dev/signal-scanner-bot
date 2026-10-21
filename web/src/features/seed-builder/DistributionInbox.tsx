import { useEffect, useRef, useState } from 'react'
import More from '../../components/ui/More'
import { Link } from 'react-router-dom'
import { apiFetch, invalidateCache } from '../../lib/api'
import { reinvestLabel, reinvestTargets } from '../income-guide/reinvestTarget'

type Props = {
  /** 이번 달 YYYY-MM */
  month: string
  /** 이 달 투자금 '분배금 재투자' 칸에 이미 넣은 금액 */
  invested: number
  /** 그 칸에 더하고(+) 빼서(−) 저장. 저장이 성공해야 true */
  onApply: (delta: number) => Promise<boolean>
  krw: (amount: number) => string
}

type CashDeposit = { month: string; accountKey: string; amount: number }
type GuideSlice = {
  received: number
  estimated: number
  buyName: string | null
  count: number
  accounts: Array<{ key: string; label: string }>
  /** 받은 분배금만큼 은행에서 넣은 계좌·금액 (서버 cashDeposits) */
  deposit: CashDeposit | null
  /** 분배금을 적을 때 이미 계좌 예수금에 더해진 합계(cashApplied) */
  appliedToCash: number
}
type ReceiptItem = { code?: string; cashApplied?: number }

const GUIDE = '/api/ui/income-guide'

/**
 * 이번 달 투자금 맨 위: 실계좌에서 이 달 받은 분배금(리밸런싱 가이드의 받은 분배금 기록)을 투자금에 넣는다.
 * 이미 넣은 금액(칸 값)과의 차이만 넣으므로 두 번 눌러도 중복되지 않고, 기록을 고치면 차이만 다시 보인다.
 * 입금한 계좌를 고르면 그 계좌 예수금에도 같은 금액을 더한다(은행에서 새로 넣은 돈). 고르지 않으면 투자금 기록만 바뀐다 —
 * 2026-10-21 '넣음'을 눌렀는데 계좌 예수금이 그대로라 헷갈렸다 → 버튼 문구가 무엇이 바뀌는지 그대로 말한다.
 */
export default function DistributionInbox({ month, invested, onApply, krw }: Props) {
  const [slice, setSlice] = useState<GuideSlice | null>(null)
  const [account, setAccount] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const busyRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    apiFetch(GUIDE, { cacheMs: 60_000, retries: 0, timeoutMs: 20_000 })
      .then((res) => {
        const d = res?.data
        const r = d?.distributionReceipts
        if (cancelled || !r || r.thisMonth?.month !== month) return
        const items: ReceiptItem[] = r.thisMonth.items ?? []
        // 분배금이 들어온 계좌의 살 곳 — 리밸런싱 가이드·리포트와 같은 판정(서버 indexProductChoice)
        const buyName = reinvestLabel(reinvestTargets(d?.plan, items.map((i) => String(i.code ?? '')), Array.isArray(d?.holdings) ? d.holdings : []))
        const accounts = Array.isArray(d?.accountList) ? d.accountList.map((a: { key: string; label: string }) => ({ key: String(a.key), label: String(a.label) })) : []
        const deposit: CashDeposit | null = r.cashDeposit && r.cashDeposit.month === month ? r.cashDeposit : null
        setSlice({
          received: Number(r.thisMonth.net) || 0,
          estimated: Number(r.thisMonth.estimatedCount) || 0,
          buyName,
          count: items.length,
          accounts,
          deposit,
          appliedToCash: items.reduce((s, i) => s + (Number(i.cashApplied) || 0), 0),
        })
        if (deposit) setAccount(deposit.accountKey)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [month])

  if (!slice || (slice.received <= 0 && invested <= 0)) return null
  const gap = slice.received - invested
  const labelOf = (key: string) => slice.accounts.find((a) => a.key === key)?.label ?? key
  const deposit = slice.deposit

  /** 그 계좌 예수금에 더한 이 달 금액을 amount로 맞춘다(계좌 null·0이면 되돌림). 성공하면 true */
  const saveDeposit = async (accountKey: string | null, amount: number): Promise<boolean> => {
    try {
      const res = await apiFetch(GUIDE, { method: 'POST', body: JSON.stringify({ action: 'cash-deposit', month, accountKey, amount }), cacheMs: 0, retries: 0, timeoutMs: 20_000 })
      if (!res?.data) {
        setMsg(res?.error ?? '계좌 예수금을 저장하지 못했습니다.')
        return false
      }
      invalidateCache(GUIDE)
      const next: CashDeposit | null = res.data.distributionReceipts?.cashDeposit ?? null
      // 서버가 이 요청을 모르면(배포 전) 성공처럼 답하고 아무것도 안 바꾼다 — 돌려받은 기록으로 확인한다
      if (accountKey && amount > 0 ? next?.accountKey !== accountKey || next?.amount !== Math.round(amount) : next != null) {
        setMsg('계좌 예수금에 반영되지 않았습니다. 서버가 아직 이 기능을 모르는 것 같습니다 — 잠시 뒤 새로 고쳐 다시 눌러 주세요.')
        return false
      }
      setSlice((s) => (s ? { ...s, deposit: next } : s))
      const adj = res.cashAdjust as { before: number; after: number } | null | undefined
      const where = accountKey ?? deposit?.accountKey
      setMsg(adj && where ? `${labelOf(where)} 예수금 ${krw(adj.before)} → ${krw(adj.after)}` : null)
      return true
    } catch (e: unknown) {
      const text = e instanceof Error ? e.message : String(e)
      setMsg(text.match(/"error":"([^"]+)"/)?.[1] ?? '계좌 예수금을 저장하지 못했습니다. 잠시 뒤 다시 눌러 주세요.')
      return false
    }
  }

  const guard = async (fn: () => Promise<void>) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setMsg(null)
    try {
      await fn()
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  // 투자금 기록을 delta만큼 바꾸고, 계좌를 고른 상태면 그 계좌 예수금도 투자금 기록과 같은 금액으로 맞춘다
  const put = (delta: number) =>
    guard(async () => {
      if (delta === 0 || !(await onApply(delta))) return
      const key = account || null
      if (key || deposit) {
        const amount = key ? invested + delta : 0
        // 예수금 저장이 실패하면 투자금 기록도 되돌린다 — 한쪽만 바뀐 채로 두지 않는다
        if (!(await saveDeposit(key, amount))) await onApply(-delta)
      }
    })
  const undoAll = () =>
    guard(async () => {
      if (deposit && !(await saveDeposit(null, 0))) return
      await onApply(-invested)
    })
  const linkOnly = (key: string | null) => guard(async () => { await saveDeposit(key, key ? invested : 0) })

  const picker = (
    <label className="seed-inbox-field">
      입금한 계좌
      <select value={account} disabled={busy} onChange={(e) => setAccount(e.target.value)} aria-label="입금한 계좌">
        <option value="">고르지 않음 (투자금 기록만)</option>
        {slice.accounts.map((a) => (
          <option key={a.key} value={a.key}>{a.label}</option>
        ))}
      </select>
    </label>
  )

  return (
    <section className="seed-inbox" aria-label="받은 분배금">
      <h2>이번 달 받은 분배금 {krw(slice.received)}</h2>
      <div className="seed-inbox-item">
        <p className="seed-inbox-guide">
          리밸런싱 가이드에 적은 {slice.count}종목 세후 합계입니다{slice.estimated > 0 ? `(세후를 안 적은 ${slice.estimated}건은 15.4%를 떼고 계산)` : ''}.
          {' '}<Link to="/income-guide#receipts">받은 분배금 더 적기·고치기</Link>
          {' '}재투자는 {slice.buyName ? <strong>{slice.buyName}</strong> : '성장 지수 ETF'} 한 곳으로 — 커버드콜·배당 ETF를 더 사지 않습니다.
        </p>
        <More label="계좌를 골라야 하나요">
          <p className="seed-inbox-guide">
            은행에서 분배금만큼 증권 계좌로 새로 넣었다면 그 계좌를 고르세요 — 투자금 기록과 그 계좌 예수금(리밸런싱 가이드)에 같이 더합니다.
            분배금이 받은 계좌에 그대로 있다면 고르지 마세요. 분배금을 적을 때 이미 그 계좌 예수금에 더해졌습니다.
          </p>
        </More>
        {slice.appliedToCash > 0 && !deposit && (
          <p className="seed-inbox-guide">분배금을 적을 때 이미 계좌 예수금에 {krw(slice.appliedToCash)} 더해졌습니다. 은행에서 새로 넣은 돈일 때만 계좌를 고르세요.</p>
        )}
        {gap > 0 ? (
          <>
            {picker}
            <div className="seed-inbox-actions">
              <button type="button" className="seed-primary" disabled={busy} onClick={() => void put(gap)}>
                {busy ? '저장 중' : account ? `${krw(gap)} 투자금에 넣고 ${labelOf(account)} 예수금에 더하기` : `${krw(gap)} 투자금 기록에만 넣기`}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="seed-inbox-done">
              <span>
                {krw(invested)} 투자금에 넣음{gap < 0 ? ` · 기록보다 ${krw(-gap)} 많음` : ''}
                {' · '}
                {deposit ? `${labelOf(deposit.accountKey)} 예수금에 ${krw(deposit.amount)} 더함` : '계좌 예수금은 그대로'}
              </span>
              <span className="seed-inbox-actions">
                {deposit && (
                  <button type="button" className="seed-link-button" disabled={busy} onClick={() => void linkOnly(null)}>예수금에서 빼기</button>
                )}
                {gap < 0 && (
                  <button type="button" className="seed-link-button" disabled={busy} onClick={() => void put(gap)}>기록에 맞추기</button>
                )}
                <button type="button" className="seed-link-button" disabled={busy} onClick={() => void undoAll()}>되돌리기</button>
              </span>
            </div>
            {!deposit && invested > 0 && (
              <div className="seed-inbox-actions">
                {picker}
                <button type="button" className="seed-secondary" disabled={busy || !account} onClick={() => void linkOnly(account)}>
                  {account ? `${labelOf(account)} 예수금에 ${krw(invested)} 더하기` : '계좌를 고르면 예수금에 더합니다'}
                </button>
              </div>
            )}
          </>
        )}
        {msg && <p className="seed-inbox-guide" role="status">{msg}</p>}
      </div>
    </section>
  )
}
