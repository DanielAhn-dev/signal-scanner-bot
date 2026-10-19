import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronRight } from 'lucide-react'
import AmountHint from '../../components/ui/AmountHint'
import { apiFetch } from '../../lib/api'
import { formatKrwReadable } from '../../lib/format'
import { EMPTY_STATE, recommendCandidate, recommendOverseas, type AccumulateState } from '../../lib/accumulate'
import { useIndexEtfCandidates } from '../../lib/indexEtfLive'
import { QUERY_KEYS, usePositions } from '../../lib/queries'
import { useUserState } from '../../lib/userState'
import { buyQuantity, groupMonthBuys, kstToday, monthLabel, monthTaskView, splitAmount, type MonthBuy, type MonthTaskLine, type MonthTaskRecord } from '../../lib/monthTask'
import { DEFAULT_PLAN_MIX, MIX_INDEX_LABEL, type MixEntry, type MixIndex } from '../../lib/planMix'
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
 *
 * 내 계획 구성(지수·비중, 모아가기 1번)이 있으면 지수마다 한 줄(계획 × 비중, 상품은 모아가기와 같은 판정) — 화면 지도 4단계.
 * 구성을 안 정했으면 코스피200 한 줄로 지금과 같다. 줄마다 산 계좌는 구성에 기억해 다음 달 먼저 고른다.
 */
type Plan = { monthly: number; depositDay: number; mix: MixEntry[] | null }
type Product = { code: string; name: string }
type Line = { index: MixIndex; weight: number; product: Product; account: MixEntry['account'] }
type Row = { qty: string; price: string; accountKey: string; broker: string; account: string }

