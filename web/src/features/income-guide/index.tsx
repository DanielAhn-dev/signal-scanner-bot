import React, { useCallback, useEffect, useRef, useState } from 'react'
import More from '../../components/ui/More'
import { formatKrwMan } from '../../lib/format'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import Button from '../../components/ui/Button'
import { useCurrentChatId } from '../../stores/profileStore'
import Collapsible from '../../components/ui/Collapsible'
import PlanSteps, { type RebalancePlan } from './PlanSteps'
import IncomeProductCheck, { type IncomeCheckRow } from './IncomeProductCheck'
import DistributionReceipts, { type DistributionReceiptsData } from './DistributionReceipts'
import { reinvestLabel, reinvestTargets } from './reinvestTarget'
import WeightHistory from './WeightHistory'
import type { PlanMixLine } from '../../../../src/lib/planMixGuide'

type Group = 'growth' | 'income' | 'satellite' | 'cash'
type Warning = { level: 'info' | 'warn' | 'alert'; title: string; text: string }
type Order = {
  side: 'sell' | 'buy'
  code: string
  name: string
  accountLabel: string
  group: Group
  price: number
  shares: number
  amount: number
  realizedGain: number | null
}
type ChangeSplit = { heldDistancePp: number; marketPp: number; minePp: number; text: string }
type HealthPoint = { date: string; total: number; distancePp: number; outOfBand: number; satellitePct: number; cashPct: number; note?: string }
type Unfilled = { group: Group; bucket?: string; amount: number; indexLabel?: string; productName?: string | null }
type View = {
  today: string
  settings: {
    monthlyNeed: number
    incomeStart?: string
    satelliteCapPct: number
    overseasPct: number
    customTargets?: { income?: number; cash?: number }
    financialIncomeCap: number
    ageBand?: string
    actualMonthlyNet?: number
    monthlyContribution?: number
    cashBalance?: number
    cashByAccount?: Record<string, number>
    incomeMode?: 'hold'
    feePctByCode?: Record<string, number>
    incomeKindsTarget?: number
    roleKeepers?: Record<string, string>
    indexOverlapMerge?: boolean
  }
  /** 첫 화면 "할 일" (src/lib/rebalancePlan.ts). 보유가 없으면 null */
  plan?: RebalancePlan | null
  /** 일반 계좌 인컴 상품 점검 (src/lib/incomeProductCheck.ts) */
  incomeCheck?: IncomeCheckRow[]
  targetSource: 'stage' | 'custom'
  age: { band: string; label: string; safePct: number; applied: boolean; lines: string[] } | null
  distributions: {
    taxableAnnual: number
    shelteredAnnual: number
    cap: number
    headroom: number
    headroomAsDividendCapital: number
    taxableFromCoveredCall: number
  }
  contribution: {
    amount: number
    allocations: Array<{ group: Group; amount: number }>
    orders: Order[]
    unfilled: Unfilled[]
    stillOutOfBand: boolean
  } | null
  history?: Array<{ date: string; total: number; groups: Array<{ group: Group; actualPct: number; targetPct: number }>; note?: string; auto?: boolean }>
  comparison?: {
    base: HealthPoint
    now: HealthPoint
    groups: Array<{ group: Group; beforePct: number; nowPct: number; targetPct: number }>
    verdict: 'closer' | 'farther' | 'same'
    text: string
    split: ChangeSplit | null
  } | null
  total: number
  holdingCount: number
  priceFallbacks?: number
  stage: { key: 'accumulate' | 'transition' | 'income'; title: string; text: string; yearsToIncome: number | null }
  need: {
    annual: number
    ratePct: number
    capitalByDistribution: number
    capitalByWithdrawal4: number
    evidence: { ratePct: number; mixKeepPct: number; mixWorstPct: number; krOnlyKeepPct: number } | null
  }
  groups: Array<{ group: Group; label: string; value: number; actualPct: number; targetPct: number; diffPct: number; diffAmount: number }>
  growthSplit: { krValue: number; globalValue: number; globalPct: number; targetGlobalPct: number }
  /** 해외 비중 목표가 내 계획 구성(모아가기 1번)에서 온 값이면 그 %. 배포 전 API에는 없다 */
  overseasFromPlan?: number | null
  /** 내 계획 구성대로 새 돈을 나눈 줄 (배포 전 API에는 없다) */
  planMix?: PlanMixLine[] | null
  buckets: Array<{ bucket: string; label: string; value: number; pct: number }>
  npsReference?: Array<{ label: string; actualPct: number; refPct: number; diffPp: number }> | null
  rebalance: {
    needed: boolean
    reason: string
    moves: Array<{ from: Group; to: Group; amount: number }>
    growthShift: { to: 'global_index' | 'kr_index'; amount: number } | null
    orders: Order[]
    unfilled: Unfilled[]
    realizedGainTotal: number
    trims: Array<{ group: Group; holdings: Array<{ code: string; name: string; accountLabel: string; value: number }> }>
  }
  warnings: Warning[]
  accounts: Array<{ key: string; label: string; taxAdvantaged: boolean; total: number; byGroup: Record<Group, number> }>
  holdings: Array<{ code: string; name: string; accountKey?: string; accountLabel: string; value: number; quantity: number; label?: string; bucket: string; group: Group; pct: number }>
  /** 분배금 받은 기록·다음 달 예상 (handlers/ui/income-guide.ts) */
  distributionReceipts?: DistributionReceiptsData
  /** 계좌 고르기 목록 — 평가금 큰 순 (src/lib/guideAccountScope.ts). 배포 전 API에는 없다 */
  accountList?: AccountOption[]
  /** 지금 보는 계좌. 전체 합산이면 null */
  account?: (AccountOption & {
    targets: Record<string, unknown> | null
    monthlyContribution: { amount: number; source: 'account' | 'common' | 'none' }
  }) | null
}
type AccountKind = 'general' | 'cma' | 'isa' | 'irp' | 'pension'
type AccountOption = { key: string; label: string; total: number; holdingCount: number; ownTargets: boolean; kind: AccountKind; kindChosen: boolean }
const KIND_LABEL: Record<AccountKind, string> = { general: '일반', cma: 'CMA', isa: 'ISA', irp: 'IRP', pension: '연금저축' }
const KIND_HINT: Record<AccountKind, string> = {
  general: '매매차익·분배금이 바로 과세됩니다. 국내 주식형 ETF·고배당을 두기 좋은 곳입니다.',
  cma: '대기 자금·비상금 자리입니다. 현금성 비중으로 봅니다.',
  isa: '분배금·해외 ETF 과세가 미뤄지고 줄어듭니다. 해외 지수·커버드콜처럼 과세가 큰 상품을 먼저 둡니다.',
  irp: '노후용 계좌입니다. 위험자산 한도(70%)가 있어 안전자산 30%를 채워야 합니다.',
  pension: '노후용 계좌입니다. 과세가 미뤄지니 해외 지수·분배형을 두기 좋습니다.',
}
/** 마지막으로 본 계좌 — 이 브라우저에만 저장 (편의용) */
const ACCOUNT_STORE = 'income-guide:account'
const ALL = '__all'
function readStoredAccount(): string {
  try {
    return window.localStorage.getItem(ACCOUNT_STORE) || 'auto'
  } catch {
    return 'auto'
  }
}
function storeAccount(key: string) {
  try {
    window.localStorage.setItem(ACCOUNT_STORE, key)
  } catch {
    /* 저장 못 해도 화면은 그대로 */
  }
}

