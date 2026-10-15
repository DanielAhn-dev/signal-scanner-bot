import type { SeedPlan, SeedPlanItem } from '../../../../src/lib/moneyFlow'

export type PlanKey = 'fixedCost' | 'variableCost' | 'irregularFund' | 'emergencyRefill'
export const PLAN_LABELS: Array<{ key: PlanKey; label: string }> = [
  { key: 'fixedCost', label: '고정비' },
  { key: 'variableCost', label: '변동 지출' },
  { key: 'irregularFund', label: '비정기 적립' },
  { key: 'emergencyRefill', label: '비상금 채우기' },
]

const monthName = (month: string) => `${Number(month.slice(5))}월`
const planTotal = (plan: SeedPlan, key: PlanKey) =>
  key === 'fixedCost' ? plan.fixed.total : key === 'variableCost' ? plan.variable.total : key === 'irregularFund' ? plan.irregularFund.total : plan.emergency.total

/**
 * 예상 지출 세 줄(+ 비상금 채우기). 합계로 투자 여력을 보되, 줄마다 펼치면 무엇이 들어갔는지(항목·출처)가 보인다.
 * 내역은 저장할 때 기록에 함께 남아, 나중에 점검을 고쳐도 지난 달 숫자의 근거가 바뀌지 않는다.
 */
export default function SeedPlanLines({ values, plan, filled, onChange, krw }: {
  values: Record<PlanKey, number>
  plan: SeedPlan | null
  /** 이 내역으로 채웠거나 저장한 상태인지 — 아니면 계산값을 '채우면 ○원'으로만 보여 준다 */
  filled: boolean
  onChange: (key: PlanKey, value: number) => void
  krw: (amount: number) => string
}) {
  const list = (items: SeedPlanItem[]) => (
    <ul className="seed-plan-items">{items.map((item) => <li key={item.label}><span>{item.label}</span><span>{krw(item.amount)}</span></li>)}</ul>
  )
  const detail = (key: PlanKey) => {
    if (!plan) return null
    if (key === 'fixedCost') {
      if (!plan.checkDate) return null
      return { summary: `지금 상태 점검(${plan.checkDate}) 고정지출`, body: list(plan.fixed.items) }
    }
    if (key === 'variableCost') {
      const v = plan.variable
      if (v.source === 'none') return null
      if (v.source === 'check') return { summary: `${monthName(plan.baseMonth)} 합계가 없어 점검의 변동지출 값`, body: <p className="seed-payday-help">돈 흐름에 {monthName(plan.baseMonth)} 카드 합계를 적으면 실제 지출로 다시 계산합니다.</p> }
      return {
        summary: `${monthName(plan.baseMonth)} 돈 흐름: 지출 ${krw(v.spending)} − 고정 ${krw(v.fixedSub)} − 비정기 ${krw(v.irregularSub)}`,
        body: (
          <>
            {list([...v.cards, ...(v.cash > 0 ? [{ label: '현금(세부 기록)', amount: v.cash }] : []), ...(v.outsideCard > 0 ? [{ label: '카드 밖 고정비(계좌 자동이체)', amount: v.outsideCard }] : [])])}
            {v.recorded.length > 0 && <><p className="seed-payday-help">세부로 적은 변동 지출</p>{list(v.recorded)}</>}
            {v.unrecorded > 0 && <p className="seed-payday-help">카드 중 세부 안 적음 {krw(v.unrecorded)}</p>}
          </>
        ),
      }
    }
    if (key === 'irregularFund') {
      if (plan.irregularFund.items.length === 0) return null
      return {
        summary: '1년 예산 ÷ 12 (지금 상태 점검의 비정기 지출)',
        body: (
          <ul className="seed-plan-items">
            {plan.irregularFund.items.map((item) => (
              <li key={item.label}><span>{item.label} <small>{krw(item.yearly)}/년{item.months.length > 0 ? ` · ${item.months.join('·')}월` : ''}</small></span><span>월 {krw(item.amount)}</span></li>
            ))}
          </ul>
        ),
      }
    }
    if (plan.emergency.items.length === 0) return null
    return { summary: `${monthName(plan.baseMonth)}에 1년 예산 밖으로 나간 비정기 — 비상금을 다시 채움`, body: list(plan.emergency.items) }
  }

  return (
    <div className="seed-plan-lines" role="group" aria-label="예상 지출">
      {PLAN_LABELS.map(({ key, label }) => {
        const d = detail(key)
        const computed = plan ? planTotal(plan, key) : null
        const edited = filled && computed !== null && d !== null && values[key] !== computed
        const preview = !filled && computed !== null && d !== null && computed !== values[key]
        return (
          <div key={key} className="seed-plan-line">
            <label>{label}<span className="seed-amount"><input type="number" inputMode="numeric" min="0" step="1000" aria-label={label} value={values[key] || ''} placeholder="0" onChange={(event) => { const value = Number(event.target.value); onChange(key, Number.isFinite(value) ? value : 0) }} /><span>원</span></span></label>
            {d && (
              <details className="seed-plan-detail">
                <summary>{d.summary}{edited && <em> · 직접 고침(계산값 {krw(computed!)})</em>}{preview && <em> · 채우면 {krw(computed!)}</em>}</summary>
                {d.body}
              </details>
            )}
          </div>
        )
      })}
    </div>
  )
}
