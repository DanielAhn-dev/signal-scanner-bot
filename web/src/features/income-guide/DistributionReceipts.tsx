import React, { useEffect, useMemo, useRef, useState } from 'react'
import More from '../../components/ui/More'
import { formatKrwMan } from '../../lib/format'
import Button from '../../components/ui/Button'
import StockSearchInput from '../../components/StockSearchInput'
import IncomeBars, { incomeBarSeries } from './IncomeBars'

/** 서버 src/lib/distributionReceipts.ts (handlers/ui/income-guide.ts의 distributionReceipts) */
export type Receipt = { id: string; month: string; code: string; name: string; quantity: number; perShare: number; net: number | null; createdAt: string; accountKey?: string; accountLabel?: string }
/** 같은 달 안에서 한 기록의 자리 — 같은 종목을 계좌마다 따로 적으면 계좌까지 본다 */
const slotOf = (r: Pick<Receipt, 'code' | 'accountKey'>) => `${r.code}|${r.accountKey ?? ''}`
type MonthSum = { month: string; items: Receipt[]; gross: number; net: number; estimatedCount: number }
type ProjectionRow = {
  code: string
  name: string
  quantity: number
  net: number
  source: 'receipt' | 'estimate'
  perShare: number | null
  netRatio: number | null
  intervalMonths: number | null
  addedShares: number
}
export type DistributionReceiptsData = {
  thisMonth: MonthSum
  lastMonth: MonthSum
  projection: { total: number; fromReceipts: number; fromEstimate: number; receiptCodes: number; rows: ProjectionRow[] }
  recent: Receipt[]
  /** 받은 분배금 중 매수에 쓰인 몫 — 서버 estimateReinvest(예수금 변화로 거꾸로 추정) */
  reinvest?: ReinvestEstimate | null
}
type ReinvestEstimate =
  | {
      status: 'ok'
      month: string
      received: number
      deposit: number
      depositUnknown: boolean
      baselineDate: string
      cashThen: number
      cashNow: number
      bought: number
      reinvested: number
      kept: number
      baselineApprox: boolean
    }
  | { status: 'stale-cash'; month: string; received: number; cashUpdatedAt: string | null }
  | { status: 'no-baseline'; month: string; received: number }

type Props = {
  data: DistributionReceiptsData
  /** 분배금이 나오는 보유 종목(같은 종목 여러 계좌면 수량 합, 계좌별 수량은 accounts) */
  holdings: Array<{ code: string; name: string; quantity: number; accounts?: Array<{ key: string; label: string; quantity: number }> }>
  buyName: string | null
  /** 서버에 보내고 성공하면 null, 실패하면 이유 */
  /** 실패면 이유 문자열, 성공이면 null 또는 덧붙일 안내({ note }) */
  submit: (body: Record<string, unknown>) => Promise<string | null | { note: string }>
  /** 목표 월 인컴(세후, settings.monthlyNeed) — 막대 그래프의 목표선 */
  monthlyGoal?: number | null
}

