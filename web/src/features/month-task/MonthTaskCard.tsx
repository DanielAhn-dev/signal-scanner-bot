import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import AmountHint from '../../components/ui/AmountHint'
import { apiFetch } from '../../lib/api'
import { formatKrwReadable } from '../../lib/format'
import { EMPTY_STATE, recommendCandidate, type AccumulateState } from '../../lib/accumulate'
import { useIndexEtfCandidates } from '../../lib/indexEtfLive'
import { QUERY_KEYS, usePositions } from '../../lib/queries'
import { useUserState } from '../../lib/userState'
import { kstToday, monthLabel, monthTaskView, type MonthTaskRecord } from '../../lib/monthTask'
import { useCurrentChatId } from '../../stores/profileStore'
import AccountTag from '../../components/ui/AccountTag'
import './month-task.css'

/**
 * 홈 '이번 달 할 일' — [실제] 내 계좌에서 이번 달에 무엇을 몇 주 살지 한 장면으로 안내하고 답을 받는다.
 * 넣는 날 전: 한 줄 예정 · 넣는 날부터 답하기 전: 할 일 카드 · 답한 뒤: 한 줄 완료.
 * 상품은 모아가기와 같은 판정(직접 지정 > 추천), 넣은 돈은 계획 금액이라고 보고 계산하고 다르면 고친다(증권사 연동 없음).
 * 산 기록은 실계좌 거래로 남기고(/api/ui/virtual-trade), 답은 user-state 'accumulate'.tasks에 남긴다.
 */
type Plan = { monthly: number; depositDay: number }

/** 실계좌 보유가 하나도 없을 때 남기는 계좌 이름 — 따라 사기 화면과 같은 값 */
const DEFAULT_ACCOUNT = { broker: '직접 입력', account: '실계좌' }

const won = formatKrwReadable