const GROUP_LABEL: Record<Group, string> = { growth: '성장 (지수)', income: '인컴 (분배형)', satellite: '위성 (개별주·테마)', cash: '현금성' }
const BUY_HINT: Record<Group, string> = {
  growth: '국내 지수(KODEX 200 등, 일반 계좌) · 해외 지수(S&P500 등, ISA·연금 계좌)',
  income: '국내 고배당 · 미국 배당성장(SCHD 계열) · 오래 버틴 인프라 펀드. 커버드콜은 인컴의 1/3 이하',
  satellite: '새로 채우지 않습니다 (상한 안에서만 유지)',
  cash: '단기채권·CD금리 ETF 또는 파킹통장 — 1년치 생활비',
}
const man = formatKrwMan
const pct = (v: number) => `${v.toFixed(0)}%`

/** 가진 종목으로 못 채운 금액 — 내 계획 구성의 지수 몫이면 그 지수·고른 상품 이름으로 */
function UnfilledLine({ u }: { u: Unfilled }) {
  return (
    <div style={{ color: 'var(--color-text-secondary)' }}>
      {u.indexLabel ? (
        <>새로 살 금액: 내 계획 구성의 {u.indexLabel} 몫 {man(u.amount)} — {u.productName ?? '모아가기 1번 추천 상품'}</>
      ) : (
        <>
          새 상품으로 채울 금액: {GROUP_LABEL[u.group]}
          {u.bucket === 'global_index' ? '(해외 지수)' : u.bucket === 'kr_index' ? '(국내 지수)' : ''} {man(u.amount)} — {BUY_HINT[u.group]}
        </>
      )}
    </div>
  )
}

