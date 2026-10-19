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
import { groupMonthBuys, kstToday, monthLabel, monthTaskView, type MonthBuy, type MonthTaskRecord } from '../../lib/monthTask'
import { useCurrentChatId } from '../../stores/profileStore'
import AccountTag from '../../components/ui/AccountTag'
import { PLAN_CHANGED_EVENT } from './RaiseNudge'
import './month-task.css'

/**
 * 홈 '이번 달 할 일' — [실제] 내 계좌에서 이번 달에 무엇을 몇 주 살지 한 장면으로 안내하고 답을 받는다.
 * 넣는 날 전: 한 줄 예정 · 넣는 날부터 답하기 전: 할 일 카드 · 답한 뒤: 한 줄 완료.
 * 상품은 모아가기와 같은 판정(직접 지정 > 추천), 넣은 돈은 계획 금액이라고 보고 계산하고 다르면 고친다(증권사 연동 없음).
 *
 * 기록은 "실계좌 거래" 한 곳만 믿는다(2026-10-19):
 * - 포트폴리오에서 이번 달 매수를 먼저 적었으면 카드가 알아보고 '이걸로 완료'로 답만 남긴다(새 거래를 만들지 않음).
 * - '샀어요'는 바로 저장하지 않고 수량·체결가·계좌를 확인한 뒤 저장한다(예상 가격으로 기록이 남지 않게).
 * - 실계좌가 하나도 없으면 첫 매수 때 증권사·계좌 이름을 받는다(포트폴리오에 낯선 기본 이름이 생기지 않게).
 * 산 기록은 /api/ui/virtual-trade 실계좌 매수, 답은 user-state 'accumulate'.tasks.
 */
type Plan = { monthly: number; depositDay: number }