export default function MonthTaskCard() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const chatId = useCurrentChatId()
  const { value: accRaw, set: setAcc } = useUserState<AccumulateState>('accumulate')
  const acc: AccumulateState = { ...EMPTY_STATE, ...(accRaw ?? {}) }
  const etfView = useIndexEtfCandidates()
  const rec = useMemo(() => recommendCandidate(acc.goal, etfView.cands, etfView.asOf), [acc.goal, etfView])
  const product = acc.target ?? (rec.pick ? { code: rec.pick.code, name: rec.pick.name } : null)
  const { data: positions } = usePositions()

  const [plan, setPlan] = useState<Plan | null>(null)
  const [price, setPrice] = useState<number | null>(null)
  const [mode, setMode] = useState<'view' | 'amount' | 'different'>('view')
  const [amountText, setAmountText] = useState('')
  const [qtyText, setQtyText] = useState('')
  const [priceText, setPriceText] = useState('')
  const [accountKey, setAccountKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)

  useEffect(() => {
    if (!chatId) return
    let active = true
    apiFetch('/api/ui/investment-prefs', { cacheMs: 60_000, retries: 1 })
      .then((res) => {
        const p = res?.data?.plan
        if (active && p) setPlan({ monthly: Number(p.monthly) || 0, depositDay: Number(p.depositDay) || 1 })
      })
      .catch(() => { /* 계획을 못 읽으면 카드를 그리지 않는다 */ })
    return () => { active = false }
  }, [chatId])

  useEffect(() => {
    if (!product?.code) return
    let active = true
    apiFetch(`/api/ui/stock-latest?code=${encodeURIComponent(product.code)}`, { cacheMs: 300_000, retries: 0, timeoutMs: 15_000 })
      .then((res) => {
        const rows: Array<{ date: string; close: number }> = (Array.isArray(res?.data) ? res.data : []).map((r: any) => ({ date: String(r.date || ''), close: Number(r.close) }))
        // 실시간가(장 마감 뒤엔 종가)가 latest에 온다 — 일봉 이력이 없는 ETF는 data의 close가 0이다
        const live = Number(res?.latest?.close)
        const last = rows.filter((r) => r.close > 0).sort((a, b) => a.date.localeCompare(b.date)).pop()
        if (active) setPrice(live > 0 ? live : last ? last.close : null)
      })
      .catch(() => { if (active) setPrice(null) })
    return () => { active = false }
  }, [product?.code])

  // 실계좌 목록 — 보유 행의 증권사·계좌 이름. 없으면 기본 이름으로 남긴다
  const accounts = useMemo(() => {
    const seen = new Map<string, { broker: string; account: string }>()
    for (const r of (Array.isArray(positions) ? positions : []) as Array<{ broker_name?: string | null; account_name?: string | null }>) {
      const broker = String(r.broker_name ?? '').trim()
      const account = String(r.account_name ?? '').trim()
      if (!broker && !account) continue
      seen.set(`${broker}|||${account}`, { broker, account })
    }
    return [...seen.entries()].map(([key, v]) => ({ key, ...v }))
  }, [positions])

  if (!chatId || !plan || plan.monthly <= 0 || !product) return null

  const amount = Number(amountText) > 0 ? Math.round(Number(amountText)) : plan.monthly
  const view = monthTaskView({ today: kstToday(), depositDay: plan.depositDay, amount, price, tasks: acc.tasks })
  const month = monthLabel(view.ym)
  const chosen = accounts.find((a) => a.key === accountKey) ?? accounts[0] ?? { key: '', ...DEFAULT_ACCOUNT }

  const saveTask = (record: MonthTaskRecord) => {
    const tasks = { ...(acc.tasks ?? {}), [view.ym]: record }
    // 산 달은 '이어서 넣은 달'에도 세도록 그달 넣은 돈을 같이 남긴다
    const deposits = record.status === 'bought' && record.amount
      ? [...acc.deposits.filter(([m]) => m !== view.ym), [view.ym, record.amount] as [string, number]].sort((a, b) => a[0].localeCompare(b[0]))
      : acc.deposits
    setAcc({ ...acc, tasks, deposits })
  }

  const recordBuy = async (qty: number, unitPrice: number) => {
    if (busyRef.current) return
    if (!Number.isInteger(qty) || qty <= 0 || !(unitPrice > 0)) { setError('수량과 가격을 확인해 주세요'); return }
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const res = await apiFetch('/api/ui/virtual-trade', {
        method: 'POST', cacheMs: 0, timeoutMs: 15_000,
        body: JSON.stringify({ code: product.code, side: 'BUY', quantity: qty, price: unitPrice, broker_name: chosen.broker, account_name: chosen.account, memo: `month-task:${view.ym}` }),
      })
      if (res?.error) throw new Error(String(res.error))
      // 저장이 성공한 뒤에만 완료로 바꾼다
      saveTask({ status: 'bought', code: product.code, name: product.name, qty, price: unitPrice, amount, at: new Date().toISOString() })
      setMode('view')
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.positions(chatId) })
    } catch (e) {
      setError(`기록하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const undo = () => {
    const tasks = { ...(acc.tasks ?? {}) }
    delete tasks[view.ym]
    setAcc({ ...acc, tasks })
  }

  // 답한 달 · 넣는 날 전 — 한 줄
  if (view.phase !== 'due') {
    const r = view.record
    return (
      <section className="mt mt--line" aria-label="이번 달 할 일">
        <AccountTag kind="real" />
        {view.phase === 'upcoming' && <span>다음 할 일 {Number(view.dueDate.slice(5, 7))}/{Number(view.dueDate.slice(8))} · {product.name} {view.qty != null ? `약 ${view.qty}주` : ''}</span>}
        {view.phase === 'bought' && r && <span>{month} 완료 · {r.name ?? product.name} {r.qty}주</span>}
        {view.phase === 'skipped' && <span>{month}은 건너뛰었어요 <button type="button" className="mt__link" onClick={undo}>다시 하기</button></span>}
        {view.phase === 'later' && <span>내 계좌는 다음 달부터 시작해요 <button type="button" className="mt__link" onClick={undo}>이번 달에 하기</button></span>}
      </section>
    )
  }

  return (
    <section className="mt" aria-label="이번 달 할 일">
      <div className="mt__head">
        <AccountTag kind="real" />
        <strong>{month} 할 일</strong>
      </div>
      <p className="mt__main">
        <strong>{product.name} {view.qty != null ? `${view.qty}주` : ''}</strong> 사기
        {price ? <span className="mt__muted"> · 주당 약 {won(price)}</span> : <span className="mt__muted"> · 가격을 불러오는 중</span>}
      </p>
      <p className="mt__muted">
        내 계좌에 {won(amount)}을 넣었다고 보고 계산했어요{view.leftover != null && view.leftover > 0 ? ` · 남는 ${won(view.leftover)}은 예수금으로 둡니다` : ''}.{' '}
        {mode !== 'amount' && <button type="button" className="mt__link" onClick={() => { setAmountText(String(amount)); setMode('amount') }}>넣은 금액 고치기</button>}
      </p>
      {mode === 'amount' && (
        <label className="mt__field"><span>이번 달 넣은 돈(원)</span>
          <input type="number" inputMode="numeric" min="0" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
          <AmountHint value={amountText} />
        </label>
      )}
      {accounts.length > 1 && (
        <label className="mt__field"><span>산 계좌</span>
          <select value={chosen.key} onChange={(e) => setAccountKey(e.target.value)}>
            {accounts.map((a) => <option key={a.key} value={a.key}>{[a.broker, a.account].filter(Boolean).join(' · ')}</option>)}
          </select>
        </label>
      )}
      {mode === 'different' ? (
        <div className="mt__row">
          <label className="mt__field"><span>산 수량(주)</span><input type="number" inputMode="numeric" min="1" value={qtyText} onChange={(e) => setQtyText(e.target.value)} /></label>
          <label className="mt__field"><span>체결 가격(원)</span><input type="number" inputMode="numeric" min="1" value={priceText} onChange={(e) => setPriceText(e.target.value)} /></label>
          <div className="mt__actions">
            <button type="button" className="mt__primary" disabled={busy} onClick={() => void recordBuy(Math.round(Number(qtyText)), Number(priceText))}>기록</button>
            <button type="button" className="mt__secondary" disabled={busy} onClick={() => setMode('view')}>취소</button>
          </div>
        </div>
      ) : (
        <div className="mt__actions">
          <button type="button" className="mt__primary" disabled={busy || !price || !view.qty} onClick={() => void recordBuy(view.qty!, price!)}>샀어요</button>
          <button type="button" className="mt__secondary" disabled={busy} onClick={() => { setQtyText(view.qty ? String(view.qty) : ''); setPriceText(price ? String(Math.round(price)) : ''); setMode('different') }}>다르게 샀어요</button>
          {view.firstTime
            ? <button type="button" className="mt__secondary" disabled={busy} onClick={() => saveTask({ status: 'later', at: new Date().toISOString() })}>다음 달부터 시작</button>
            : <button type="button" className="mt__secondary" disabled={busy} onClick={() => saveTask({ status: 'skipped', at: new Date().toISOString() })}>이번 달은 못 함</button>}
        </div>
      )}
      {error && <p className="mt__error" role="alert">{error}</p>}
      <p className="mt__foot">
        <AccountTag kind="virtual" /> 가상 계좌는 계획대로 자동으로 삽니다. 할 일은 없어요.
        <button type="button" className="mt__link" onClick={() => navigate('/follow')}>계획 vs 실제 보기 <ChevronRight size={12} aria-hidden /></button>
      </p>
    </section>
  )
}
