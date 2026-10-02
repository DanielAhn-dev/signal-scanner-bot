import React, { useCallback, useEffect, useState } from 'react'
import { formatKrwMan } from '../../lib/format'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import Button from '../../components/ui/Button'
import { useCurrentChatId } from '../../stores/profileStore'

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
type Unfilled = { group: Group; bucket?: string; amount: number }
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
  }
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
  history?: Array<{ date: string; total: number; groups: Array<{ group: Group; actualPct: number; targetPct: number }>; note?: string }>
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
  buckets: Array<{ bucket: string; label: string; value: number; pct: number }>
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
  holdings: Array<{ code: string; name: string; accountLabel: string; value: number; label?: string; bucket: string; group: Group; pct: number }>
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
export default function IncomeGuidePage() {
  const chatId = useCurrentChatId()
  const navigate = useNavigate()
  const [view, setView] = useState<View | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({ needMan: '', incomeStart: '', satCap: '', overseas: '', incomePct: '', cashPct: '', capMan: '', ageBand: '' })
  const [contribMan, setContribMan] = useState('')
  const [appliedContrib, setAppliedContrib] = useState(0)
  const [note, setNote] = useState('')
  const [recordMsg, setRecordMsg] = useState<string | null>(null)

  const load = useCallback(async (init?: { method: string; body: string }, contribution = 0): Promise<boolean> => {
    try {
      const q = contribution > 0 ? `?contribution=${Math.round(contribution)}` : ''
      const res = await apiFetch(`/api/ui/income-guide${q}`, { cacheMs: 0, timeoutMs: 20_000, ...(init ?? {}) })
      if (!res?.data) {
        setError(res?.error ?? '가이드를 불러오지 못했습니다.')
        return false
      }
      setView(res.data)
      setError(null)
      return true
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
      return false
    }
  }, [])

  useEffect(() => {
    if (chatId) void load()
  }, [chatId, load])

  const startEdit = () => {
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
    setEditing(true)
  }
  const save = async () => {
    setBusy(true)
    const ok = await load(
      {
        method: 'POST',
        body: JSON.stringify({
          monthlyNeed: Number(form.needMan) * 10_000,
          incomeStart: form.incomeStart,
          satelliteCapPct: Number(form.satCap),
          overseasPct: Number(form.overseas),
          // 빈 칸은 단계 기본값으로 되돌린다
          customTargets: { income: form.incomePct, cash: form.cashPct },
          financialIncomeCap: Number(form.capMan) * 10_000,
          ageBand: form.ageBand,
        }),
      },
      appliedContrib,
    )
    setBusy(false)
    if (ok) setEditing(false)
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

  return (
    <div style={{ paddingBottom: 24 }}>
      <div style={box}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <strong style={{ fontSize: 14 }}>
            {view.targetSource === 'custom' ? '내 목표 비중 · ' : ''}단계: {view.stage.title}
            {view.stage.yearsToIncome != null && view.stage.yearsToIncome > 0 ? ` · 인컴 시작까지 ${view.stage.yearsToIncome.toFixed(1)}년` : ''}
          </strong>
          {!editing && (
            <Button size="sm" variant="secondary" onClick={startEdit}>
              가이드 설정
            </Button>
          )}
        </div>
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
            <input style={inputStyle} value={form.overseas} onChange={(e) => setForm({ ...form, overseas: e.target.value })} />
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
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              취소
            </Button>
            <div style={{ width: '100%', color: 'var(--color-text-tertiary)' }}>
              나이대는 생년월일 대신 구간만 받습니다. 고르면 모으기·전환 단계의 현금성 목표 비중에 나이대별 하한(20대 10% … 60대 이상 60%)이 붙습니다.
              "내 목표"는 엑셀로 쓰던 비중이 있으면 넣으세요. 비우면 단계 기본값이고, 성장(지수)은 나머지로 채웁니다.
              인컴 시작 월을 비워 두면 계속 모으는 단계로 봅니다. 시작 5년 전부터 매년 한 번 분배형·현금성 비중을 계단식으로 늘립니다.
              해외 비중 기본 50%는 2003~2026 코스피·S&amp;P500(원화) 반반이 5년 최악을 가장 줄였기 때문입니다.
            </div>
          </div>
        )}
        <div>
          계좌 보유 {view.holdingCount}개 · 평가 {man(view.total)} · 월 {man(view.settings.monthlyNeed)} 생활비에 필요한 원금: 분배형만으로{' '}
          {man(view.need.capitalByDistribution)}(분배율 4.5%) · 지수에서 연 4%씩 꺼내면 {man(view.need.capitalByWithdrawal4)}
        </div>
        {view.priceFallbacks ? (
          <div style={{ color: 'var(--color-text-tertiary)' }}>실시간가를 못 받은 {view.priceFallbacks}개는 종가나 매수가로 평가했습니다.</div>
        ) : null}
      </div>

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
              {view.growthSplit.targetGlobalPct}%)
            </div>
            <div style={{ marginTop: 2, color: 'var(--color-text-tertiary)' }}>
              세부: {view.buckets.map((b) => `${b.label} ${pct(b.pct)}`).join(' · ')}
            </div>
          </div>

          <div style={{ ...box, borderColor: view.rebalance.needed ? 'var(--color-error)' : 'var(--color-border-default)' }}>
            <strong>{view.rebalance.needed ? '지금 옮기는 것이 좋습니다' : '정기 점검 때 맞추면 됩니다'}</strong>
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
              <div key={i} style={{ color: 'var(--color-text-secondary)' }}>
                새 상품으로 채울 금액: {GROUP_LABEL[u.group]}
                {u.bucket === 'global_index' ? '(해외 지수)' : u.bucket === 'kr_index' ? '(국내 지수)' : ''} {man(u.amount)} — {BUY_HINT[u.group]}
              </div>
            ))}
            <div style={{ marginTop: 4, color: 'var(--color-text-tertiary)' }}>
              손실 중인지 수익 중인지가 아니라 비중으로 정합니다. 새로 넣는 돈으로 모자란 바구니를 먼저 채우면 팔지 않고도 맞출 수 있습니다.
              국내 주식형 ETF끼리는 매매차익이 비과세라 일반 계좌에서도 옮기는 비용이 거의 없습니다.
            </div>
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
              분배율은 바구니별 가정(고배당 4.5%, 커버드콜 8.5%, 리츠·인프라 6.5%, 국내 지수 2%, 해외 지수 1.2%)이라 실제와 다를 수 있습니다.
              분배금으로 ISA·연금 납입을 채우고 남는 돈은 지수형(KODEX 200 TR 등)으로 사면, 과세 소득을 늘리지 않고 원금을 키울 수 있습니다.
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
                  <div key={i} style={{ color: 'var(--color-text-secondary)' }}>
                    새 상품으로 채울 금액: {GROUP_LABEL[u.group]}
                    {u.bucket === 'global_index' ? '(해외 지수)' : u.bucket === 'kr_index' ? '(국내 지수)' : ''} {man(u.amount)} — {BUY_HINT[u.group]}
                  </div>
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

          <div style={box}>
            <strong>점검 기록</strong>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
              메모
              <input style={{ width: 220 }} placeholder="예: 연 1회 점검, 위성 300만 정리" value={note} onChange={(e) => setNote(e.target.value)} />
              <Button size="sm" disabled={busy} onClick={() => void record()}>
                오늘 비중 기록
              </Button>
              {recordMsg && <span style={{ color: 'var(--color-text-secondary)' }}>{recordMsg}</span>}
            </div>
            {view.history && view.history.length > 0 ? (
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
                  {[...view.history].reverse().slice(0, 12).map((h) => (
                    <tr key={h.date}>
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
                      <td style={td}>{h.note ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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

          <div style={box}>
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
          </div>

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
        </>
      )}

      <div style={{ ...box, color: 'var(--color-text-tertiary)' }}>
        근거(2026-10-01 검증): 코스피와 S&amp;P500(원화)은 2003~2026 연수익이 같았고(12.0%), 반반 매년 리밸런싱이 5년 최악을 가장 줄였습니다.
        리밸런싱은 수익보다 낙폭을 줄였습니다(−41.7%→−36.4%). 분배형은 횡보장에서 같은 생활비에 원금을 더 남겼지만 랠리에서 크게 뒤졌고,
        커버드콜은 장기로 연 4~11%p 뒤처졌습니다. 과거 결과는 미래를 보장하지 않으며, 이 화면은 주문을 내지 않는 안내입니다.
      </div>
    </div>
  )
}