function OrdersTable({ orders, th, td }: { orders: Order[]; th: React.CSSProperties; td: React.CSSProperties }) {
  return (
    <div style={{ overflowX: 'auto' }}>
    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 4 }}>
      <thead>
        <tr>
          <th style={th}>구분</th>
          <th style={th}>종목</th>
          <th style={th}>계좌</th>
          <th style={th}>수량 × 가격</th>
          <th style={th}>금액</th>
          <th style={th}>확정 손익</th>
        </tr>
      </thead>
      <tbody>
        {orders.map((o) => (
          <tr key={`${o.side}-${o.accountLabel}-${o.code}`}>
            <td style={{ ...td, color: o.side === 'sell' ? 'var(--color-stock-down)' : 'var(--color-stock-up)', fontWeight: 600 }}>
              {o.side === 'sell' ? '매도' : '매수'}
            </td>
            <td style={td}>{o.name}</td>
            <td style={td}>{o.accountLabel}</td>
            <td style={td}>
              {o.shares.toLocaleString('ko-KR')}주 × {Math.round(o.price).toLocaleString('ko-KR')}원
            </td>
            <td style={td}>{man(o.amount)}</td>
            <td style={td}>
              {o.realizedGain == null ? '-' : `${o.realizedGain >= 0 ? '+' : '−'}${man(Math.abs(o.realizedGain))}`}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
            </div>
  )
}

/**
 * 실계좌 리밸런싱 가이드 — 포트폴리오에서 "계좌/보유 추가"로 넣은 실제 계좌 보유를 성장·인컴·위성·현금성으로 나눠
 * 모으기 → 전환 → 인컴 단계의 목표 비중과 비교한다. 계산은 src/lib/incomeGuide.ts. 주문은 하지 않는다.
 */
/** 분배금 기록용 종목 목록 — 같은 종목은 계좌를 합치고(계좌별 수량은 accounts에), 분배금이 없는 TR형은 뺀다 */
function receiptHoldings(holdings: View['holdings'], accountList: AccountOption[]) {
  const labelOf = new Map(accountList.map((a) => [a.key, a.label]))
  const m = new Map<string, { code: string; name: string; quantity: number; value: number; accounts: Array<{ key: string; label: string; quantity: number }> }>()
  for (const h of holdings) {
    // 예수금(CASH)은 분배금이 없다 — 서버 incomeGuide의 CASH_BALANCE_CODE
    if (h.code === 'CASH' || /TR$/i.test(h.name.trim()) || !(h.quantity > 0)) continue
    const cur = m.get(h.code)
    const accounts = [...(cur?.accounts ?? [])]
    if (h.accountKey) {
      const a = accounts.find((x) => x.key === h.accountKey)
      if (a) a.quantity += h.quantity
      else accounts.push({ key: h.accountKey, label: labelOf.get(h.accountKey) ?? h.accountLabel, quantity: h.quantity })
    }
    m.set(h.code, { code: h.code, name: h.name, quantity: (cur?.quantity ?? 0) + h.quantity, value: (cur?.value ?? 0) + h.value, accounts })
  }
  return [...m.values()].sort((a, b) => b.value - a.value)
}

export default function IncomeGuidePage() {
  const chatId = useCurrentChatId()
  const navigate = useNavigate()
  const [view, setView] = useState<View | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 'common' = 공통 설정, 'account' = 지금 보는 계좌 목표, null = 닫힘
  const [editing, setEditing] = useState<null | 'common' | 'account'>(null)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ needMan: '', incomeStart: '', satCap: '', overseas: '', incomePct: '', cashPct: '', capMan: '', ageBand: '' })
  const [contribMan, setContribMan] = useState('')
  const [appliedContrib, setAppliedContrib] = useState(0)
  const [note, setNote] = useState('')
  const [recordMsg, setRecordMsg] = useState<string | null>(null)
  const [accountMsg, setAccountMsg] = useState<string | null>(null)
  // 보는 계좌 — 처음엔 마지막으로 본 계좌(없으면 가장 큰 계좌, 서버가 auto를 풀어 준다)
  const [accountSel, setAccountSel] = useState<string>(readStoredAccount)
  const accountRef = useRef(accountSel)
  accountRef.current = accountSel

  /** 가이드 경로 — 보는 계좌와 넣을 돈을 붙인다 */
  const guideUrl = (contribution: number, account = accountRef.current) => {
    const p = new URLSearchParams({ account })
    if (contribution > 0) p.set('contribution', String(Math.round(contribution)))
    return `/api/ui/income-guide?${p.toString()}`
  }

  const load = useCallback(async (init?: { method: string; body: string }, contribution = 0, account?: string): Promise<boolean> => {
    try {
      const res = await apiFetch(guideUrl(contribution, account), { cacheMs: 0, timeoutMs: 20_000, ...(init ?? {}) })
      if (!res?.data) {
        setError(res?.error ?? '가이드를 불러오지 못했습니다.')
        return false
      }
      const data = res.data as View
      setView(data)
      // auto·없어진 계좌는 서버가 고른 계좌로 맞춘다
      const shown = data.account?.key ?? ALL
      if (data.accountList && shown !== accountRef.current) {
        accountRef.current = shown
        setAccountSel(shown)
      }
      if (data.accountList) storeAccount(shown)
      setError(null)
      return true
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
      return false
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (chatId) void load()
  }, [chatId, load])

  // 연타로 두 번 불러오지 않게 (모바일 더블탭)
  const busyRef = useRef(false)
  const switchAccount = async (key: string) => {
    if (busyRef.current || key === accountSel) return
    busyRef.current = true
    accountRef.current = key
    setAccountSel(key)
    setEditing(null)
    setAccountMsg(null)
    setRecordMsg(null)
    // 넣을 돈 배분은 계좌마다 다르니 비운다
    setAppliedContrib(0)
    setContribMan('')
    setBusy(true)
    await load(undefined, 0, key)
    setBusy(false)
    busyRef.current = false
  }
  const saveAccount = async (body: Record<string, unknown>, done: string) => {
    if (busyRef.current) return false
    busyRef.current = true
    setBusy(true)
    setAccountMsg(null)
    const ok = await load({ method: 'POST', body: JSON.stringify(body) }, appliedContrib)
    setBusy(false)
    busyRef.current = false
    setAccountMsg(ok ? done : '저장하지 못했습니다.')
    return ok
  }

  const startEdit = (mode: 'common' | 'account') => {
    if (!view) return
    setForm({
      needMan: String(Math.round(view.settings.monthlyNeed / 10_000)),
      incomeStart: view.settings.incomeStart ?? '',
      satCap: String(view.settings.satelliteCapPct),
      overseas: String(view.settings.overseasPct),
      incomePct: view.settings.customTargets?.income != null ? String(view.settings.customTargets.income) : '',
      cashPct: view.settings.customTargets?.cash != null ? String(view.settings.customTargets.cash) : '',
      capMan: String(Math.round((view.settings.financialIncomeCap ?? 10_000_000) / 10_000)),
      ageBand: view.settings.ageBand ?? '',
    })
    setEditing(mode)
  }
  // 계좌 목표는 해외 비중도 이 계좌 값으로 정한다(내 계획 구성은 전체 기준)
  const overseasLocked = editing !== 'account' && view?.overseasFromPlan != null
  const save = async () => {
    const values = {
      monthlyNeed: Number(form.needMan) * 10_000,
      incomeStart: form.incomeStart,
      satelliteCapPct: Number(form.satCap),
      // 내 계획 구성이 정한 값이면 보내지 않는다 — 여기서 고칠 수 없다(모아가기 1번이 정한다)
      ...(!overseasLocked ? { overseasPct: Number(form.overseas) } : {}),
      // 빈 칸은 단계 기본값으로 되돌린다
      customTargets: { income: form.incomePct, cash: form.cashPct },
      financialIncomeCap: Number(form.capMan) * 10_000,
      ageBand: form.ageBand,
    }
    setBusy(true)
    const ok = await load(
      { method: 'POST', body: JSON.stringify(editing === 'account' ? { action: 'account-targets', targets: values } : values) },
      appliedContrib,
    )
    setBusy(false)
    if (ok) setEditing(null)
  }
  const applyContribution = async () => {
    const amount = Math.max(0, Number(contribMan) * 10_000)
    setBusy(true)
    const ok = await load(undefined, amount)
    setBusy(false)
    if (ok) setAppliedContrib(amount)
  }
  const record = async () => {
    setBusy(true)
    setRecordMsg(null)
    const ok = await load({ method: 'POST', body: JSON.stringify({ action: 'record', note }) }, appliedContrib)
    setBusy(false)
    setRecordMsg(ok ? '오늘 비중을 점검 기록에 남겼습니다.' : '기록하지 못했습니다.')
    if (ok) setNote('')
  }

  const box: React.CSSProperties = {
    margin: '8px 12px',
    width: 'auto', // 시트 모바일 규칙(.xls-content-inner > * 폭 100%)과 좌우 마진이 겹쳐 24px 넘치던 것
    padding: 12,
    border: '1px solid var(--color-border-default)',
    borderRadius: 6,
    fontSize: 12,
    lineHeight: 1.6,
    background: 'var(--color-bg-elevated, transparent)',
  }
  const th: React.CSSProperties = { whiteSpace: 'nowrap', textAlign: 'left', padding: '4px 8px', color: 'var(--color-text-secondary)', fontWeight: 600, borderBottom: '1px solid var(--color-border-default)' }
  const td: React.CSSProperties = { whiteSpace: 'nowrap', padding: '4px 8px', borderBottom: '1px solid var(--color-border-default)', fontVariantNumeric: 'tabular-nums' }
  const levelColor = (l: Warning['level']) =>
    l === 'alert' ? 'var(--color-error)' : l === 'warn' ? 'var(--color-warning, #b45309)' : 'var(--color-text-secondary)'

  if (error && !view) return <div style={box}>리밸런싱 가이드: {error}</div>
  if (!view) return <div style={box}>불러오는 중…</div>

  const inputStyle: React.CSSProperties = { width: 90, marginRight: 8 }

  const saveSettings = (patch: Record<string, unknown>) => load({ method: 'POST', body: JSON.stringify(patch) }, appliedContrib)
  // 분배금 기록은 검증 실패(400) 이유를 그 자리에 보여 준다 — 화면 전체 오류로 바꾸지 않는다
  const submitReceipt = async (body: Record<string, unknown>): Promise<string | null | { note: string }> => {
    try {
      const res = await apiFetch(guideUrl(appliedContrib), { method: 'POST', body: JSON.stringify(body), cacheMs: 0, retries: 0, timeoutMs: 20_000 })
      if (!res?.data) return res?.error ?? '저장하지 못했습니다.'
      setView(res.data)
      // 이번 달 기록은 서버가 그 계좌 예수금도 맞춘다(applyReceiptToCash)
      const adj = res.cashAdjust as { before: number; after: number } | null | undefined
      return adj ? { note: `계좌 예수금 ${adj.before.toLocaleString('ko-KR')}원 → ${adj.after.toLocaleString('ko-KR')}원` } : null
    } catch (e: unknown) {
      const text = e instanceof Error ? e.message : String(e)
      return text.match(/"error":"([^"]+)"/)?.[1] ?? '저장하지 못했습니다. 잠시 뒤 다시 눌러 주세요.'
    }
  }

  const settingsBox = (
      <div style={box}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 14 }}>
            {view.targetSource === 'custom' ? '내 목표 비중 · ' : ''}단계: {view.stage.title}
            {view.stage.yearsToIncome != null && view.stage.yearsToIncome > 0 ? ` · 인컴 시작까지 ${view.stage.yearsToIncome.toFixed(1)}년` : ''}
          </strong>
          {!editing && (
            <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
              {view.account ? (
                <>
                  <Button size="sm" variant="secondary" onClick={() => startEdit('account')}>
                    {view.account.ownTargets ? '이 계좌 목표 고치기' : '이 계좌 목표 따로 정하기'}
                  </Button>
                  {view.account.ownTargets ? (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void saveAccount({ action: 'account-targets', targets: null }, '이 계좌를 공통 설정으로 되돌렸습니다.')}>
                      공통 설정으로 되돌리기
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => startEdit('common')}>
                      공통 설정 고치기
                    </Button>
                  )}
                </>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => startEdit('common')}>
                  가이드 설정
                </Button>
              )}
            </span>
          )}
        </div>
        {view.account && (
          <div style={{ color: 'var(--color-text-secondary)' }}>
            {view.account.ownTargets
              ? `${view.account.label} 전용 목표로 계산합니다. 공통 설정을 고쳐도 이 계좌는 바뀌지 않습니다.`
              : `${view.account.label}은 공통 설정을 씁니다. 가족 계좌처럼 목적이 다르면 이 계좌 목표를 따로 정하세요.`}
          </div>
        )}
        {editing && view.account && (
          <div style={{ marginTop: 4, fontWeight: 600 }}>
            {editing === 'account' ? `${view.account.label} 목표` : '공통 설정 (목표를 따로 정하지 않은 모든 계좌)'}
          </div>
        )}
        <div style={{ margin: '4px 0' }}>{view.stage.text}</div>
        {view.age ? (
          <div style={{ margin: '4px 0' }}>
            <strong>{view.age.label} 기준</strong>
            {view.age.lines.map((line) => (
              <div key={line} style={{ color: 'var(--color-text-secondary)' }}>
                · {line}
              </div>
            ))}
          </div>
        ) : null}
        {editing && (
          <div style={{ margin: '6px 0', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
            인컴 단계 월 목표 인컴(만원, 세후)
            <input style={inputStyle} value={form.needMan} onChange={(e) => setForm({ ...form, needMan: e.target.value })} />
            인컴 시작 월
            <input type="month" style={{ ...inputStyle, width: 130 }} value={form.incomeStart} onChange={(e) => setForm({ ...form, incomeStart: e.target.value })} />
            위성 상한(%)
            <input style={inputStyle} value={form.satCap} onChange={(e) => setForm({ ...form, satCap: e.target.value })} />
            성장 중 해외 비중(%)
            {overseasLocked
              ? <span>{view.overseasFromPlan}% <Button size="sm" variant="ghost" onClick={() => navigate('/accumulate')}>내 계획 구성에서 정함 · 모아가기에서 바꾸기</Button></span>
              : <input style={inputStyle} value={form.overseas} onChange={(e) => setForm({ ...form, overseas: e.target.value })} />}
            내 목표 — 인컴(%)
            <input style={inputStyle} placeholder="단계 기본" value={form.incomePct} onChange={(e) => setForm({ ...form, incomePct: e.target.value })} />
            현금성(%)
            <input style={inputStyle} placeholder="단계 기본" value={form.cashPct} onChange={(e) => setForm({ ...form, cashPct: e.target.value })} />
            나이대
            <select style={{ ...inputStyle, width: 110 }} value={form.ageBand} onChange={(e) => setForm({ ...form, ageBand: e.target.value })}>
              <option value="">선택 안 함</option>
              <option value="20s">20대</option>
              <option value="30s">30대</option>
              <option value="40s">40대</option>
              <option value="50s">50대</option>
              <option value="60s">60대 이상</option>
            </select>
            일반 계좌 금융소득 상한(만원/년)
            <input style={inputStyle} value={form.capMan} onChange={(e) => setForm({ ...form, capMan: e.target.value })} />
            <Button size="sm" disabled={busy} onClick={() => void save()}>
              저장
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
              취소
            </Button>
            <div style={{ width: '100%', color: 'var(--color-text-tertiary)' }}><More label="칸마다 무슨 뜻인가요">
              나이대는 생년월일 대신 구간만 받습니다. 고르면 모으기·전환 단계의 현금성 목표 비중에 나이대별 하한(20대 10% … 60대 이상 60%)이 붙습니다.
              "내 목표"는 엑셀로 쓰던 비중이 있으면 넣으세요. 비우면 단계 기본값이고, 성장(지수)은 나머지로 채웁니다.
              인컴 시작 월을 비워 두면 계속 모으는 단계로 봅니다. 시작 5년 전부터 매년 한 번 분배형·현금성 비중을 계단식으로 늘립니다.
              해외 비중 기본 50%는 2003~2026 코스피·S&amp;P500(원화) 반반이 5년 최악을 가장 줄였기 때문입니다.
            </More></div>
          </div>
        )}
        <div>
          {view.account ? '이 계좌' : '계좌'} 보유 {view.holdingCount}개 · 평가 {man(view.total)} · 월 {man(view.settings.monthlyNeed)} 생활비에 필요한 원금: 분배형만으로{' '}
          {man(view.need.capitalByDistribution)}(분배율 4.5%) · 지수에서 연 4%씩 꺼내면 {man(view.need.capitalByWithdrawal4)}
        </div>
        {view.priceFallbacks ? (
          <div style={{ color: 'var(--color-text-tertiary)' }}>실시간가를 못 받은 {view.priceFallbacks}개는 종가나 매수가로 평가했습니다.</div>
        ) : null}
      </div>
  )

  const accountList = view.accountList ?? []
  const acct = view.account ?? null
  const accountPicker = accountList.length > 0 && (
    <>
      <div className="ig-account-pick">
        <label htmlFor="ig-account-select">리밸런싱할 계좌</label>
        <select id="ig-account-select" value={accountSel} disabled={busy} onChange={(e) => void switchAccount(e.target.value)}>
          {/* 포트폴리오 실제 계좌 탭과 같은 순서(증권사·계좌 이름 순) */}
          {[...accountList].sort((x, y) => x.label.localeCompare(y.label, 'ko')).map((a) => (
            <option key={a.key} value={a.key}>
              {/* 이름에 종류가 이미 있으면(삼성 / 일반) 한 번만 */}
              {a.label}{a.label.includes(KIND_LABEL[a.kind]) ? '' : ` · ${KIND_LABEL[a.kind]}`} · {man(a.total)}{a.ownTargets ? ' · 전용 목표' : ''}
            </option>
          ))}
          {accountList.length > 1 && <option value={ALL}>전체 합산 (참고용)</option>}
        </select>
      </div>
      {acct ? (
        <div style={{ ...box, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 12px' }}>
          <strong style={{ fontSize: 14, width: '100%', wordBreak: 'keep-all' }}>{acct.label}</strong>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 220px', maxWidth: 320, whiteSpace: 'nowrap' }}>
            계좌 종류
            <select
              style={{ flex: 1, minWidth: 140, minHeight: 36 }}
              value={acct.kind}
              disabled={busy}
              onChange={(e) => void saveAccount({ action: 'account-kind', kind: e.target.value }, `계좌 종류를 ${KIND_LABEL[e.target.value as AccountKind]}(으)로 정했습니다.`)}
            >
              {(Object.keys(KIND_LABEL) as AccountKind[]).map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          {!acct.kindChosen && <span style={{ color: 'var(--color-text-tertiary)', wordBreak: 'keep-all' }}>이름으로 추정했습니다. 다르면 골라 주세요.</span>}
          {accountMsg && <span role="status" style={{ color: 'var(--color-text-secondary)' }}>{accountMsg}</span>}
          <div style={{ width: '100%', color: 'var(--color-text-secondary)' }}>
            {KIND_HINT[acct.kind]} 이 계좌의 보유·예수금만으로 비중과 할 일을 계산합니다.
            {acct.monthlyContribution.source === 'common' ? ' 매달 넣는 돈(공통)은 가장 큰 계좌인 이 계좌에 붙였습니다 — 계좌마다 따로 적으면 그 값을 씁니다.' : ''}
          </div>
        </div>
      ) : accountList.length > 1 ? (
        <div style={{ ...box, color: 'var(--color-text-secondary)' }}>
          <strong style={{ color: 'var(--color-text-primary)' }}>전체 합산은 참고용입니다.</strong> 일반·ISA·연금 계좌는 세금과 목적이 달라 합쳐서 맞추면 실제로 어느 계좌에서
          팔고 살지 정하기 어렵습니다. 매도·정리는 위에서 계좌를 골라서 하세요. 이 보기의 기록은 예전부터 쌓인 합산 기록입니다.
        </div>
      ) : null}
    </>
  )

  return (
    <div style={{ paddingBottom: 24 }}>
      {accountPicker}
      {view.holdingCount === 0 ? (
        <div style={box}>
          아직 입력한 실계좌 보유가 없습니다. 포트폴리오의 <strong>계좌/보유 추가</strong>에서 증권사·계좌명과 보유 종목을 넣으면, 계좌마다 어떤 바구니에
          얼마가 있는지와 옮길 금액을 안내합니다. 계좌 이름에 ISA·연금·IRP가 들어가면 세금 배치도 함께 봅니다.
          <div style={{ marginTop: 6 }}>
            <Button size="sm" onClick={() => navigate('/portfolio')}>
              포트폴리오로 가기
            </Button>
          </div>
        </div>
      ) : (
        <>
          {view.plan && (
            <PlanSteps
              key={`${acct?.key ?? ALL}|${JSON.stringify(view.settings)}`}
              plan={view.plan}
              groups={view.groups}
              settings={view.settings}
              saveSettings={saveSettings}
              accounts={view.accounts}
              scopeLabel={acct?.label ?? null}
              planMix={view.planMix ?? null}
              receiptsSlot={view.distributionReceipts ? (
                <DistributionReceipts
                  data={view.distributionReceipts}
                  holdings={receiptHoldings(view.holdings, view.accountList ?? [])}
                  buyName={reinvestLabel(reinvestTargets(view.plan, view.distributionReceipts.thisMonth.items.map((r) => r.code), view.holdings))}
                  submit={submitReceipt}
                  monthlyGoal={view.settings.monthlyNeed}
                />
              ) : null}
            />
          )}
          {view.incomeCheck && view.incomeCheck.length > 0 && <IncomeProductCheck rows={view.incomeCheck} />}

          <div style={{ ...box, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span>증권사에서 옮기기 전에 한 번, 옮기고 보유를 고친 뒤에 한 번 기록하면 전후가 비교됩니다.</span>
            <input style={{ width: 200 }} placeholder="메모 (예: 겹치는 커버드콜 정리)" value={note} onChange={(e) => setNote(e.target.value)} />
            <Button size="sm" disabled={busy} onClick={() => void record()}>
              오늘 비중 기록
            </Button>
            {recordMsg && <span style={{ color: 'var(--color-text-secondary)' }}>{recordMsg}</span>}
          </div>

          <Collapsible
            className="ig-collapsible"
            title="자세히 보기"
            hint={`바구니별 비중 · 목표 비중 주문안 · 분배금 · 기록${view.warnings.length ? ` · 확인할 것 ${view.warnings.length}건` : ''}`}
          >
          <div style={box}>
            <strong>바구니별 비중 — 목표 대비</strong>
            <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
              <thead>
                <tr>
                  <th style={th}>바구니</th>
                  <th style={th}>현재</th>
                  <th style={th}>목표</th>
                  <th style={th}>옮길 금액</th>
                </tr>
              </thead>
              <tbody>
                {view.groups.map((g) => (
                  <tr key={g.group}>
                    <td style={td}>{g.label}</td>
                    <td style={td}>
                      {pct(g.actualPct)} · {man(g.value)}
                    </td>
                    <td style={td}>{pct(g.targetPct)}</td>
                    <td
                      style={{
                        ...td,
                        color: Math.abs(g.diffPct) > 10 ? 'var(--color-error)' : 'var(--color-text-secondary)',
                        fontWeight: Math.abs(g.diffPct) > 10 ? 600 : 400,
                      }}
                    >
                      {Math.abs(g.diffAmount) < 10_000 ? '-' : `${g.diffAmount > 0 ? '+' : '−'}${man(Math.abs(g.diffAmount))}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <div style={{ marginTop: 4, color: 'var(--color-text-secondary)' }}>
              성장 바구니 안: 국내 {man(view.growthSplit.krValue)} · 해외 {man(view.growthSplit.globalValue)} (해외 {pct(view.growthSplit.globalPct)}, 목표{' '}
              {view.growthSplit.targetGlobalPct}%{view.overseasFromPlan != null ? ' · 내 계획 구성' : ''})
            </div>
            <div style={{ marginTop: 2, color: 'var(--color-text-tertiary)' }}>
              세부: {view.buckets.map((b) => `${b.label} ${pct(b.pct)}`).join(' · ')}
            </div>
            {view.npsReference && (
              <div style={{ marginTop: 6, color: 'var(--color-text-secondary)' }}>
                참고 · 국민연금 2026년 목표와 비교(주문·목표에는 쓰지 않음):{' '}
                {view.npsReference.map((r) => `${r.label} ${pct(r.actualPct)} (국민연금 ${pct(r.refPct)})`).join(' · ')}
                <div style={{ color: 'var(--color-text-tertiary)' }}>
                  보도된 목표 비중을 묶은 근사이며, 국민연금은 장기 기금이라 나이·인출 계획이 있는 내 계좌와 같을 필요는 없습니다.
                </div>
              </div>
            )}
          </div>

          <div style={{ ...box, borderColor: view.rebalance.needed ? 'var(--color-error)' : 'var(--color-border-default)' }}>
            <strong>목표 비중만 맞출 때의 주문안 {view.rebalance.needed ? '(±10%p 넘음)' : '(정기 점검 때)'}</strong>
            <div style={{ color: 'var(--color-text-tertiary)' }}>
              바구니 비중만 보고 낸 계산이라 월 인컴 목표는 따지지 않습니다. 실제로 할 일은 맨 위 ①~③을 따르세요.
            </div>
            <div>{view.rebalance.reason}</div>
            {view.rebalance.moves.length > 0 && (
              <ul style={{ margin: '6px 0', paddingLeft: 18 }}>
                {view.rebalance.moves.map((m, i) => (
                  <li key={i}>
                    {GROUP_LABEL[m.from]} → {GROUP_LABEL[m.to]} <strong>{man(m.amount)}</strong>
                    <span style={{ color: 'var(--color-text-tertiary)' }}> — 채울 곳: {BUY_HINT[m.to]}</span>
                  </li>
                ))}
              </ul>
            )}
            {view.rebalance.growthShift && (
              <div>
                성장 바구니 안에서{' '}
                {view.rebalance.growthShift.to === 'global_index' ? '국내 지수 → 해외 지수' : '해외 지수 → 국내 지수'}{' '}
                <strong>{man(view.rebalance.growthShift.amount)}</strong>
                <span style={{ color: 'var(--color-text-tertiary)' }}>
                  {' '}
                  — 해외 지수는 ISA·연금 계좌에서 사면 매매차익·분배금 과세(15.4%)를 미루거나 줄일 수 있습니다
                </span>
              </div>
            )}
            {view.rebalance.orders.length > 0 && (
              <>
                <div style={{ marginTop: 8, fontWeight: 600 }}>
                  종목별 주문안 — 매도 먼저, 그 대금으로 매수
                  {view.rebalance.realizedGainTotal !== 0 && (
                    <span style={{ fontWeight: 400, color: view.rebalance.realizedGainTotal > 0 ? 'var(--color-stock-up)' : 'var(--color-stock-down)' }}>
                      {' '}
                      · 매도로 확정되는 손익 {view.rebalance.realizedGainTotal > 0 ? '+' : '−'}
                      {man(Math.abs(view.rebalance.realizedGainTotal))}
                    </span>
                  )}
                </div>
                <OrdersTable orders={view.rebalance.orders} th={th} td={td} />
              </>
            )}
            {view.rebalance.unfilled.map((u, i) => (
              <UnfilledLine key={i} u={u} />
            ))}
            <div style={{ marginTop: 4, color: 'var(--color-text-tertiary)' }}><More label="왜 비중으로 정하나">
              손실 중인지 수익 중인지가 아니라 비중으로 정합니다. 새로 넣는 돈으로 모자란 바구니를 먼저 채우면 팔지 않고도 맞출 수 있습니다.
              국내 주식형 ETF끼리는 매매차익이 비과세라 일반 계좌에서도 옮기는 비용이 거의 없습니다.
            </More></div>
          </div>

          <div style={box}>
            <strong>예상 분배금과 금융소득 상한</strong>
            <div>
              일반 계좌(과세) 연 {man(view.distributions.taxableAnnual)}(월 {man(view.distributions.taxableAnnual / 12)}) · ISA·연금(절세) 연{' '}
              {man(view.distributions.shelteredAnnual)} · 합계 월 {man((view.distributions.taxableAnnual + view.distributions.shelteredAnnual) / 12)}
            </div>
            <div style={{ color: view.distributions.headroom < 0 ? 'var(--color-error)' : 'var(--color-text-primary)' }}>
              상한 연 {man(view.distributions.cap)} 대비{' '}
              {view.distributions.headroom >= 0
                ? `여유 ${man(view.distributions.headroom)} — 일반 계좌 고배당(분배율 4.5%)으로 약 ${man(view.distributions.headroomAsDividendCapital)}까지 더 채울 수 있습니다.`
                : `${man(-view.distributions.headroom)} 초과 — 분배율 높은 상품부터 ISA·연금으로 옮기세요.`}
            </div>
            <div style={{ color: 'var(--color-text-tertiary)' }}>
              분배율은 바구니별 가정이라 실제와 다를 수 있습니다.
              <More label="가정한 분배율·절세 팁">분배율 가정: 고배당 4.5%, 커버드콜 8.5%, 리츠·인프라 6.5%, 국내 지수 2%, 해외 지수 1.2%.
              분배금으로 ISA·연금 납입을 채우고 남는 돈은 지수형(KODEX 200 TR 등)으로 사면, 과세 소득을 늘리지 않고 원금을 키울 수 있습니다.</More>
            </div>
          </div>

          <div style={box}>
            <strong>새로 넣을 돈 배분 — 팔지 않고 맞추기</strong>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
              이번에 넣을 돈(만원)
              <input style={inputStyle} value={contribMan} onChange={(e) => setContribMan(e.target.value)} />
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void applyContribution()}>
                배분 보기
              </Button>
            </div>
            {view.contribution ? (
              <>
                <div style={{ marginTop: 4 }}>
                  {man(view.contribution.amount)}을 모자란 바구니부터:{' '}
                  {view.contribution.allocations.map((a) => `${GROUP_LABEL[a.group]} ${man(a.amount)}`).join(' · ')}
                </div>
                {view.contribution.orders.length > 0 && <OrdersTable orders={view.contribution.orders} th={th} td={td} />}
                {view.contribution.unfilled.map((u, i) => (
                  <UnfilledLine key={i} u={u} />
                ))}
                <div style={{ color: view.contribution.stillOutOfBand ? 'var(--color-error)' : 'var(--color-text-secondary)' }}>
                  {view.contribution.stillOutOfBand
                    ? '넣은 뒤에도 ±10%p를 넘는 바구니가 남습니다 — 위 주문안처럼 일부는 팔아서 맞춰야 합니다.'
                    : '넣는 돈만으로 모든 바구니가 목표 ±10%p 안에 들어옵니다. 팔 필요가 없습니다.'}
                </div>
              </>
            ) : (
              <div style={{ color: 'var(--color-text-tertiary)' }}>
                매달 넣는 돈을 모자란 바구니에 먼저 넣으면 팔지 않고도(세금·수수료 없이) 비중을 맞출 수 있습니다.
              </div>
            )}
          </div>

          {view.comparison && (
            <div style={box}>
              <strong>직전 기록과 비교</strong>
              <div
                style={{
                  color:
                    view.comparison.verdict === 'closer'
                      ? 'var(--color-stock-up)'
                      : view.comparison.verdict === 'farther'
                        ? 'var(--color-error)'
                        : 'var(--color-text-secondary)',
                }}
              >
                {view.comparison.text}
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
                  <thead>
                    <tr>
                      <th style={th}>바구니</th>
                      <th style={th}>{view.comparison.base.date}</th>
                      <th style={th}>지금</th>
                      <th style={th}>목표</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.comparison.groups.map((g) => (
                      <tr key={g.group}>
                        <td style={td}>{GROUP_LABEL[g.group]}</td>
                        <td style={td}>{pct(g.beforePct)}</td>
                        <td style={td}>{pct(g.nowPct)}</td>
                        <td style={td}>{pct(g.targetPct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {view.comparison.split && (
                <div style={{ marginTop: 4 }}>
                  그 사이 변화: {view.comparison.split.text} (가만히 뒀다면 지금 거리 {view.comparison.split.heldDistancePp.toFixed(0)}%p)
                </div>
              )}
              {view.comparison.base.note && (
                <div style={{ color: 'var(--color-text-secondary)' }}>그때 메모: {view.comparison.base.note}</div>
              )}
              <div style={{ color: 'var(--color-text-secondary)', marginTop: 4 }}>
                앞으로 할 일: {view.rebalance.reason}
                <More label="계산 방식">할 일은 늘 지금 상태로만 계산합니다. "가만히 뒀다면"은 그때 수량을 지금 가격으로 다시 잰 값이고, 내 몫에는 새로 넣은 돈과 목표 변경도 들어갑니다.</More>
              </div>
            </div>
          )}

          <div style={box}>
            <strong>점검 기록</strong>
            <div style={{ color: 'var(--color-text-tertiary)' }}>
              매달 한 번은 자동으로 기록됩니다. 위 "오늘 비중 기록"으로 남긴 기록도 여기에 쌓입니다.
            </div>
            {view.history && view.history.length > 0 ? (
              <>
              <WeightHistory history={view.history} />
              <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
                <thead>
                  <tr>
                    <th style={th}>날짜</th>
                    <th style={th}>평가</th>
                    {(['growth', 'income', 'satellite', 'cash'] as Group[]).map((g) => (
                      <th key={g} style={th}>
                        {GROUP_LABEL[g]}
                      </th>
                    ))}
                    <th style={th}>메모</th>
                  </tr>
                </thead>
                <tbody>
                  {[...view.history].reverse().slice(0, 12).map((h, i) => (
                    <tr key={`${h.date}-${i}`}>
                      <td style={td}>{h.date}</td>
                      <td style={td}>{man(h.total)}</td>
                      {(['growth', 'income', 'satellite', 'cash'] as Group[]).map((g) => {
                        const row = h.groups.find((x) => x.group === g)
                        return (
                          <td key={g} style={td}>
                            {row ? `${row.actualPct.toFixed(0)}% / ${row.targetPct.toFixed(0)}%` : '-'}
                          </td>
                        )
                      })}
                      <td style={td}>{[h.auto ? '자동(매월)' : '', h.note ?? ''].filter(Boolean).join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
              </>
            ) : (
              <div style={{ color: 'var(--color-text-tertiary)' }}>
                리밸런싱을 한 날 기록해 두면 비중이 어떻게 움직였는지(현재 / 목표) 엑셀 이력처럼 쌓입니다.
              </div>
            )}
          </div>

          {view.warnings.length > 0 && (
            <div style={box}>
              <strong>확인할 것</strong>
              {view.warnings.map((w, i) => (
                <div key={i} style={{ marginTop: 6 }}>
                  <span style={{ color: levelColor(w.level), fontWeight: 600 }}>{w.title}</span> — {w.text}
                </div>
              ))}
            </div>
          )}

          {!acct && <div style={box}>
            <strong>계좌별</strong>
            <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
              <thead>
                <tr>
                  <th style={th}>계좌</th>
                  <th style={th}>평가</th>
                  {(['growth', 'income', 'satellite', 'cash'] as Group[]).map((g) => (
                    <th key={g} style={th}>
                      {GROUP_LABEL[g]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {view.accounts.map((a) => (
                  <tr key={a.key}>
                    <td style={td}>
                      {a.label}
                      {a.taxAdvantaged ? ' (절세)' : ''}
                    </td>
                    <td style={td}>{man(a.total)}</td>
                    {(['growth', 'income', 'satellite', 'cash'] as Group[]).map((g) => (
                      <td key={g} style={td}>
                        {a.byGroup[g] > 0 ? man(a.byGroup[g]) : '-'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>}

          <div style={box}>
            <strong>보유 분류</strong>
            <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 6 }}>
              <thead>
                <tr>
                  <th style={th}>종목</th>
                  <th style={th}>계좌</th>
                  <th style={th}>분류</th>
                  <th style={th}>평가 · 비중</th>
                </tr>
              </thead>
              <tbody>
                {view.holdings.map((h) => (
                  <tr key={`${h.accountLabel}-${h.code}`}>
                    <td style={td}>
                      {h.name} <span style={{ color: 'var(--color-text-tertiary)' }}>{h.code}</span>
                    </td>
                    <td style={td}>{h.accountLabel}</td>
                    <td style={td}>{view.buckets.find((b) => b.bucket === h.bucket)?.label ?? h.bucket}</td>
                    <td style={td}>
                      {man(h.value)} · {pct(h.pct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <div style={{ marginTop: 4, color: 'var(--color-text-tertiary)' }}>
              분류는 종목 이름으로 정합니다(예: "커버드콜"·"프리미엄" → 커버드콜, "배당" → 배당, S&amp;P500·나스닥100 → 해외 지수). 다르게 잡힌 종목이 있으면 알려 주세요.
            </div>
          </div>
          </Collapsible>
        </>
      )}

      <Collapsible className="ig-collapsible" title="설정" hint={`단계: ${view.stage.title} · 월 목표 인컴 ${man(view.settings.monthlyNeed)} · 목표 비중`} defaultOpen={view.holdingCount === 0}>
        {settingsBox}
      </Collapsible>

      <div style={{ ...box, color: 'var(--color-text-tertiary)' }}>
        과거 결과는 미래를 보장하지 않으며, 이 화면은 주문을 내지 않는 안내입니다.
        <More label="근거 (2026-10-01 검증, 10-06 보정)">코스피와 S&amp;P500(원화)은 2003~2026 연수익이 같았고(12.0%), 반반 매년 리밸런싱이 5년 최악을 가장 줄였습니다.
        리밸런싱은 수익보다 낙폭을 줄였습니다(−41.7%→−36.4%). 국내 고배당 3종에서 같은 생활비를 10년 꺼내 쓰면 2010~2016 시작점 대부분에서
        지수와 비슷하거나 원금을 더 남겼지만(분배금 세금 포함), 지수가 크게 오른 구간에서는 뒤졌습니다. 커버드콜은 장기로 연 4~11%p 뒤처졌습니다.
        </More>
      </div>
    </div>
  )
}
