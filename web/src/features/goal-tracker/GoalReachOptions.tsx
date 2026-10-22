import { useState } from 'react'
import { formatKrwMan } from '../../lib/format'
import { formatMonths, milestoneTargets, monthlyAfterYears, monthsToTarget, yearAfterMonths } from '../../lib/goalReach'

/**
 * 목표 트래커 '내 계획이면 언제 닿나' 아래(모아가기 4번에서 옮김) — 지금 계획으로 목표까지 언제, 더 빨리 닿는 선택지(넣는 돈 해마다 늘리기 · 지금 더 넣기)와 바로 따르는 버튼.
 * 수익률은 고를 수 없지만 넣는 돈은 고를 수 있다. 상품을 바꿔 줄이는 방법은 과거에 좋았던 것을 고르게 되기 쉬워 권하지 않는다.
 * 15년 넘는 길은 과거 적립 결과의 연평균(rates)으로 늘려 본 추정이다 (lib/goalReach.ts).
 */
export type ReachRates = { typical: number; low: number; years: number }
export type RaiseChoice = { pct: number; since: string; appliedYear?: number }

const RAISE_OPTIONS = [0.03, 0.05, 0.07]
const EXTRA_OPTIONS = [100_000, 300_000, 500_000]

export default function GoalReachOptions(props: {
  planMonthly: number
  target: number
  lump: number
  rates: ReachRates
  today: string
  raise: RaiseChoice | null
  onRaise: (next: RaiseChoice | null) => void
  onSavePlan: (monthly: number) => void
  saveMsg: string | null
  onOpenMix: () => void
}) {
  const { planMonthly, target, lump, rates, today, raise } = props
  const [raisePick, setRaisePick] = useState(raise?.pct ?? 0.05)
  const [extraPick, setExtraPick] = useState(300_000)

  const reach = (monthly: number, raisePct = 0, rate = rates.typical, goal = target) => monthsToTarget({ monthly, rate, raisePct, lump }, goal)
  const now = reach(planMonthly)
  const nowLow = reach(planMonthly, 0, rates.low)
  const raised = reach(planMonthly, raisePick)
  const extraMonthly = planMonthly + extraPick
  const extra = reach(extraMonthly)
  const when = (m: number | null) => (m == null ? '50년 안에 못 닿음' : `약 ${formatMonths(m)}(${yearAfterMonths(today, m)}년)`)
  const faster = (m: number | null) => (now != null && m != null && now - m >= 6 ? ` · ${formatMonths(now - m)} 빨라짐` : '')
  const path = milestoneTargets(target)
    .map((t) => ({ t, m: reach(planMonthly, 0, rates.typical, t) }))
    .map(({ t, m }) => `${formatKrwMan(t)} ${m == null ? '—' : formatMonths(m)}`)
    .join(' → ')

  return (
    <div className="acc-reach">
      <h3>지금 계획으로 {formatKrwMan(target)}까지</h3>
      <dl className="acc-facts">
        <div><dt>보통</dt><dd>{when(now)}</dd></div>
        <div><dt>운 나쁘면</dt><dd>{when(nowLow)}</dd></div>
        <div><dt>가는 길(보통)</dt><dd>{path}</dd></div>
      </dl>

      <h3>더 빨리 닿는 선택지</h3>
      <div className="acc-option">
        <div className="acc-option__head">
          <strong>넣는 돈을 해마다 늘리기</strong>
          <span className="acc-chips" role="radiogroup" aria-label="해마다 늘리는 비율">
            {RAISE_OPTIONS.map((r) => <button key={r} type="button" role="radio" aria-checked={raisePick === r} className={raisePick === r ? 'is-active' : ''} onClick={() => setRaisePick(r)}>{Math.round(r * 100)}%</button>)}
          </span>
        </div>
        <p>보통 {when(raised)}{faster(raised)}</p>
        <p className="acc-note">내년 매달 {formatKrwMan(monthlyAfterYears(planMonthly, raisePick, 1))}, 5년 뒤 {formatKrwMan(monthlyAfterYears(planMonthly, raisePick, 5))}. 월급이 오르는 만큼만 늘리면 부담이 덜합니다.</p>
        {raise ? (
          <p className="acc-note">매년 {Math.round(raise.pct * 100)}%씩 늘리기로 정했어요 · 해마다 1월 홈 &lsquo;이번 달 할 일&rsquo;에서 알려 드려요 <button type="button" className="acc-link" onClick={() => props.onRaise(null)}>그만두기</button></p>
        ) : (
          <button type="button" className="acc-secondary" onClick={() => props.onRaise({ pct: raisePick, since: today.slice(0, 7) })}>매년 {Math.round(raisePick * 100)}%씩 늘리기로 정하기</button>
        )}
      </div>

      <div className="acc-option">
        <div className="acc-option__head">
          <strong>지금 매달 더 넣기</strong>
          <span className="acc-chips" role="radiogroup" aria-label="더 넣을 금액">
            {EXTRA_OPTIONS.map((x) => <button key={x} type="button" role="radio" aria-checked={extraPick === x} className={extraPick === x ? 'is-active' : ''} onClick={() => setExtraPick(x)}>+{x / 10_000}만</button>)}
          </span>
        </div>
        <p>매달 {formatKrwMan(extraMonthly)}이면 보통 {when(extra)}{faster(extra)}</p>
        <button type="button" className="acc-secondary" onClick={() => props.onSavePlan(extraMonthly)}>내 계획을 매달 {formatKrwMan(extraMonthly)}으로 바꾸기</button>
      </div>
      {props.saveMsg && <p className="acc-note" role="status">{props.saveMsg}</p>}

      <p className="acc-note">
        {rates.years}년 넘는 길은 과거 {rates.years}년 적립 결과의 연평균(보통 {(rates.typical * 100).toFixed(1)}%, 운 나쁨 {(rates.low * 100).toFixed(1)}%)으로 늘려 본 추정입니다.
        수익률은 고를 수 없지만 넣는 돈은 고를 수 있습니다. 상품을 바꿔 필요 금액을 줄이는 방법은 과거에 좋았던 것을 고르게 되기 쉬워 여기서 권하지 않습니다(비중 실험은 <button type="button" className="acc-link" onClick={props.onOpenMix}>시뮬레이터</button>).
      </p>
    </div>
  )
}