const won = formatKrwReadable
const shortDate = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`

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
  const [monthBuys, setMonthBuys] = useState<MonthBuy[]>([])
  const [mode, setMode] = useState<'view' | 'amount' | 'confirm'>('view')
  // 이번 달 매수가 있어도 더 살 사람은 할 일 카드로
  const [buyMore, setBuyMore] = useState(false)
  const [amountText, setAmountText] = useState('')
  const [qtyText, setQtyText] = useState('')
  const [priceText, setPriceText] = useState('')
  const [accountKey, setAccountKey] = useState('')
  const [newBroker, setNewBroker] = useState('')
  const [newAccount, setNewAccount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)

  const [planVersion, setPlanVersion] = useState(0)
  useEffect(() => {
    // 해마다 늘리기(RaiseNudge)·모아가기에서 계획 금액을 바꾸면 다시 읽는다
    const onChanged = () => setPlanVersion((v) => v + 1)
    window.addEventListener(PLAN_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(PLAN_CHANGED_EVENT, onChanged)
  }, [])
  useEffect(() => {
    if (!chatId) return
    let active = true
    apiFetch('/api/ui/investment-prefs', { cacheMs: planVersion ? 0 : 60_000, retries: 1 })
      .then((res) => {
        const p = res?.data?.plan
        if (active && p) setPlan({ monthly: Number(p.monthly) || 0, depositDay: Number(p.depositDay) || 1 })
      })
      .catch(() => { /* 계획을 못 읽으면 카드를 그리지 않는다 */ })
    return () => { active = false }
  }, [chatId, planVersion])

  const loadMonthBuys = (cacheMs: number) => {
    apiFetch('/api/ui?route=saving-progress', { cacheMs, timeoutMs: 20_000, retries: 1 })
      .then((res) => setMonthBuys(Array.isArray(res?.data?.monthBuys) ? res.data.monthBuys : []))
      .catch(() => { /* 못 읽으면 기존 매수를 모르는 채로 할 일을 보여 준다 — 확인 단계에서 다시 묻는다 */ })
  }
  useEffect(() => {
    if (chatId) loadMonthBuys(60_000)
  }, [chatId]) // eslint-disable-line react-hooks/exhaustive-deps

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

  // 실계좌 목록 — 보유 행의 증권사·계좌 이름
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
  const groups = groupMonthBuys(monthBuys, product.code)
  const nameOf = (code: string) => (code === product.code ? product.name : code)
  const chosen = accounts.find((a) => a.key === accountKey) ?? accounts[0] ?? null

  const saveTask = (record: MonthTaskRecord) => {
    const tasks = { ...(acc.tasks ?? {}), [view.ym]: record }
    // 산 달은 '이어서 넣은 달'에도 세도록 그달 넣은 돈을 같이 남긴다
    const deposits = record.status === 'bought' && record.amount
      ? [...acc.deposits.filter(([m]) => m !== view.ym), [view.ym, record.amount] as [string, number]].sort((a, b) => a[0].localeCompare(b[0]))
      : acc.deposits
    setAcc({ ...acc, tasks, deposits })
  }

  const openConfirm = () => {
    setQtyText(view.qty ? String(view.qty) : '')
    setPriceText(price ? String(Math.round(price)) : '')
    setError(null)
    setMode('confirm')
  }

  const recordBuy = async () => {
    if (busyRef.current) return
    const qty = Math.round(Number(qtyText))
    const unitPrice = Number(priceText)
    const broker = chosen ? chosen.broker : newBroker.trim()
    const account = chosen ? chosen.account : newAccount.trim()
    if (!Number.isInteger(qty) || qty <= 0 || !(unitPrice > 0)) { setError('산 수량과 체결 가격을 확인해 주세요'); return }
    if (!account) { setError('어느 계좌에서 샀는지 계좌 이름을 적어 주세요'); return }
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      const res = await apiFetch('/api/ui/virtual-trade', {
        method: 'POST', cacheMs: 0, timeoutMs: 15_000,
        body: JSON.stringify({ code: product.code, side: 'BUY', quantity: qty, price: unitPrice, broker_name: broker || null, account_name: account, memo: `month-task:${view.ym}` }),
      })
      if (res?.error) throw new Error(String(res.error))
      // 저장이 성공한 뒤에만 완료로 바꾼다
      saveTask({ status: 'bought', code: product.code, name: product.name, qty, price: unitPrice, amount, at: new Date().toISOString() })
      setMode('view')
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.positions(chatId) })
      loadMonthBuys(0)
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

  // 포트폴리오에 이번 달 매수가 이미 있으면 — 새로 기록하지 않고 그걸로 답한다
  if (groups.length > 0 && !buyMore) {
    const g = groups[0]
    return (
      <section className="mt" aria-label="이번 달 할 일">
        <div className="mt__head">
          <AccountTag kind="real" />
          <strong>{month} · 포트폴리오에 이번 달 매수가 있어요</strong>
        </div>
        <ul className="mt__buys">
          {groups.map((x) => (
            <li key={x.code}><strong>{nameOf(x.code)} {x.qty}주</strong> <span className="mt__muted">· {shortDate(x.lastDate)} · 주당 {won(x.avgPrice)}{x.account ? ` · ${x.account}` : ''}</span></li>
          ))}
        </ul>
        <div className="mt__actions">
          <button type="button" className="mt__primary" onClick={() => saveTask({ status: 'bought', code: g.code, name: nameOf(g.code), qty: g.qty, price: Math.round(g.avgPrice), amount: Math.round(groups.reduce((s, x) => s + x.amount, 0)), at: new Date().toISOString() })}>이걸로 완료</button>
          <button type="button" className="mt__secondary" onClick={() => setBuyMore(true)}>이번 달에 더 살 거예요</button>
        </div>
        <p className="mt__muted">이미 적은 매수를 그대로 씁니다. 같은 매수를 다시 기록하지 않아요.</p>
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
        {mode === 'view' && <button type="button" className="mt__link" onClick={() => { setAmountText(String(amount)); setMode('amount') }}>넣은 금액 고치기</button>}
      </p>
      {mode === 'amount' && (
        <label className="mt__field"><span>이번 달 넣은 돈(원)</span>
          <input type="number" inputMode="numeric" min="0" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
          <AmountHint value={amountText} />
        </label>
      )}

      {mode === 'confirm' ? (
        <div className="mt__confirm">
          <p className="mt__muted">증권사 앱 체결 내역을 보고 맞게 고쳐 주세요. 확인을 눌러야 저장됩니다.</p>
          <div className="mt__row">
            <label className="mt__field"><span>산 수량(주)</span><input type="number" inputMode="numeric" min="1" value={qtyText} onChange={(e) => setQtyText(e.target.value)} /></label>
            <label className="mt__field"><span>체결 가격(원)</span><input type="number" inputMode="numeric" min="1" value={priceText} onChange={(e) => setPriceText(e.target.value)} /><AmountHint value={priceText} /></label>
          </div>
          {accounts.length > 0 ? (
            <label className="mt__field"><span>산 계좌</span>
              <select value={chosen?.key ?? ''} onChange={(e) => setAccountKey(e.target.value)}>
                {accounts.map((a) => <option key={a.key} value={a.key}>{[a.broker, a.account].filter(Boolean).join(' · ')}</option>)}
              </select>
            </label>
          ) : (
            <>
              <p className="mt__muted">처음 기록이라 어느 계좌에서 샀는지 알려 주세요. 포트폴리오에 이 이름으로 계좌가 생깁니다.</p>
              <div className="mt__row">
                <label className="mt__field"><span>증권사</span><input type="text" placeholder="예: 키움" value={newBroker} onChange={(e) => setNewBroker(e.target.value)} /></label>
                <label className="mt__field"><span>계좌 이름</span><input type="text" placeholder="예: 일반, ISA" value={newAccount} onChange={(e) => setNewAccount(e.target.value)} /></label>
              </div>
            </>
          )}
          <div className="mt__actions">
            <button type="button" className="mt__primary" disabled={busy} onClick={() => void recordBuy()}>확인하고 저장</button>
            <button type="button" className="mt__secondary" disabled={busy} onClick={() => { setMode('view'); setError(null) }}>취소</button>
          </div>
        </div>
      ) : (
        <div className="mt__actions">
          <button type="button" className="mt__primary" disabled={busy} onClick={openConfirm}>샀어요</button>
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
