import { useEffect, useState } from 'react'
import AccountTag from '../../components/ui/AccountTag'
import { Check, ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { formatKrwMan } from '../../lib/format'
import { useUserState } from '../../lib/userState'
import { useCurrentChatId, useCurrentClientId } from '../../stores/profileStore'
import { EMPTY_STATE, currentYmKst, type AccumulateState } from '../../lib/accumulate'
import {
  DISTRIBUTION_TAX_RATE,
  costLadder,
  doneMonths,
  extraUnitsPct,
  monthGrid,
  pensionCredit,
  streak,
  type MonthCell,
} from '../../../../src/lib/savingProgress'
import type { IncomeCheckRow } from '../income-guide/IncomeProductCheck'
import IncomeTargetCard, { DEFAULT_INCOME_GOAL } from './IncomeTargetCard'
import './saving-progress.css'

/**
 * "내 모으기" — 시장과 상관없이 늘어나는 숫자(넣은 원금·이어서 넣은 달·세금으로 아끼는 돈)를 크게,
 * 평가금은 맨 아래 작게 둔다. 수익률을 자주 볼수록 손실을 크게 느껴 그만두기 쉽기 때문이다.
 * 홈(variant="home")은 요약, 모아가기(variant="full")는 2년 달력·세금 계산 근거까지.
 * 계산은 src/lib/savingProgress.ts, 서버 값은 /api/ui/saving-progress, 체크인은 user-state 'accumulate'.deposits.
 * 큰 숫자가 실감 나지 않는 시기를 위해 원금을 "대신 내 주는 우리 집 고정비"로 바꿔 보여 주고(사다리),
 * 그만두기 가장 쉬운 때(시장이 빠진 달)에 넣은 횟수를 센다. 홈은 한 줄씩, 모아가기는 전체 사다리.
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
  /** 코스피가 최근 60거래일 고점보다 10% 넘게 빠진 날이 있던 달, 판정 시작 달 */
  dropMonths?: { months: string[]; since: string } | null
  /** 고정비 사다리 재료 — fixed가 null이면 가계부 조회 실패(사다리 숨김) */
  ladder?: { fixed: Array<{ label: string; amount: number }> | null; withdrawalPct: number; addedThisMonth: number }
  /** 인컴 목표 재료 — 계좌별 연 분배금(세전)과 일반 계좌 인컴 상품 점검 */
  income?: { distribution: { general: number; isa: number; pension: number }; generalIncomeCapital?: number; check: IncomeCheckRow[] }
}

const man = formatKrwMan
/** 만원 아래 작은 금액도 0만원이 되지 않게 */
const manSmall = (v: number) => (v >= 10_000 ? man(v) : `${(Math.round(v / 1_000) * 1_000).toLocaleString('ko-KR')}원`)
const STATE_LABEL: Record<MonthCell['state'], string> = { done: '넣음', missed: '쉰 달', pending: '이번 달 남음', future: '', before: '기록 전' }