const man = formatKrwMan
const won = (v: number) => `${Math.round(v).toLocaleString('ko-KR')}원`
/** 1만원 아래는 '0만원'으로 뭉개지지 않게 원 단위(100원 반올림) */
const smallWon = (v: number) => (Math.abs(v) < 10_000 ? `${(Math.round(v / 100) * 100).toLocaleString('ko-KR')}원` : man(v))
const card: React.CSSProperties = {
  margin: '8px 12px',
  width: 'auto', // 시트 모바일 규칙(.xls-content-inner > * 폭 100%)과 좌우 마진이 겹쳐 24px 넘치던 것
  padding: 14,
  border: '1px solid var(--color-border-default)',
  borderRadius: 8,
  fontSize: 13,
  lineHeight: 1.65,
  background: 'var(--color-bg-elevated, transparent)',
  wordBreak: 'keep-all',
}
const muted: React.CSSProperties = { color: 'var(--color-text-secondary)' }
const faint: React.CSSProperties = { color: 'var(--color-text-tertiary)', fontSize: 12 }
/** 이번 달부터 거슬러 n달 — 달력 입력 대신 고른다(작은 달력 아이콘·iOS 높이 문제 없이) */
const recentMonths = (n: number) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() - i)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  })
/** 세후를 안 적은 기록은 15.4%를 떼고 본다(서버 monthSummary와 같은 가정) */
const netOf = (r: Receipt) => r.net ?? Math.round(r.quantity * r.perShare * 0.846)
const prevMonthKey = (m: string) => {
  const [y, mo] = m.split('-').map(Number)
  return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, '0')}`
}
/** 달별 묶음 — 최근 달이 먼저, 달 안은 세후 큰 순. 바로 앞 달 기록이 있을 때만 증감을 낸다 */
function groupByMonth(list: Receipt[]) {
  const by = new Map<string, Receipt[]>()
  for (const r of list) by.set(r.month, [...(by.get(r.month) ?? []), r])
  const sum = (rs: Receipt[]) => rs.reduce((s, r) => s + netOf(r), 0)
  return [...by.keys()].sort().reverse().map((month) => {
    const items = [...(by.get(month) ?? [])].sort((a, b) => netOf(b) - netOf(a))
    const prevItems = by.get(prevMonthKey(month))
    const prevByCode = prevItems ? new Map(prevItems.map((r) => [slotOf(r), netOf(r)])) : null
    const same = prevByCode ? items.filter((r) => prevByCode.has(slotOf(r))) : []
    return {
      month,
      items,
      total: sum(items),
      estimated: items.some((r) => r.net == null),
      prevTotal: prevItems ? sum(prevItems) : null,
      prevByCode,
      sameDelta: prevByCode && same.length > 0 ? same.reduce((s, r) => s + netOf(r) - (prevByCode.get(slotOf(r)) ?? 0), 0) : null,
    }
  })
}
/** 증감 — 늘면 빨강·줄면 파랑(국내 시세 색과 같게) */
function DeltaWon({ v }: { v: number }) {
  if (Math.round(v) === 0) return <span style={{ color: 'var(--color-text-tertiary)' }}>그대로</span>
  return (
    <span style={{ color: v > 0 ? 'var(--color-stock-up)' : 'var(--color-stock-down)', fontVariantNumeric: 'tabular-nums' }}>
      {v > 0 ? '+' : '−'}
      {Math.abs(Math.round(v)).toLocaleString('ko-KR')}원
    </span>
  )
}

const shortDate = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`
/** 재투자 한 줄 — 어느 돈으로 샀는지 적지 않아도 예수금 변화로 매수에 쓰인 몫을 보여 준다. 판단 문구 없이 나눠만 보인다 */
function ReinvestLine({ r }: { r: ReinvestEstimate | null }) {
  if (!r) return null
  if (r.status === 'no-baseline') return <div style={faint}>재투자 몫은 지난달 점검 기록이 생긴 다음 달부터 계산합니다.</div>
  if (r.status === 'stale-cash')
    return <div style={faint}>분배금을 적은 뒤 예수금을 아직 고치지 않았습니다. &lsquo;증권 계좌 예수금&rsquo; 칸에 지금 숫자를 반영하면 매수에 쓰인 몫을 계산합니다.</div>
  const change = r.cashNow - r.cashThen
  return (
    <div style={{ marginTop: 2 }}>
      분배금 중 매수에 쓰임 <strong>약 {smallWon(r.reinvested)}</strong>
      <span style={muted}> · 현금으로 남음 약 {smallWon(r.kept)}</span>
      <div style={faint}>
        {shortDate(r.baselineDate)} 기록 뒤 들어온 돈(분배금 {smallWon(r.received)}
        {r.deposit > 0 ? ` + 이번 달 넣은 돈 ${smallWon(r.deposit)}` : ''}) 중 예수금 변화({change === 0 ? '그대로' : `${change > 0 ? '+' : '−'}${smallWon(Math.abs(change))}`})를 뺀
        {' '}{smallWon(r.bought)}을 매수로 보고{r.deposit > 0 ? ', 분배금 몫은 들어온 비율대로 나눈' : ''} 추정입니다
        {r.baselineApprox ? '(그때 예수금은 현금 비중으로 되짚은 값)' : ''}.
        {r.depositUnknown
          ? ' 이번 달 넣은 돈을 불러오지 못해 0원으로 계산했습니다.'
          : r.deposit > 0
            ? ''
            : " 이번 달 따로 입금한 돈이 있으면 모아가기의 '이번 달 넣었어요'에 그 금액만 적어 주세요. 안 적으면 그 입금이 현금으로 남은 것으로 보입니다."}
      </div>
    </div>
  )
}

