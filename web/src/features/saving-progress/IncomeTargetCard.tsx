import type { CSSProperties } from 'react'
import More from '../../components/ui/More'
import { formatKrwMan } from '../../lib/format'
import type { IncomeCheckRow } from '../income-guide/IncomeProductCheck'
import type { AccumulateState } from '../../lib/accumulate'
import { FINANCIAL_INCOME_LIMIT, LIMIT_SAFETY, incomeTargetPlan, splitAmount, type RungGap } from '../../../../src/lib/incomeTarget'

/**
 * "인컴으로 덮을 고정비" — 고정비 사다리를 분배금으로 덮으려 할 때, 다음 칸까지 더 필요한 원금과
 * 일반 계좌 금융소득 세금 선(직장 2,000만원·지역 1,000만원) 안에서 어디까지 닿는지, 점검을 통과한 후보를 보여 준다.
 * 계산은 src/lib/incomeTarget.ts. 매수 지시가 아니라 점검 결과를 목표에 이어 놓은 안내다.
 */
export type IncomeGoal = NonNullable<AccumulateState['incomeGoal']>
export const DEFAULT_INCOME_GOAL: IncomeGoal = { targetLabel: null, taxProfile: 'worker', yieldPct: 8 }
const YIELD_OPTIONS = [6, 7, 8, 10]

const man = formatKrwMan
const muted: CSSProperties = { color: 'var(--color-text-secondary)' }
const faint: CSSProperties = { color: 'var(--color-text-tertiary)', fontSize: 12 }
const select: CSSProperties = { font: 'inherit', padding: '2px 6px', border: '1px solid var(--color-border-default)', borderRadius: 6, background: 'transparent', color: 'inherit' }
const manSmall = (v: number) => (v >= 10_000 ? man(v) : `${(Math.round(v / 1_000) * 1_000).toLocaleString('ko-KR')}원`)

function GapLine({ title, gap, yieldPct }: { title: string; gap: RungGap; yieldPct: number }) {
  if (gap.gapMonthly <= 0) return <div>{title} <strong>{gap.label}</strong> — 이미 덮고 있어요</div>
  return (
    <div>
      {title} <strong>{gap.label}</strong>(누적 월 {man(gap.cumulative)}) — 월 {manSmall(gap.gapMonthly)} 부족, 분배율 {yieldPct}% 기준 새 돈 약 <strong>{man(gap.extraCapital)}</strong>
      {!gap.withinLimit && <span style={{ color: 'var(--color-warning)' }}> · 일반 계좌 세금 선 밖</span>}
    </div>
  )
}

