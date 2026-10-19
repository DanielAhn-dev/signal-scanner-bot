import { useEffect, useRef, useState } from 'react'
import { Check, ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { formatKrwMan } from '../../lib/format'
import { useUserState } from '../../lib/userState'
import { useCurrentChatId, useCurrentClientId } from '../../stores/profileStore'
import { EMPTY_STATE, currentYmKst, upsertMonth, type AccumulateState } from '../../lib/accumulate'
import {
  DISTRIBUTION_TAX_RATE,
  doneMonths,
  extraUnitsPct,
  monthGrid,
  pensionCredit,
  streak,
  type MonthCell,
} from '../../../../src/lib/savingProgress'
import './saving-progress.css'

/**
 * "내 모으기" — 시장과 상관없이 늘어나는 숫자(넣은 원금·이어서 넣은 달·세금으로 아끼는 돈)를 크게,
 * 평가금은 맨 아래 작게 둔다. 수익률을 자주 볼수록 손실을 크게 느껴 그만두기 쉽기 때문이다.
 * 홈(variant="home")은 요약, 모아가기(variant="full")는 2년 달력·세금 계산 근거까지.
 * 계산은 src/lib/savingProgress.ts, 서버 값은 /api/ui/saving-progress, 체크인은 user-state 'accumulate'.deposits.
 */
export type SavingProgressData = {
  principal: { cost: number; cash: number; total: number }
  value: { holdings: number; total: number; pnlPct: number | null }
  holdingCount: number
  buyMonths: string[]
  receipts: { total: number; months: number; since: string | null }
  tax: {
    pensionMonthly: number | null
    distribution: { tr: number; isa: number; pension: number }
    underlyingYieldPct: number | null
    accountKinds: string[]
  }
  goal: { requiredSeed: number; monthlyNeed: number } | null
  plan: { monthly: number; depositDay: number } | null
  market: { asOf: string; fromHighPct: number } | null
}

const man = formatKrwMan
const STATE_LABEL: Record<MonthCell['state'], string> = { done: '넣음', missed: '쉰 달', pending: '이번 달 남음', future: '', before: '기록 전' }

function MonthStrip({ cells }: { cells: MonthCell[] }) {
  return (
    <span className="sp-strip" role="list">
      {cells.map((c) => (
        <span key={c.ym} role="listitem" className={`sp-cell sp-cell--${c.state}`} title={`${c.ym} ${STATE_LABEL[c.state]}`} aria-label={`${Number(c.ym.slice(5))}월 ${STATE_LABEL[c.state] || '앞으로'}`} />
      ))}
    </span>
  )
}

export default function SavingProgressCard({ variant = 'home' }: { variant?: 'home' | 'full' }) {
  const navigate = useNavigate()
  const chatId = useCurrentChatId()
  const clientId = useCurrentClientId()
  const [data, setData] = useState<SavingProgressData | null>(null)
  const [loadError, setLoadError] = useState(false)
  const { value: accRaw, set: setAcc } = useUserState<AccumulateState>('accumulate')
  const acc: AccumulateState = { ...EMPTY_STATE, ...(accRaw ?? {}) }
  const [otherOpen, setOtherOpen] = useState(false)
  const [otherText, setOtherText] = useState('')
  const savingRef = useRef(false)
  const ym = currentYmKst()

  useEffect(() => {
    if (!chatId && !clientId) return
    let active = true
    setLoadError(false)
    apiFetch('/api/ui?route=saving-progress', { cacheMs: 60_000, timeoutMs: 20_000, retries: 1 })
      .then((res) => { if (active && res?.data?.principal) setData(res.data as SavingProgressData) })
      .catch(() => { if (active) setLoadError(true) })
    return () => { active = false }
  }, [chatId, clientId])

  if (loadError) return <section className="sp sp--muted" aria-label="내 모으기">내 모으기를 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.</section>
  if (!data) return null

  const done = doneMonths({ deposits: acc.deposits, buyMonths: data.buyMonths })
  const run = streak(done, ym)
  const grid = monthGrid(done, ym, variant === 'full' ? 2 : 1)
  const thisMonth = acc.deposits.find(([m]) => m === ym)?.[1] ?? 0
  const boughtThisMonth = data.buyMonths.includes(ym)
  const planMonthly = data.plan?.monthly ?? 0

  const checkIn = (amount: number) => {
    if (savingRef.current || !(amount > 0)) return
    savingRef.current = true
    setAcc({ ...acc, deposits: upsertMonth(acc.deposits, ym, amount) })
    setOtherOpen(false)
    setOtherText('')
    savingRef.current = false
  }
  const undo = () => setAcc({ ...acc, deposits: upsertMonth(acc.deposits, ym, 0) })

  const pension = data.tax.pensionMonthly != null ? pensionCredit(data.tax.pensionMonthly * 12) : null
  const dist = data.tax.distribution
  const distSum = dist.tr + dist.isa + dist.pension
  const taxYear = (pension?.low ?? 0) + distSum
  const goalPct = data.goal ? Math.min(100, (data.principal.total / data.goal.requiredSeed) * 100) : null
  const extra = data.market && data.market.fromHighPct <= -10 ? extraUnitsPct(data.market.fromHighPct) : 0
  const noHoldings = data.holdingCount === 0 && data.principal.cash === 0

  return (
    <section className={`sp sp--${variant}`} aria-label="내 모으기">
      <div className="sp__head">
        <span className="sp__title">내 모으기</span>
        <span className="sp__muted">{ym.replace('-', '.')}</span>
      </div>

      {/* 1. 넣은 원금 — 시장이 빠져도 줄지 않는 숫자 */}
      <div className="sp__principal">
        <span className="sp__label">넣은 원금</span>
        <strong className="sp__big">{noHoldings ? '아직 없음' : man(data.principal.total)}</strong>
        <span className="sp__muted">
          {noHoldings ? '내 계좌에 보유를 입력하면 여기에 쌓입니다' : `보유 매수금액 ${man(data.principal.cost)}${data.principal.cash > 0 ? ` + 예수금 ${man(data.principal.cash)}` : ''} · 시장이 빠져도 줄지 않는 숫자`}
        </span>
      </div>
      {data.goal && goalPct != null && (
        <div className="sp__goal">
          <span className="sp__bar" aria-hidden="true"><span style={{ width: `${Math.max(0, goalPct)}%` }} /></span>
          <span>목표 {man(data.goal.requiredSeed)}의 {goalPct < 10 ? goalPct.toFixed(1) : goalPct.toFixed(0)}%</span>
          <span className="sp__muted">월 {man(data.goal.monthlyNeed)} 꺼내 쓰기 기준 · 원금 기준</span>
        </div>
      )}

      {/* 2. 이번 달 — 체크인 하나가 주 행동 */}
      <div className="sp__month">
        {thisMonth > 0 ? (
          <span className="sp__done">
            <Check size={14} aria-hidden /> 이번 달 넣었어요 · {man(thisMonth)}
            <button type="button" className="sp__link" onClick={undo}>취소</button>
          </span>
        ) : (
          <>
            {planMonthly > 0 ? (
              <button type="button" className="sp__primary" onClick={() => checkIn(planMonthly)}>
                이번 달 넣었어요 ({man(planMonthly)})
              </button>
            ) : (
              <span className="sp__muted">이번 달 넣은 금액을 적어 주세요</span>
            )}
            {(otherOpen || planMonthly <= 0) ? (
              <span className="sp__other">
                <input type="number" inputMode="numeric" min="0" placeholder="금액(원)" value={otherText} onChange={(e) => setOtherText(e.target.value)} aria-label="이번 달 넣은 금액" />
                <button type="button" className="sp__secondary" disabled={!(Number(otherText) > 0)} onClick={() => checkIn(Math.round(Number(otherText)))}>기록</button>
              </span>
            ) : (
              <button type="button" className="sp__link" onClick={() => setOtherOpen(true)}>다른 금액</button>
            )}
            {data.plan && <span className="sp__muted">넣는 날 매달 {data.plan.depositDay}일{boughtThisMonth ? ' · 이번 달 매수 기록 있음' : ''}</span>}
          </>
        )}
      </div>

      {/* 3. 이어서 넣은 달 */}
      <div className="sp__streak">
        <span>
          {run.count > 0 ? <><strong>{run.count}개월</strong> 이어서 넣었어요</> : done.size > 0 ? '다시 이어 가는 달' : '첫 달을 기록해 보세요'}
          {run.pendingThisMonth && run.count > 0 ? <span className="sp__muted"> · 이번 달을 넣으면 {run.count + 1}개월</span> : null}
        </span>
        {grid.map((row) => (
          <span key={row.year} className="sp__year">
            {variant === 'full' && <span className="sp__muted">{row.year}</span>}
            <MonthStrip cells={row.months} />
          </span>
        ))}
      </div>

      {extra > 0 && (
        <p className="sp__drop">
          코스피가 고점보다 {Math.abs(data.market!.fromHighPct).toFixed(0)}% 낮아, 같은 돈으로 고점 때보다 약 {extra.toFixed(0)}% 더 많은 수량을 삽니다. 넣는 돈은 그대로 두는 것이 계획입니다.
        </p>
      )}

      {/* 4. 세금으로 아끼는 돈 */}
      {variant === 'home' ? (
        taxYear > 0 || data.receipts.total > 0 ? (
          <button type="button" className="sp__row" onClick={() => navigate('/accumulate#saving-tax')}>
            {taxYear > 0 && <span>세금으로 아끼는 돈 <strong>1년 약 {man(taxYear)}</strong></span>}
            {data.receipts.total > 0 && <span>받은 분배금 <strong>{man(data.receipts.total)}</strong></span>}
            <span className="sp__more">자세히 <ChevronRight size={12} aria-hidden /></span>
          </button>
        ) : null
      ) : (
        <div className="sp__tax" id="saving-tax">
          <div className="sp__subtitle">세금으로 아끼는 돈 (1년 기준, 추정)</div>
          <table className="sp__table">
            <tbody>
              <tr>
                <th scope="row">연금저축·IRP 세액공제</th>
                <td>
                  {pension == null ? <span className="sp__muted">예산을 불러오지 못했습니다</span>
                    : pension.base > 0 ? <>{man(pension.low)} ~ {man(pension.high)}</>
                    : <button type="button" className="sp__link" onClick={() => navigate('/budget')}>예산의 저축에 연금을 적으면 계산됩니다</button>}
                </td>
                <td className="sp__muted">{pension && pension.base > 0 ? `연 납입 ${man(pension.base)}(한도 900만원) × 13.2%, 총급여 5,500만원 이하면 16.5%` : ''}</td>
              </tr>
              <tr>
                <th scope="row">일반 계좌 TR형</th>
                <td>{dist.tr > 0 ? man(dist.tr) : '-'}</td>
                <td className="sp__muted">분배금이 지급되지 않아 원천징수 {Math.round(DISTRIBUTION_TAX_RATE * 1000) / 10}%를 미룹니다{data.tax.underlyingYieldPct != null ? ` · 같은 지수 일반형 분배율 ${data.tax.underlyingYieldPct.toFixed(2)}%(최근 12개월) 기준` : ''}</td>
              </tr>
              <tr>
                <th scope="row">ISA 안 분배금</th>
                <td>{dist.isa > 0 ? man(dist.isa) : '-'}</td>
                <td className="sp__muted">비과세 한도 안이라고 본 값{data.tax.accountKinds.includes('isa') ? '' : ' · 입력된 ISA 계좌 없음'}</td>
              </tr>
              <tr>
                <th scope="row">연금 계좌 안 분배금</th>
                <td>{dist.pension > 0 ? man(dist.pension) : '-'}</td>
                <td className="sp__muted">지금 떼지 않고 연금 받을 때 3.3~5.5%로 냅니다(미룸){data.tax.accountKinds.includes('pension') ? '' : ' · 입력된 연금 계좌 없음'}</td>
              </tr>
            </tbody>
          </table>
          <p className="sp__muted">
            분배금 세금은 지금 보유 평가금 × 최근 12개월 분배율 × 15.4%로 낸 추정이고, 분배금은 해마다 다릅니다. 세액공제는 예산에 적은 월 연금 저축 × 12로 계산합니다. 세법이 바뀌면 달라질 수 있습니다.
          </p>
          {data.receipts.total > 0 && (
            <p>받은 분배금 기록 {data.receipts.months}개월({data.receipts.since?.replace('-', '.')}부터) <strong>{man(data.receipts.total)}</strong> · 계획은 받은 분배금을 지수로 다시 넣는 것입니다.</p>
          )}
        </div>
      )}

      {/* 5. 평가금 — 맨 아래 작게 */}
      <div className="sp__foot">
        <span>
          평가금 {man(data.value.total)}
          {data.value.pnlPct != null ? ` (${data.value.pnlPct >= 0 ? '+' : ''}${data.value.pnlPct.toFixed(1)}%)` : ''} · 월 1회만 확인
        </span>
        {variant === 'home' ? (
          <span className="sp__links">
            <button type="button" className="sp__link" onClick={() => navigate('/accumulate#my-plan')}>계획 바꾸기</button>
            <button type="button" className="sp__link" onClick={() => navigate('/accumulate')}>자세히 <ChevronRight size={12} aria-hidden /></button>
          </span>
        ) : null}
      </div>
    </section>
  )
}