/** 종목 선택의 '직접 찾기' 값 — 6자리 종목 코드와 겹치지 않는다 */
const MANUAL = '__manual'
const monthLabel =(m: string, i: number) => `${Number(m.slice(5))}월${i === 0 ? ' (이번 달)' : i === 1 ? ' (지난달)' : ''}`

/**
 * 받은 분배금 — 종목·받은 수량·주당 분배금(·세후 입금액)을 적으면 이번 달 실제 합계와
 * '최근 주당 × 지금 수량 × 실제 세후 비율'로 다음 달 예상을 보여 준다. 월 인컴(위 요약)도 이 예상을 쓴다.
 */
export default function DistributionReceipts({ data, holdings, buyName, submit, monthlyGoal }: Props) {
  const busy = useRef(false)
  const cardRef = useRef<HTMLDivElement>(null)
  // 이번 달 투자금의 '받은 분배금 더 적기' 링크(#receipts)로 오면 이 카드로 내려 준다
  useEffect(() => {
    if (window.location.hash === '#receipts') cardRef.current?.scrollIntoView({ block: 'start' })
  }, [])
  const [pending, setPending] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const months = useMemo(() => recentMonths(3), [])
  const [form, setForm] = useState({ month: months[0], code: '', accountKey: '', quantity: '', perShare: '', net: '' })
  const holdingOf = useMemo(() => new Map(holdings.map((h) => [h.code, h])), [holdings])
  // 고를 수 있는 종목 = 지금 보유 + 팔았지만 예전에 받은 기록이 있는 종목 + 직접 찾은 종목
  const [manualMode, setManualMode] = useState(false)
  const [manualText, setManualText] = useState('')
  const [manualPick, setManualPick] = useState<{ code: string; name: string } | null>(null)
  const candidates = useMemo(() => {
    const list: Array<{ code: string; name: string; quantity: number }> = [...holdings]
    const seen = new Set(list.map((h) => h.code))
    // 고를 수 있는 달(최근 3개월)에 받은 종목만 — 오래전에 판 종목까지 늘어놓지 않는다
    for (const r of data.recent) {
      if (seen.has(r.code) || r.month < months[months.length - 1]) continue
      seen.add(r.code)
      list.push({ code: r.code, name: r.name, quantity: 0 })
    }
    return list
  }, [holdings, data.recent, months])
  const monthGroups = useMemo(() => groupByMonth(data.recent), [data.recent])
  const nameOf = (code: string) => candidates.find((c) => c.code === code)?.name ?? (manualPick?.code === code ? manualPick.name : null)
  const { thisMonth, projection } = data
  const delta = projection.total - thisMonth.net
  // 이번 달에 안 적은 종목을 셋으로 나눈다 — 분기 지급 종목은 지급 달이 아니면 '안 적음'이 아니다(예전엔 다 셌다).
  // 기록이 없는 종목(분배율 추정)은 지급 달을 몰라 따로 보인다. 분배금이 0인 종목은 projection.rows에 애초에 없다.
  const unlogged = useMemo(() => {
    const idx = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1
    const lastMonthOf = new Map<string, string>()
    for (const r of data.recent) if (r.month < thisMonth.month && (lastMonthOf.get(r.code) ?? '') < r.month) lastMonthOf.set(r.code, r.month)
    const due: string[] = []
    const notDue: string[] = []
    const unknown: string[] = []
    for (const p of projection.rows) {
      if (!holdingOf.has(p.code) || thisMonth.items.some((r) => r.code === p.code)) continue
      if (p.source === 'estimate') { unknown.push(p.name); continue }
      const last = lastMonthOf.get(p.code)
      const interval = p.intervalMonths ?? 1
      if (last && interval > 1 && (idx(thisMonth.month) - idx(last)) % interval !== 0) notDue.push(p.name)
      else due.push(p.name)
    }
    return { due, notDue, unknown }
  }, [projection.rows, thisMonth, data.recent, holdingOf])
  const notYet = unlogged.due.length + unlogged.unknown.length
  const added = projection.rows.filter((r) => r.source === 'receipt' && r.addedShares > 0 && r.perShare)
  // 늘어난 수량 × 최근 주당 분배금 × 세후 비율 ÷ 지급 간격 = 월 평균으로 늘어난 몫(projection.rows의 net과 같은 식)
  const addedNetOf = (r: ProjectionRow) => (r.perShare ?? 0) * r.addedShares * (r.netRatio ?? 0.846) / (r.intervalMonths ?? 1)
  const addedNet = added.reduce((sum, r) => sum + addedNetOf(r), 0)
  // 고른 달에 이미 적은 종목은 맨 아래로 — 남은 종목을 빨리 고르고, 고칠 때만 아래에서 고른다
  const monthItems = useMemo(
    () =>
      form.month === data.thisMonth.month ? data.thisMonth.items
      : form.month === data.lastMonth.month ? data.lastMonth.items
      : data.recent.filter((r) => r.month === form.month),
    [form.month, data],
  )
  // 여러 계좌에 있는 종목은 계좌를 다 적어야 '이미 적음'
  const doneCodes = useMemo(() => {
    const out = new Set<string>()
    for (const c of candidates) {
      const recs = monthItems.filter((r) => r.code === c.code)
      if (!recs.length) continue
      const accounts = holdingOf.get(c.code)?.accounts ?? []
      const covered = recs.some((r) => !r.accountKey) || accounts.every((a) => recs.some((r) => r.accountKey === a.key))
      if (accounts.length <= 1 || covered) out.add(c.code)
    }
    return out
  }, [candidates, monthItems, holdingOf])
  const todo = candidates.filter((h) => !doneCodes.has(h.code))
  const done = candidates.filter((h) => doneCodes.has(h.code))

  const pick = (code: string) => {
    if (code === MANUAL) {
      setManualMode(true)
      setManualPick(null)
      setManualText('')
      setForm((f) => ({ ...f, code: '', accountKey: '', quantity: '' }))
      return
    }
    setManualMode(false)
    // 지금 없는 종목(팔았음)은 받은 수량을 직접 적는다. 여러 계좌에 있으면 계좌부터 고르게(아직 안 적은 계좌가 하나면 그 계좌)
    const h = holdingOf.get(code)
    const accounts = h?.accounts ?? []
    if (accounts.length > 1) {
      const left = accounts.filter((a) => !monthItems.some((r) => r.code === code && r.accountKey === a.key))
      const only = left.length === 1 ? left[0] : null
      setForm((f) => ({ ...f, code, accountKey: only?.key ?? '', quantity: only ? String(only.quantity) : '' }))
      return
    }
    setForm((f) => ({ ...f, code, accountKey: accounts[0]?.key ?? '', quantity: h ? String(h.quantity) : '' }))
  }
  const pickedAccounts = form.code ? holdingOf.get(form.code)?.accounts ?? [] : []
  const pickAccount = (key: string) => {
    const a = pickedAccounts.find((x) => x.key === key)
    setForm((f) => ({ ...f, accountKey: key, quantity: a ? String(a.quantity) : f.quantity }))
  }
  const run = async (body: Record<string, unknown>, done: string) => {
    if (busy.current) return false
    busy.current = true
    setPending(true)
    setMsg(null)
    try {
      const out = await submit(body)
      if (typeof out === 'string') {
        setMsg(out)
        return false
      }
      setMsg(out ? `${done} ${out.note}` : done)
      return true
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  const add = async () => {
    const name = form.code ? nameOf(form.code) : null
    if (!name) return setMsg(manualMode ? '종목을 검색해서 골라 주세요.' : '종목을 골라 주세요.')
    if (pickedAccounts.length > 1 && !form.accountKey) return setMsg('이 종목은 여러 계좌에 있습니다. 들어온 계좌를 골라 주세요.')
    const account = pickedAccounts.find((a) => a.key === form.accountKey) ?? null
    const ok = await run(
      {
        action: 'receipt-add',
        receipt: {
          month: form.month, code: form.code, name, quantity: form.quantity, perShare: form.perShare, net: form.net,
          ...(account ? { accountKey: account.key, accountLabel: account.label } : {}),
        },
      },
      `${name}${account && pickedAccounts.length > 1 ? `(${account.label})` : ''} 분배금을 적었습니다.`,
    )
    if (ok) {
      setForm((f) => ({ ...f, code: '', accountKey: '', quantity: '', perShare: '', net: '' }))
      setManualMode(false)
      setManualPick(null)
      setManualText('')
    }
  }

  return (
    <div id="receipts" ref={cardRef} style={card}>
      <strong style={{ fontSize: 15, display: 'block', marginBottom: 4 }}>받은 분배금</strong>
      <div>
        {thisMonth.month.slice(5).replace(/^0/, '')}월 받은 금액(세후) <strong>{won(thisMonth.net)}</strong>
        {thisMonth.items.length > 0 && <span style={muted}> · {thisMonth.items.length}종목{unlogged.due.length > 0 ? ` · 아직 안 적은 종목 ${unlogged.due.length}개` : ''}</span>}
        {thisMonth.estimatedCount > 0 && <span style={faint}> (세후를 안 적은 {thisMonth.estimatedCount}건은 15.4%를 떼고 계산)</span>}
      </div>
      {thisMonth.items.length > 0 && (unlogged.due.length > 0 || unlogged.unknown.length > 0 || unlogged.notDue.length > 0) && (
        <div style={faint}>
          {unlogged.due.length > 0 && <div>└ 지난 기록으로 이번 달 지급 차례: {unlogged.due.join(', ')}</div>}
          {/* 실계좌 종목이 많으면 이름 40여 개가 한 문단으로 쏟아졌다 — 앞 5개만, 나머지는 개수 */}
          {unlogged.unknown.length > 0 && <div>└ 받은 기록이 없어 지급 달을 모름(분배율로 추정만): {unlogged.unknown.slice(0, 5).join(', ')}{unlogged.unknown.length > 5 ? ` 외 ${unlogged.unknown.length - 5}종목` : ''}</div>}
          {unlogged.notDue.length > 0 && <div>└ 이번 달은 지급 달이 아님(분기 등): {unlogged.notDue.join(', ')}</div>}
        </div>
      )}
      <ReinvestLine r={data.reinvest ?? null} />
      {/* 세전(수량×주당)과 나란히 — 세후 칸에 세전을 넣었는지 비율로 바로 보인다(고배당 약 85%, 국내 커버드콜은 더 높을 수 있음) */}
      {thisMonth.gross > 0 && thisMonth.items.length > 0 && thisMonth.estimatedCount === 0 && (
        <div style={faint}>
          세전(수량 × 주당) {won(thisMonth.gross)} · 세후 비율 {Math.round((thisMonth.net / thisMonth.gross) * 1000) / 10}%
          {thisMonth.net >= thisMonth.gross ? ' — 세금이 0원으로 계산됩니다. 국내 커버드콜이 아니면 세후 칸에 세전 금액을 넣었는지 확인하세요.' : ''}
        </div>
      )}
      <div style={{ marginTop: 4 }}>
        다음 달 예상(세후) <strong>약 {man(projection.total)}</strong>
        {/* 안 적은 종목이 있으면 이번 달 합계엔 빠지고 예상엔 추정으로 들어가 차이가 부풀려진다 — 그땐 비교하지 않는다 */}
        {thisMonth.items.length > 0 && notYet === 0 && (
          <span style={{ ...muted, marginLeft: 4 }}>· 이번 달보다 {Math.abs(delta) < 5_000 ? '거의 그대로' : `${delta > 0 ? '+' : '−'}${man(Math.abs(delta))}`}</span>
        )}
        {notYet > 0 && projection.fromEstimate > 0 && (
          <span style={{ ...muted, marginLeft: 4 }}>· 이번 달에 안 적은 종목 추정 {man(projection.fromEstimate)} 포함이라 이번 달 합계와 바로 비교할 수 없습니다</span>
        )}
      </div>
      {added.length > 0 && (
        <div style={{ marginTop: 4 }} aria-label="추가 매수로 늘어난 분배금">
          추가 매수로 늘어난 월 분배금 <strong>+{smallWon(addedNet)}</strong>
          <span style={{ ...muted, marginLeft: 4 }}>· 예전 기준 {man(Math.max(0, projection.total - addedNet))} → 지금 {man(projection.total)}</span>
          <div style={faint}>예전 기준 = 종목마다 마지막으로 분배금을 적었을 때의 수량으로 계산한 월 평균(지급 간격으로 나눈 값)입니다.</div>
          <More label={`종목별로 보기 (${added.length}종목)`}>
            {added.map((r) => (
              <div key={r.code} style={faint}>
                └ {r.name} {r.addedShares.toLocaleString('ko-KR')}주 늘어남 → 월 약 +{smallWon(addedNetOf(r))}
              </div>
            ))}
          </More>
        </div>
      )}
      <div style={faint}>
        받은 기록과 최근 분배율로 낸 예상치입니다{projection.receiptCodes > 0 ? ` (기록 ${projection.receiptCodes}종목 ${man(projection.fromReceipts)} + 추정 ${man(projection.fromEstimate)})` : ''}.
        <More label="어떻게 추정하나">받은 기록이 있는 종목은 &lsquo;가장 최근 주당 분배금 × 지금 수량 × 그 종목의 실제 세후 비율&rsquo;로, 기록이 없는 종목은 최근 12개월 분배율로 추정합니다. 달마다 주당 분배금이 바뀌니 예상치입니다. 위 요약의 월 인컴도 이 값을 씁니다.</More>
      </div>
      <IncomeBars bars={incomeBarSeries(monthGroups, thisMonth.month, projection.total)} goal={monthlyGoal ?? null} />

      {/* 적기 — 공통 입력 스타일(ui-field·ui-text), 모바일 2열·넓으면 한 줄 */}
      <div className="ig-receipt-form">
        <label className="ui-field ig-receipt-month">
          <span className="ui-label">입금된 달</span>
          <select value={form.month} onChange={(e) => setForm((f) => ({ ...f, month: e.target.value }))}>
            {months.map((m, i) => (
              <option key={m} value={m}>{monthLabel(m, i)}</option>
            ))}
          </select>
        </label>
        <label className="ui-field ig-receipt-code">
          <span className="ui-label">종목</span>
          <select value={manualMode ? MANUAL : form.code} onChange={(e) => pick(e.target.value)}>
            <option value="">{todo.length > 0 ? `골라 주세요 (남은 ${todo.length}종목)` : '모두 적었습니다'}</option>
            {todo.map((h) => (
              <option key={h.code} value={h.code}>{h.name}{h.quantity > 0 ? '' : ' (지금 없음)'}</option>
            ))}
            <option value={MANUAL}>직접 찾기 (팔아서 지금 없는 종목)</option>
            {done.length > 0 && (
              <optgroup label={`이미 적음 ${done.length}종목 (다시 적으면 고침)`}>
                {done.map((h) => (
                  <option key={h.code} value={h.code}>{h.name}{h.quantity > 0 ? '' : ' (지금 없음)'}</option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
        {pickedAccounts.length > 1 && (
          <label className="ui-field ig-receipt-code">
            <span className="ui-label">들어온 계좌</span>
            <select value={form.accountKey} onChange={(e) => pickAccount(e.target.value)}>
              <option value="">계좌를 골라 주세요</option>
              {pickedAccounts.map((a) => {
                const already = monthItems.some((r) => r.code === form.code && r.accountKey === a.key)
                return (
                  <option key={a.key} value={a.key}>
                    {a.label} · {a.quantity.toLocaleString('ko-KR')}주{already ? ' (이미 적음 — 다시 적으면 고침)' : ''}
                  </option>
                )
              })}
            </select>
          </label>
        )}
        {manualMode && (
          <div className="ui-field ig-receipt-manual">
            <span className="ui-label">종목 찾기</span>
            {manualPick ? (
              <div className="ig-receipt-picked">
                <strong>{manualPick.name}</strong> <span style={faint}>({manualPick.code})</span>
                <Button size="sm" variant="ghost" onClick={() => { setManualPick(null); setForm((f) => ({ ...f, code: '' })) }}>
                  다시 찾기
                </Button>
              </div>
            ) : (
              <StockSearchInput
                value={manualText}
                onChange={setManualText}
                onSelect={(s) => {
                  setManualPick({ code: s.code, name: s.name })
                  setManualText('')
                  setForm((f) => ({ ...f, code: s.code, quantity: '' }))
                }}
                placeholder="ETF 이름이나 코드"
              />
            )}
          </div>
        )}
        <label className="ui-field">
          <span className="ui-label">받은 수량(주)</span>
          <input className="ui-text" inputMode="numeric" autoComplete="off" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} placeholder="주" />
        </label>
        <label className="ui-field">
          <span className="ui-label">주당 분배금(원)</span>
          <input className="ui-text" inputMode="decimal" autoComplete="off" value={form.perShare} onChange={(e) => setForm((f) => ({ ...f, perShare: e.target.value }))} placeholder="원" />
        </label>
        <label className="ui-field">
          <span className="ui-label">세후 입금액(선택)</span>
          <input className="ui-text" inputMode="numeric" autoComplete="off" value={form.net} onChange={(e) => setForm((f) => ({ ...f, net: e.target.value }))} placeholder="원" />
        </label>
        <div className="ig-receipt-submit">
          <Button size="sm" variant="primary" onClick={() => void add()} disabled={pending}>
            {pending ? '저장 중…' : '적기'}
          </Button>
        </div>
      </div>
      <div style={{ ...faint, marginTop: 10 }}>
        받은 수량은 지금 보유 수량이 기본값입니다. 기준일 뒤에 산 수량은 빼고 적어 주세요.
        <More label="세후 입금액·다시 적기">세후 입금액을 적으면 그 종목의 실제 세금(커버드콜은 15.4%보다 적게 떼는 경우가 있습니다)으로 다음 달을 계산합니다.
        같은 달·같은 종목(여러 계좌에 있으면 같은 계좌)을 다시 적으면 고친 것으로 저장합니다.</More>
      </div>
      {msg && <div style={{ ...muted, marginTop: 8 }}>{msg}</div>}

      {/* 기록 — 달별 묶음(최근 달만 펼침), 머리줄에 지난달 대비 증감 */}
      {monthGroups.length > 0 && (
        <div className="ig-receipt-months">
          {monthGroups.map((g, i) => (
            <details key={g.month} className="ig-receipt-mgroup" open={i === 0}>
              <summary className="ig-receipt-mgroup__head">
                <span className="ig-receipt-mgroup__title">{Number(g.month.slice(5))}월</span>
                <span className="ig-receipt-mgroup__total">
                  세후 {won(g.total)}
                  {g.estimated && <span style={faint}> (추정 포함)</span>}
                </span>
                <span style={faint}>{g.items.length}종목</span>
                {g.prevTotal != null && (
                  <span className="ig-receipt-mgroup__delta">
                    지난달보다 <DeltaWon v={g.total - g.prevTotal} />
                    {g.sameDelta != null && <span style={faint}> · 같은 종목끼리 <DeltaWon v={g.sameDelta} /></span>}
                  </span>
                )}
              </summary>
              <ul className="ig-receipt-rows">
                {g.items.map((r) => {
                  const prev = g.prevByCode?.get(slotOf(r))
                  return (
                    <li key={r.id} className={`ig-receipt-row${g.prevByCode == null ? ' ig-receipt-row--single' : ''}`}>
                      <span className="ig-receipt-row__name">
                        {r.name}
                        {r.accountLabel && <span style={faint}> · {r.accountLabel}</span>}
                      </span>
                      <span className="ig-receipt-row__net">
                        {r.net != null ? won(r.net) : <span style={faint}>{won(netOf(r))} 추정</span>}
                      </span>
                      <span className="ig-receipt-row__del">
                        <button
                          type="button"
                          className="ig-receipt-row__del-btn"
                          disabled={pending}
                          onClick={() => void run({ action: 'receipt-delete', id: r.id }, `${r.name} ${Number(r.month.slice(5))}월 기록을 지웠습니다.`)}
                        >
                          지우기
                        </button>
                      </span>
                      <span className="ig-receipt-row__detail">
                        {r.quantity.toLocaleString('ko-KR')}주 × {won(r.perShare)}
                      </span>
                      {g.prevByCode != null && (
                        <span className="ig-receipt-row__delta">{prev == null ? <span style={faint}>새로</span> : <DeltaWon v={netOf(r) - prev} />}</span>
                      )}
                    </li>
                  )
                })}
              </ul>
            </details>
          ))}
          <div style={faint}>최근 12개월을 보여 줍니다. 지난달 대비는 그 달에 적은 종목 합계끼리, &lsquo;같은 종목끼리&rsquo;는 두 달 모두 적은 종목만 비교합니다.</div>
        </div>
      )}

      {thisMonth.net > 0 && (
        <div style={{ marginTop: 10 }}>
          이번 달 받은 <strong>{won(thisMonth.net)}</strong>은 {buyName ? <strong>{buyName}</strong> : '성장 지수 ETF'}로 재투자합니다(위 ①과 같은 곳).
        </div>
      )}
    </div>
  )
}