export default function IncomeTargetCard({
  fixed,
  generalGross,
  check,
  goal,
  onGoal,
}: {
  fixed: Array<{ label: string; amount: number }>
  generalGross: number
  check: IncomeCheckRow[]
  goal: IncomeGoal
  onGoal: (next: IncomeGoal) => void
}) {
  const plan = incomeTargetPlan({ fixed, targetLabel: goal.targetLabel, taxProfile: goal.taxProfile, generalGrossAnnual: generalGross, yieldPct: goal.yieldPct })
  if (plan.ladder.rungs.length === 0) return null
  const limitMan = man(plan.limitAnnual)
  // 다음 칸까지 더 담을 돈을 후보에게 나눈다 — 세금 선까지 남은 원금을 넘지 않게
  const addAmount = plan.next ? Math.min(plan.next.extraCapital, plan.roomCapital) : 0
  const split = splitAmount(check, addAmount)
  const cappedByLimit = plan.next != null && plan.next.extraCapital > plan.roomCapital
  const statusText =
    plan.status === 'over' ? `세금 선(${limitMan})을 이미 넘었습니다. 더 담기 전에 세무 확인이 먼저입니다`
    : plan.status === 'near' ? `선의 80%를 넘었습니다. 더 담기 전에 남은 여유를 확인하세요`
    : `선까지 여유가 있습니다`

  return (
    <div className="sp__ladder">
      <span><span className="sp__label">인컴으로 덮을 고정비</span> <span style={faint}>일반 계좌 분배금 추정</span></span>

      <span style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
        <label>덮을 칸{' '}
          <select style={select} value={goal.targetLabel ?? ''} onChange={(e) => onGoal({ ...goal, targetLabel: e.target.value || null })}>
            <option value="">정하지 않음</option>
            {plan.ladder.rungs.map((r) => <option key={r.label} value={r.label}>{r.label}까지</option>)}
          </select>
        </label>
        <label>건강보험{' '}
          <select style={select} value={goal.taxProfile} onChange={(e) => onGoal({ ...goal, taxProfile: e.target.value as IncomeGoal['taxProfile'] })}>
            <option value="worker">직장가입자</option>
            <option value="regional">지역가입자</option>
          </select>
        </label>
        <label>분배율 가정{' '}
          <select style={select} value={goal.yieldPct} onChange={(e) => onGoal({ ...goal, yieldPct: Number(e.target.value) })}>
            {YIELD_OPTIONS.map((y) => <option key={y} value={y}>{y}%</option>)}
          </select>
        </label>
      </span>

      <div>
        지금 일반 계좌 분배금 <strong>월 {manSmall(plan.monthlyNow)}</strong>(세후) · 연 {man(generalGross)} / 세금 선 {limitMan}의 {Math.round(plan.usedPct)}%(여유 {Math.round(LIMIT_SAFETY * 100)}% 기준)
        <span className="sp__bar" aria-hidden="true" style={{ display: 'block', marginTop: 4 }}><span style={{ width: `${Math.min(100, plan.usedPct)}%` }} /></span>
        <span style={plan.status === 'ok' ? muted : { color: 'var(--color-warning)' }}>{statusText}</span>
      </div>

      {plan.next ? <GapLine title="다음 칸" gap={plan.next} yieldPct={goal.yieldPct} /> : <div>적어 둔 고정비를 모두 넘었어요</div>}
      {plan.target && plan.target.label !== plan.next?.label && <GapLine title="목표 칸" gap={plan.target} yieldPct={goal.yieldPct} />}
      {plan.target && !plan.target.withinLimit && (
        <div style={muted}>
          일반 계좌 세금 선 안에서 받을 수 있는 분배금은 세후 월 약 {man(plan.maxMonthly)}까지입니다. 목표 칸은 그보다 높아서, 넘는 몫은 ISA·연금 같은 다른 계좌나 가족 명의 분산 여부를 세무 확인 후 정하거나 급여로 내는 쪽을 함께 보세요. 연금 계좌 안 분배금은 고정비로 바로 쓸 수 없습니다.
        </div>
      )}

      {plan.next && plan.next.gapMonthly > 0 && (
        <div>
          {split.parts.length > 0 ? (
            <>
              <span className="sp__label">다음 칸까지 늘릴 후보</span> <span style={faint}>상품 점검 통과 · 같은 계열 40% 상한</span>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {split.parts.map((p) => <li key={p.code}>{p.name} <strong>{man(p.amount)}</strong></li>)}
              </ul>
            </>
          ) : (
            <span style={muted}>지금은 분배가 안정적이고 쏠리지 않아 점검을 통과한 후보가 없습니다. 이력이 쌓이거나 후보가 생길 때까지 기다리는 것도 선택입니다.</span>
          )}
          {split.parts.length > 0 && split.leftover > 0 && <div style={muted}>{man(split.leftover)}은 상한 때문에 나누지 못했습니다. 다른 계열 후보가 생길 때까지 현금이나 지수에 두는 쪽입니다.</div>}
          {cappedByLimit && <div style={muted}>세금 선까지 남은 여유 {man(plan.roomCapital)}만 계산했습니다. 그 이상은 한도를 넘기 전에 확인이 필요합니다.</div>}
        </div>
      )}

      <More label="계산 근거와 한계">
        <div style={{ ...muted, fontSize: 12, lineHeight: 1.65 }}>
          일반 계좌 보유 × 최근 분배율로 낸 추정이며 분배금은 해마다 다릅니다. 분배금을 안에서 재투자하는 TR형은 지급이 없어 뺐습니다.
          세후는 15.4%를 뗀 값, 새 돈 = 부족한 월 금액 × 12 ÷ 0.846 ÷ 분배율.
          세금 선은 직장가입자 연 {man(FINANCIAL_INCOME_LIMIT.worker)}(금융소득종합과세 기준, 보수 외 소득이 넘으면 건강보험 소득월액 보험료), 지역가입자 연 {man(FINANCIAL_INCOME_LIMIT.regional)}(넘으면 금융소득이 건강보험료 소득에 잡힘)이고, 선에 딱 맞추지 않게 {Math.round(LIMIT_SAFETY * 100)}%까지만 봅니다.
          세법과 건강보험 기준은 바뀔 수 있고 가족 상황마다 달라서 실행 전에 세무 전문가·공단 확인이 필요합니다. 후보는 상품 점검(분배 이력 기준)을 통과한 상품일 뿐 매수 지시나 수익 보장이 아닙니다.
        </div>
      </More>
    </div>
  )
}