const won = formatKrwReadable
const shortDate = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`
const accountKeyOf = (a: { broker: string; account: string } | null) => (a ? `${a.broker}|||${a.account}` : '')
const accountText = (a: { broker: string; account: string }) => [a.broker, a.account].filter(Boolean).join(' · ')

export default function MonthTaskCard() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const chatId = useCurrentChatId()
  const { value: accRaw, set: setAcc } = useUserState<AccumulateState>('accumulate')
  const acc: AccumulateState = { ...EMPTY_STATE, ...(accRaw ?? {}) }
  const etfView = useIndexEtfCandidates()
  const rec = useMemo(() => recommendCandidate(acc.goal, etfView.cands, etfView.asOf), [acc.goal, etfView])
  const kospiProduct = acc.target ?? (rec.pick ? { code: rec.pick.code, name: rec.pick.name } : null)
  const { data: positions } = usePositions()

  const [plan, setPlan] = useState<Plan | null>(null)
  const [prices, setPrices] = useState<Record<string, number | null>>({})
  const [monthBuys, setMonthBuys] = useState<MonthBuy[]>([])
  const [mode, setMode] = useState<'view' | 'amount' | 'confirm'>('view')
  // 이번 달 매수가 있어도 더 살 사람은 할 일 카드로
  const [buyMore, setBuyMore] = useState(false)
  const [amountText, setAmountText] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  // 여러 줄 저장 중 실패하면 이미 저장한 줄은 다시 보내지 않는다 (같은 매수가 두 번 생기지 않게)
  const postedRef = useRef(new Set<number>())

  const [planVersion, setPlanVersion] = useState(0)
  useEffect(() => {
    // 해마다 늘리기(RaiseNudge)·모아가기에서 계획 금액·구성을 바꾸면 다시 읽는다
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
        if (active && p) setPlan({ monthly: Number(p.monthly) || 0, depositDay: Number(p.depositDay) || 1, mix: Array.isArray(p.mix) && p.mix.length ? (p.mix as MixEntry[]) : null })
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

  // 구성 지수마다 한 줄 — 상품은 모아가기와 같은 판정(코스피200: 구성에 고른 상품 > 예전 직접 지정 > 추천, 해외지수: 고른 상품 > 추천)
  const lines: Line[] | null = useMemo(() => {
    const mix = plan?.mix ?? DEFAULT_PLAN_MIX
    const out: Line[] = []
    for (const e of mix) {
      let pick: Product | null
      if (e.index === 'kospi200') pick = e.product ?? kospiProduct
      else if (e.product) pick = e.product
      else {
        const p = recommendOverseas(e.index, etfView.overseas, etfView.asOf).pick
        pick = p ? { code: p.code, name: p.name } : null
      }
      // 상품을 못 정한 줄이 있으면 일부만 안내하지 않는다
      if (!pick) return null
      out.push({ index: e.index, weight: e.weight, product: pick, account: e.account })
    }
    return out
  }, [plan?.mix, kospiProduct?.code, kospiProduct?.name, etfView]) // eslint-disable-line react-hooks/exhaustive-deps
  const codesKey = (lines ?? []).map((l) => l.product.code).join(',')

  useEffect(() => {
    if (!codesKey) return
    let active = true
    for (const code of codesKey.split(',')) {
      apiFetch(`/api/ui/stock-latest?code=${encodeURIComponent(code)}`, { cacheMs: 300_000, retries: 0, timeoutMs: 15_000 })
        .then((res) => {
          const rs: Array<{ date: string; close: number }> = (Array.isArray(res?.data) ? res.data : []).map((r: any) => ({ date: String(r.date || ''), close: Number(r.close) }))
          // 실시간가(장 마감 뒤엔 종가)가 latest에 온다 — 일봉 이력이 없는 ETF는 data의 close가 0이다
          const live = Number(res?.latest?.close)
          const last = rs.filter((r) => r.close > 0).sort((a, b) => a.date.localeCompare(b.date)).pop()
          if (active) setPrices((prev) => ({ ...prev, [code]: live > 0 ? live : last ? last.close : null }))
        })
        .catch(() => { if (active) setPrices((prev) => ({ ...prev, [code]: null })) })
    }
    return () => { active = false }
  }, [codesKey])

  // 실계좌 목록 — 보유 행의 증권사·계좌 이름
  const accounts = useMemo(() => {
    const seen = new Map<string, { broker: string; account: string }>()
    for (const r of (Array.isArray(positions) ? positions : []) as Array<{ broker_name?: string | null; account_name?: string | null }>) {
      const broker = String(r.broker_name ?? '').trim()
      const account = String(r.account_name ?? '').trim()
      if (!broker && !account) continue
      seen.set(accountKeyOf({ broker, account }), { broker, account })
    }
    return [...seen.entries()].map(([key, v]) => ({ key, ...v }))
  }, [positions])

  if (!chatId || !plan || plan.monthly <= 0 || !lines || lines.length === 0) return null

  const single = lines.length === 1
  const amount = Number(amountText) > 0 ? Math.round(Number(amountText)) : plan.monthly
  const lineAmounts = single ? [amount] : splitAmount(amount, lines.map((l) => l.weight))
  const priceOf = (code: string) => prices[code] ?? null
  const lineQty = lines.map((l, i) => buyQuantity(lineAmounts[i], priceOf(l.product.code)))
  const view = monthTaskView({ today: kstToday(), depositDay: plan.depositDay, amount: lineAmounts[0], price: priceOf(lines[0].product.code), tasks: acc.tasks })
  const month = monthLabel(view.ym)
  const groups = groupMonthBuys(monthBuys, lines[0].product.code)
  const nameOf = (code: string) => lines.find((l) => l.product.code === code)?.product.name ?? code
  const leftover = lineQty.reduce((s, q) => s + (q.leftover ?? 0), 0)
  const pricesKnown = lineQty.every((q) => q.qty != null)

  const saveTask = (record: MonthTaskRecord) => {
    const tasks = { ...(acc.tasks ?? {}), [view.ym]: record }
    // 산 달은 '이어서 넣은 달'에도 세도록 그달 넣은 돈을 같이 남긴다
    const deposits = record.status === 'bought' && record.amount
      ? [...acc.deposits.filter(([m]) => m !== view.ym), [view.ym, record.amount] as [string, number]].sort((a, b) => a[0].localeCompare(b[0]))
      : acc.deposits
    setAcc({ ...acc, tasks, deposits })
  }

  /** 기억해 둔 계좌가 있으면 그 계좌, 없으면 첫 계좌 */
  const defaultKey = (l: Line) => {
    const remembered = l.account ? accounts.find((a) => a.key === accountKeyOf(l.account)) : null
    return (remembered ?? accounts[0])?.key ?? ''
  }

  const openConfirm = () => {
    setRows(lines.map((l, i) => {
      const p = priceOf(l.product.code)
      return {
        qty: lineQty[i].qty ? String(lineQty[i].qty) : '',
        price: p ? String(Math.round(p)) : '',
        accountKey: defaultKey(l),
        broker: l.account?.broker ?? '',
        account: l.account?.account ?? '',
      }
    }))
    postedRef.current.clear()
    setError(null)
    setMode('confirm')
  }
  const setRow = (i: number, patch: Partial<Row>) => setRows((prev) => prev.map((r, k) => (k === i ? { ...r, ...patch } : r)))
  const accountOfRow = (r: Row) => {
    const picked = accounts.find((a) => a.key === r.accountKey)
    return picked ? { broker: picked.broker, account: picked.account } : { broker: r.broker.trim(), account: r.account.trim() }
  }

  /** 줄마다 고른 계좌를 구성에 기억한다 — 구성을 정한 계정만. 실패해도 산 기록에는 영향이 없다(다음 달에 다시 고르면 된다) */
  const rememberAccounts = async (picked: Array<{ index: MixIndex; account: { broker: string; account: string } }>) => {
    const current = plan.mix
    if (!current) return
    const next = current.map((e) => {
      const p = picked.find((x) => x.index === e.index)
      return p ? { ...e, account: p.account } : e
    })
    if (next.every((e, i) => accountKeyOf(e.account) === accountKeyOf(current[i].account))) return
    try {
      const res = await apiFetch('/api/ui/investment-prefs', { method: 'POST', cacheMs: 0, timeoutMs: 15_000, body: JSON.stringify({ plan: { mix: next } }) })
      if (!res?.error) setPlan({ ...plan, mix: next })
    } catch { /* 기억은 부가 기능 */ }
  }

  const recordBuy = async () => {
    if (busyRef.current) return
    const parsed = rows.map((r, i) => ({ i, qty: Math.round(Number(r.qty) || 0), price: Number(r.price), account: accountOfRow(r) }))
    const buying = parsed.filter((p) => p.qty > 0)
    const bad = single ? !(parsed[0].qty > 0 && parsed[0].price > 0) : buying.length === 0 || buying.some((p) => !(p.price > 0))
    if (bad) { setError(single ? '산 수량과 체결 가격을 확인해 주세요' : '산 줄의 수량과 체결 가격을 확인해 주세요 (안 산 줄은 0주)'); return }
    if (buying.some((p) => !p.account.account)) { setError('어느 계좌에서 샀는지 계좌 이름을 적어 주세요'); return }
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      for (const b of buying) {
        if (postedRef.current.has(b.i)) continue
        const l = lines[b.i]
        const res = await apiFetch('/api/ui/virtual-trade', {
          method: 'POST', cacheMs: 0, timeoutMs: 15_000,
          body: JSON.stringify({ code: l.product.code, side: 'BUY', quantity: b.qty, price: b.price, broker_name: b.account.broker || null, account_name: b.account.account, memo: `month-task:${view.ym}` }),
        })
        if (res?.error) throw new Error(String(res.error))
        postedRef.current.add(b.i)
      }
      // 모든 줄이 저장된 뒤에만 완료로 바꾼다
      // 안 산 줄(0주)도 남긴다 — 따라 사기 표가 지수마다 지킴/건너뜀을 보여 준다
      const recLines: MonthTaskLine[] = parsed.map((b) => ({ index: lines[b.i].index, code: lines[b.i].product.code, name: lines[b.i].product.name, qty: b.qty, price: b.qty > 0 ? b.price : priceOf(lines[b.i].product.code) ?? 0, planAmount: lineAmounts[b.i] }))
      const head = recLines.find((l) => l.qty > 0)!
      saveTask({ status: 'bought', ...(single ? {} : { lines: recLines }), code: head.code, name: head.name, qty: head.qty, price: head.price, amount, at: new Date().toISOString() })
      postedRef.current.clear()
      setMode('view')
      void queryClient.invalidateQueries({ queryKey: QUERY_KEYS.positions(chatId) })
      loadMonthBuys(0)
      void rememberAccounts(buying.map((b) => ({ index: lines[b.i].index, account: b.account })))
    } catch (e) {
      const saved = postedRef.current.size
      setError(`기록하지 못했습니다: ${e instanceof Error ? e.message : String(e)}${saved > 0 ? ` — 앞의 ${saved}줄은 저장됐어요. 다시 누르면 나머지만 저장합니다.` : ''}`)
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
    const boughtText = r?.lines && r.lines.length > 1 ? r.lines.filter((x) => x.qty > 0).map((x) => `${x.name} ${x.qty}주`).join(', ') : r ? `${r.name ?? lines[0].product.name} ${r.qty}주` : ''
    const upcomingText = lines.map((l, i) => `${l.product.name}${lineQty[i].qty != null ? ` 약 ${lineQty[i].qty}주` : ''}`).join(' · ')
    return (
      <section className="mt mt--line" aria-label="이번 달 할 일">
        <AccountTag kind="real" />
        {view.phase === 'upcoming' && <span>다음 할 일 {Number(view.dueDate.slice(5, 7))}/{Number(view.dueDate.slice(8))} · {upcomingText}</span>}
        {view.phase === 'bought' && r && <span>{month} 완료 · {boughtText}</span>}
        {view.phase === 'skipped' && <span>{month}은 건너뛰었어요 <button type="button" className="mt__link" onClick={undo}>다시 하기</button></span>}
        {view.phase === 'later' && <span>내 계좌는 다음 달부터 시작해요 <button type="button" className="mt__link" onClick={undo}>이번 달에 하기</button></span>}
      </section>
    )
  }

  // 포트폴리오에 이번 달 매수가 이미 있으면 — 새로 기록하지 않고 그걸로 답한다
  if (groups.length > 0 && !buyMore) {
    const g = groups[0]
    const doneLines: MonthTaskLine[] = groups.map((x) => ({ code: x.code, name: nameOf(x.code), qty: x.qty, price: Math.round(x.avgPrice) }))
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
          <button type="button" className="mt__primary" onClick={() => saveTask({ status: 'bought', ...(doneLines.length > 1 ? { lines: doneLines } : {}), code: g.code, name: nameOf(g.code), qty: g.qty, price: Math.round(g.avgPrice), amount: Math.round(groups.reduce((s, x) => s + x.amount, 0)), at: new Date().toISOString() })}>이걸로 완료</button>
          <button type="button" className="mt__secondary" onClick={() => setBuyMore(true)}>이번 달에 더 살 거예요</button>
        </div>
        <p className="mt__muted">이미 적은 매수를 그대로 씁니다. 같은 매수를 다시 기록하지 않아요.</p>
      </section>
    )
  }

  const label = (i: number, text: string) => (single ? text : `${MIX_INDEX_LABEL[lines[i].index]} ${text}`)

  return (
    <section className="mt" aria-label="이번 달 할 일">
      <div className="mt__head">
        <AccountTag kind="real" />
        <strong>{month} 할 일</strong>
      </div>
      {single ? (
        <p className="mt__main">
          <strong>{lines[0].product.name} {lineQty[0].qty != null ? `${lineQty[0].qty}주` : ''}</strong> 사기
          {priceOf(lines[0].product.code) ? <span className="mt__muted"> · 주당 약 {won(priceOf(lines[0].product.code)!)}</span> : <span className="mt__muted"> · 가격을 불러오는 중</span>}
        </p>
      ) : (
        <ul className="mt__lines">
          {lines.map((l, i) => (
            <li key={l.index}>
              <strong>{l.product.name} {lineQty[i].qty != null ? `${lineQty[i].qty}주` : ''}</strong>
              <span className="mt__muted"> · {MIX_INDEX_LABEL[l.index]} {Math.round(l.weight * 100)}% · {won(lineAmounts[i])}{l.account ? ` · ${accountText(l.account)}에서` : ''}{priceOf(l.product.code) ? '' : ' · 가격을 불러오는 중'}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt__muted">
        내 계좌에 {won(amount)}을 넣었다고 보고 계산했어요{pricesKnown && leftover > 0 ? ` · 남는 ${won(leftover)}은 예수금으로 둡니다` : ''}.{' '}
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
          <p className="mt__muted">증권사 앱 체결 내역을 보고 맞게 고쳐 주세요.{single ? '' : ' 안 산 줄은 0주로 두면 됩니다.'} 확인을 눌러야 저장됩니다.</p>
          {rows.map((r, i) => (
            <div key={lines[i].index} className={single ? undefined : 'mt__line-confirm'}>
              {!single && <p className="mt__line-title"><strong>{lines[i].product.name}</strong>{postedRef.current.has(i) ? <span className="mt__muted"> · 저장됨</span> : null}</p>}
              <div className="mt__row">
                <label className="mt__field"><span>{label(i, '산 수량(주)')}</span><input type="number" inputMode="numeric" min={single ? 1 : 0} value={r.qty} onChange={(e) => setRow(i, { qty: e.target.value })} /></label>
                <label className="mt__field"><span>{label(i, '체결 가격(원)')}</span><input type="number" inputMode="numeric" min="1" value={r.price} onChange={(e) => setRow(i, { price: e.target.value })} /><AmountHint value={r.price} /></label>
              </div>
              {accounts.length > 0 ? (
                <label className="mt__field"><span>{label(i, '산 계좌')}</span>
                  <select value={r.accountKey} onChange={(e) => setRow(i, { accountKey: e.target.value })}>
                    {accounts.map((a) => <option key={a.key} value={a.key}>{accountText(a)}</option>)}
                  </select>
                </label>
              ) : (
                <>
                  {i === 0 && <p className="mt__muted">처음 기록이라 어느 계좌에서 샀는지 알려 주세요. 포트폴리오에 이 이름으로 계좌가 생깁니다.</p>}
                  <div className="mt__row">
                    <label className="mt__field"><span>{label(i, '증권사')}</span><input type="text" placeholder="예: 키움" value={r.broker} onChange={(e) => setRow(i, { broker: e.target.value })} /></label>
                    <label className="mt__field"><span>{label(i, '계좌 이름')}</span><input type="text" placeholder={lines[i].index === 'kospi200' ? '예: 일반' : '예: ISA, 연금저축'} value={r.account} onChange={(e) => setRow(i, { account: e.target.value })} /></label>
                  </div>
                </>
              )}
            </div>
          ))}
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
        <AccountTag kind="virtual" /> 가상 계좌는 계획대로 자동으로 삽니다{single ? '' : '(아직 코스피200만)'}. 할 일은 없어요.
        <button type="button" className="mt__link" onClick={() => navigate('/follow')}>계획 vs 실제 보기 <ChevronRight size={12} aria-hidden /></button>
      </p>
    </section>
  )
}