function MonthStrip({ cells }: { cells: MonthCell[] }) {
  return (
    <span className="sp__strip" role="list">
      {cells.map((c) => (
        <span key={c.ym} role="listitem" className={`sp__cell sp__cell--${c.state}`} title={`${c.ym} ${STATE_LABEL[c.state]}`} aria-label={`${Number(c.ym.slice(5))}월 ${STATE_LABEL[c.state] || '앞으로'}`} />
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
  const monthTask = acc.tasks?.[ym] ?? null


  const pension = data.tax.pensionMonthly != null ? pensionCredit(data.tax.pensionMonthly * 12) : null
  const dist = data.tax.distribution
  const distSum = dist.tr + dist.isa + dist.pension
  const taxYear = (pension?.low ?? 0) + distSum
  const goalPct = data.goal ? Math.min(100, (data.principal.total / data.goal.requiredSeed) * 100) : null
  const extra = data.market && data.market.fromHighPct <= -10 ? extraUnitsPct(data.market.fromHighPct) : 0
  const noHoldings = data.holdingCount === 0 && data.principal.cash === 0
  const ladder = !noHoldings && data.ladder?.fixed
    ? costLadder({ fixed: data.ladder.fixed, principal: data.principal.total, withdrawalPct: data.ladder.withdrawalPct, addedThisMonth: Math.max(data.ladder.addedThisMonth, thisMonth) })
    : null
  // 인컴 분배금이 먼저 덮는 칸 — 일반 계좌 분배금(세후)만 센다. ISA·연금·CMA 쪽은 안에서 재투자돼 고정비로 쓰지 않는다
  const incomeMonthly = data.income ? (data.income.distribution.general * (1 - DISTRIBUTION_TAX_RATE)) / 12 : 0
  const incomeCoveredCount = ladder ? ladder.rungs.filter((r) => r.cumulative <= incomeMonthly).length : 0
  const lastPassed = ladder && ladder.passedCount > 0 ? ladder.rungs[ladder.passedCount - 1] : null
  const dropDone = data.dropMonths ? data.dropMonths.months.filter((m) => done.has(m)).length : 0

  return (
    <section className={`sp sp--${variant}`} aria-label="내 모으기">
      <div className="sp__head">
        <span className="sp__title">내 모으기</span>
        <AccountTag kind="real" />
        <span className="sp__muted">{ym.replace('-', '.')}</span>
      </div>

      {/* 1. 넣은 원금 — 시장이 빠져도 줄지 않는 숫자 */}
      <div className="sp__principal">
        <span className="sp__label">넣은 원금</span>
        <strong className="sp__big">{noHoldings ? '아직 없음' : man(data.principal.total)}</strong>
        <span className="sp__muted">
          {noHoldings ? '내 계좌에 보유를 입력하면 여기에 쌓입니다. 봇이 사는 가상 계좌는 여기서 세지 않습니다' : `보유 매수금액 ${man(data.principal.cost)}${data.principal.cash > 0 ? ` + 예수금 ${man(data.principal.cash)}` : ''} · 시장이 빠져도 줄지 않는 숫자`}
        </span>
      </div>
      {data.goal && goalPct != null && (
        <div className="sp__goal">
          <span className="sp__bar" aria-hidden="true"><span style={{ width: `${Math.max(0, goalPct)}%` }} /></span>
          <span>목표 {man(data.goal.requiredSeed)}의 {goalPct < 10 ? goalPct.toFixed(1) : goalPct.toFixed(0)}%</span>
          <span className="sp__muted">월 {man(data.goal.monthlyNeed)} 꺼내 쓰기 기준 · 원금 기준</span>
        </div>
      )}

      {/* 1-1. 이 돈이 대신 내 주는 고정비 — 원금 × 인출률(목표 트래커와 같은 값) ÷ 12를 가계부 고정지출 계단에 대 본다 */}
      {ladder && (
        <div className="sp__ladder">
          {ladder.newlyPassed && (
            <span className="sp__done"><Check size={14} aria-hidden /> 이번 달로 {ladder.newlyPassed.label}까지 넘었어요</span>
          )}
          <span><span className="sp__label">이 돈이 대신 내 주는 고정비</span> <strong>월 {manSmall(ladder.monthly)}</strong></span>
          {ladder.rungs.length === 0 ? (
            <button type="button" className="sp__link" onClick={() => navigate('/budget')}>예산에 고정지출을 적으면 우리 집 고정비로 보여 줘요 <ChevronRight size={12} aria-hidden /></button>
          ) : variant === 'home' ? (
            <span className="sp__goal">
              {lastPassed && <span className="sp__passed"><Check size={12} aria-hidden /> {lastPassed.label}{ladder.passedCount > 1 ? `까지 ${ladder.passedCount}개` : ''}</span>}
              {ladder.next ? (
                <>
                  <span className="sp__bar" aria-hidden="true"><span style={{ width: `${ladder.next.pct}%` }} /></span>
                  <span>다음 {ladder.next.label} {ladder.next.pct < 10 ? ladder.next.pct.toFixed(1) : ladder.next.pct.toFixed(0)}%</span>
                </>
              ) : <span>적어 둔 고정비를 모두 넘었어요</span>}
            </span>
          ) : (
            <ol className="sp__rungs">
              {ladder.rungs.map((r, i) => {
                const passed = i < ladder.passedCount
                const isNext = i === ladder.passedCount
                return (
                  <li key={r.label} className={passed ? 'is-passed' : ''}>
                    <span className="sp__rung-name">{passed ? <Check size={12} aria-label="넘음" /> : null}{r.label} {man(r.amount)}
                      {incomeCoveredCount > 0 && i === incomeCoveredCount - 1 && (
                        <span className="sp__muted"> ← 인컴계좌 분배금(월 {manSmall(incomeMonthly)})을 쓴다면 여기까지</span>
                      )}
                    </span>
                    {isNext && ladder.next ? (
                      <span className="sp__goal">
                        <span className="sp__bar" aria-hidden="true"><span style={{ width: `${ladder.next.pct}%` }} /></span>
                        <span className="sp__muted">누적 {man(r.cumulative)}의 {ladder.next.pct < 10 ? ladder.next.pct.toFixed(1) : ladder.next.pct.toFixed(0)}%</span>
                      </span>
                    ) : <span className="sp__muted">누적 {man(r.cumulative)}</span>}
                  </li>
                )
              })}
            </ol>
          )}
          {variant === 'full' && (
            <span className="sp__muted">
              넣은 원금 × 연 {data.ladder!.withdrawalPct}% ÷ 12(목표와 같은 꺼내 쓰기 비율). 예산의 고정지출을 작은 것부터 쌓았습니다. 원금 기준이라 시장이 빠져도 줄지 않습니다.{incomeCoveredCount > 0 && ' 인컴 표시는 지금은 재투자 중이지만 훗날 생활비로 쓴다고 가정했을 때, 일반 계좌(인컴계좌) 분배금(세후)이 위 칸부터 먼저 덮는 곳까지입니다. ISA·IRP·CMA 안의 분배금은 계속 재투자되는 몫이라 세지 않습니다.'} 지금 꺼내 쓰라는 뜻이 아니라, 모은 돈의 크기를 생활비로 바꿔 본 것입니다.
            </span>
          )}
        </div>
      )}

      {/* 1-2. 분배금으로 덮을 고정비 — 모아가기에서만. 일반 계좌 금융소득 세금 선과 점검 통과 후보를 사다리에 이어 붙인다 */}
      {variant === 'full' && !noHoldings && data.ladder?.fixed && data.ladder.fixed.length > 0 && data.income && (
        <IncomeTargetCard
          fixed={data.ladder.fixed}
          generalGross={data.income.distribution.general}
          generalCapital={data.income.generalIncomeCapital ?? 0}
          monthlyDeposit={data.plan?.monthly ?? 0}
          check={data.income.check}
          goal={{ ...DEFAULT_INCOME_GOAL, ...(acc.incomeGoal ?? {}) }}
          onGoal={(next) => setAcc({ ...acc, incomeGoal: next })}
        />
      )}

      {/* 2. 이번 달 — 기록은 홈 '이번 달 할 일' 한 곳에서만 (예전 체크인 버튼과 두 번 기록하지 않게) */}
      <div className="sp__month">
        {monthTask?.status === 'bought' ? (
          <span className="sp__done"><Check size={14} aria-hidden /> 이번 달 샀어요 · {monthTask.name ?? ''} {monthTask.qty}주</span>
        ) : monthTask?.status === 'skipped' ? (
          <span className="sp__muted">이번 달은 건너뛰었어요</span>
        ) : monthTask?.status === 'later' ? (
          <span className="sp__muted">내 계좌는 다음 달부터 시작해요</span>
        ) : thisMonth > 0 ? (
          <span className="sp__done"><Check size={14} aria-hidden /> 이번 달 넣었어요 · {man(thisMonth)}</span>
        ) : variant === 'full' ? (
          <>
            <span className="sp__muted">{data.plan ? `넣는 날 매달 ${data.plan.depositDay}일` : '이번 달 기록 없음'}{boughtThisMonth ? ' · 이번 달 매수 기록 있음' : ''}</span>
            <button type="button" className="sp__link" onClick={() => navigate('/')}>이번 달 할 일은 홈에서 <ChevronRight size={12} aria-hidden /></button>
          </>
        ) : null}
      </div>

      {/* 3. 이어서 넣은 달 */}
      <div className="sp__streak">
        <span>
          {run.count > 0 ? <><strong>{run.count}개월</strong> 이어서 넣었어요</> : done.size > 0 ? '다시 이어 가는 달' : '첫 달을 기록해 보세요'}
          {run.pendingThisMonth && run.count > 0 ? <span className="sp__muted"> · 이번 달을 넣으면 {run.count + 1}개월</span> : null}
        </span>
        {dropDone > 0 && (
          <span>
            코스피가 고점보다 10% 넘게 빠진 달에도 <strong>{dropDone}번</strong> 넣었어요
            {variant === 'full' && data.dropMonths ? <span className="sp__muted"> · 가장 그만두기 쉬운 때입니다 ({data.dropMonths.since.replace('-', '.')}부터 셈)</span> : null}
          </span>
        )}
        {grid.map((row) => (
          <span key={row.year} className="sp__year">
            {variant === 'full' && <span className="sp__muted">{row.year}</span>}
            <MonthStrip cells={row.months} />
          </span>
        ))}
      </div>

      {extra > 0 && (
        <p className="sp__drop">
          코스피가 최근 60거래일 고점보다 {Math.abs(data.market!.fromHighPct).toFixed(0)}% 낮아, 같은 돈으로 고점 때보다 약 {extra.toFixed(0)}% 더 많은 수량을 삽니다. 넣는 돈은 그대로 두는 것이 계획입니다.
        </p>
      )}

      {/* 4. 세금으로 아끼는 돈 */}
      {variant === 'home' ? (
        taxYear > 0 || data.receipts.total > 0 ? (
          <button type="button" className="sp__row" onClick={() => navigate('/accumulate#saving-tax')}>
            {taxYear > 0 && <span>세금으로 아끼는 돈 <strong>1년 약 {man(taxYear)}</strong></span>}
            {data.receipts.total > 0 && <span>받은 분배금 <strong>{man(data.receipts.total)}</strong></span>}
            <span className="sp__more">계산 보기 <ChevronRight size={12} aria-hidden /></span>
          </button>
        ) : null
      ) : (
        <div className="sp__tax" id="saving-tax">
          <div className="sp__subtitle">세금으로 아끼는 돈 (1년 기준, 추정)</div>
          <table className="sp__table">
            <tbody>
              <tr>
                <th scope="row">연금저축·IRP 세액공제</th>
                {/* 금액 칸은 다른 줄처럼 금액이나 '-'만, 안내는 설명 칸에 (금액 칸에 문장을 넣으면 좁게 접히고 설명 칸이 비었다) */}
                <td>{pension && pension.base > 0 ? <>{man(pension.low)} ~ {man(pension.high)}</> : '-'}</td>
                <td className="sp__muted">
                  {pension == null ? '예산을 불러오지 못했습니다'
                    : pension.base > 0 ? `연 납입 ${man(pension.base)}(한도 900만원) × 13.2%, 총급여 5,500만원 이하면 16.5%`
                    : <button type="button" className="sp__link" onClick={() => navigate('/budget')}>예산의 저축에 연금을 적으면 계산됩니다</button>}
                </td>
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
            <button type="button" className="sp__link" onClick={() => navigate('/accumulate')}>모아가기 전체 <ChevronRight size={12} aria-hidden /></button>
          </span>
        ) : null}
      </div>
    </section>
  )
}
