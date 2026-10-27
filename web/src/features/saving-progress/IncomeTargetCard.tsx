import { useEffect, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import More from '../../components/ui/More'
import { formatKrwMan } from '../../lib/format'
import type { IncomeCheckRow } from '../income-guide/IncomeProductCheck'
import type { AccumulateState } from '../../lib/accumulate'
import { COMPOSITIONS, FINANCIAL_INCOME_LIMIT, LIMIT_SAFETY, compareCompositions, incomeTargetPlan, shortfallPlan, splitAmount, type RungGap } from '../../../../src/lib/incomeTarget'

/**
 * "인컴으로 덮을 고정비" — 고정비 사다리를 분배금으로 덮으려 할 때, 다음 칸까지 더 필요한 원금과
 * 일반 계좌 금융소득 세금 선(직장 2,000만원·지역 1,000만원) 안에서 어디까지 닿는지, 점검을 통과한 후보를 보여 준다.
 * 계산은 src/lib/incomeTarget.ts. 매수 지시가 아니라 점검 결과를 목표에 이어 놓은 안내다.
 */
export type IncomeGoal = NonNullable<AccumulateState['incomeGoal']>
export const DEFAULT_INCOME_GOAL: IncomeGoal = { targetLabel: null, taxProfile: 'worker', yieldPct: COMPOSITIONS.balanced.yieldPct }
/** 분배율 가정은 구성 3종의 값에서만 고른다(예전에 저장한 값은 가장 가까운 구성으로 보여 준다) */
const YIELD_CHOICES = Object.values(COMPOSITIONS).map((c) => ({ value: c.yieldPct, label: `${c.label} ${c.yieldPct}%` }))
const nearestYield = (y: number) => YIELD_CHOICES.reduce((a, b) => (Math.abs(b.value - y) < Math.abs(a.value - y) ? b : a)).value

const man = formatKrwMan
const muted: CSSProperties = { color: 'var(--color-text-secondary)' }
const faint: CSSProperties = { color: 'var(--color-text-tertiary)', fontSize: 12 }
const select: CSSProperties = { font: 'inherit', padding: '2px 6px', border: '1px solid var(--color-border-default)', borderRadius: 6, background: 'transparent', color: 'inherit' }
const manSmall = (v: number) => (v >= 10_000 ? man(v) : `${(Math.round(v / 1_000) * 1_000).toLocaleString('ko-KR')}원`)

/** 숫자 입력 — 타이핑 중에는 저장하지 않고 포커스를 벗어날 때 한 번만 저장한다 */
function NumField({ label, value, unit, onCommit }: { label: string; value: number | undefined; unit: string; onCommit: (v: number | undefined) => void }) {
  const [text, setText] = useState(value ? String(value) : '')
  useEffect(() => { setText(value ? String(value) : '') }, [value])
  return (
    <label>{label}{' '}
      <input
        style={{ ...select, width: 64 }}
        inputMode="numeric"
        value={text}
        onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ''))}
        onBlur={() => { const n = Number(text); const next = n > 0 ? n : undefined; if (next !== value) onCommit(next) }}
      />{unit}
    </label>
  )
}

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
  generalCapital = 0,
  monthlyDeposit = 0,
  check,
  goal,
  onGoal,
}: {
  fixed: Array<{ label: string; amount: number }>
  generalGross: number
  /** 일반 계좌 인컴 원금(지금 가진 것) */
  generalCapital?: number
  /** 내 계획의 월 적립 */
  monthlyDeposit?: number
  check: IncomeCheckRow[]
  goal: IncomeGoal
  onGoal: (next: IncomeGoal) => void
}) {
  const navigate = useNavigate()
  const plan = incomeTargetPlan({ fixed, targetLabel: goal.targetLabel, taxProfile: goal.taxProfile, generalGrossAnnual: generalGross, yieldPct: goal.yieldPct })
  if (plan.ladder.rungs.length === 0) return null
  const limitMan = man(plan.limitAnnual)
  // 다음 칸까지 더 담을 돈을 후보에게 나눈다 — 세금 선까지 남은 원금을 넘지 않게
  const addAmount = plan.next ? Math.min(plan.next.extraCapital, plan.roomCapital) : 0
  const split = splitAmount(check, addAmount)
  const cappedByLimit = plan.next != null && plan.next.extraCapital > plan.roomCapital
  // 구성 3종 비교 — 목표 칸이 있으면 목표 칸, 없으면 다음 칸까지의 월 금액
  const customMonthly = (goal.targetMonthly ?? 0) * 10_000
  const compareTarget = customMonthly > 0 ? { label: '직접 정한 목표', cumulative: customMonthly } : plan.target ?? plan.next
  const rows = compareTarget ? compareCompositions({ targetMonthlyNet: compareTarget.cumulative, generalIncomeCapital: generalCapital, monthlyDeposit, taxProfile: goal.taxProfile }) : []
  const monthsLeft = goal.age && goal.targetAge && goal.targetAge > goal.age ? (goal.targetAge - goal.age) * 12 : null
  const picked = rows.find((r) => r.yieldPct === nearestYield(goal.yieldPct)) ?? rows[0]
  const shortfall = picked
    ? shortfallPlan({ row: picked, generalIncomeCapital: generalCapital, monthlyDeposit, monthsLeft, taxProfile: goal.taxProfile, rungs: plan.ladder.rungs })
    : null
  const cautionRows = check.filter((r) => r.verdict === 'caution')
  const years = (m: number | null) => (m == null ? '적립 없음' : m === 0 ? '이미 닿음' : m < 12 ? `${m}개월` : `약 ${(m / 12).toFixed(1)}년`)
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
        <NumField label="목표 월(세후)" value={goal.targetMonthly} unit="만원" onCommit={(v) => onGoal({ ...goal, targetMonthly: v })} />
        <NumField label="지금" value={goal.age} unit="세" onCommit={(v) => onGoal({ ...goal, age: v })} />
        <NumField label="목표" value={goal.targetAge} unit="세까지" onCommit={(v) => onGoal({ ...goal, targetAge: v })} />
        <label>분배율 가정{' '}
          <select style={select} value={nearestYield(goal.yieldPct)} onChange={(e) => onGoal({ ...goal, yieldPct: Number(e.target.value) })}>
            {YIELD_CHOICES.map((y) => <option key={y.value} value={y.value}>{y.label}</option>)}
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

      {compareTarget && rows.length > 0 && (
        <More label={`${compareTarget.label}까지 만드는 구성 비교`}>
          <div style={{ fontSize: 12, lineHeight: 1.65 }}>
            <div style={muted}>세후 월 {man(compareTarget.cumulative)}을 일반 계좌 분배금으로 받으려면 (순위가 아니라 대가를 나란히 본 것입니다)</div>
            {rows.map((r) => (
              <div key={r.id} style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid var(--color-border-default)' }}>
                <strong>{r.label}</strong> <span style={faint}>{r.mix} · 분배율 {r.yieldPct}% 가정</span>
                <div>필요 원금 약 {man(r.requiredCapital)} · 지금보다 {man(r.extraCapital)} 더 · {monthlyDeposit > 0 ? `월 ${man(monthlyDeposit)} 적립이면 ${years(r.months)}` : '월 적립을 정하면 기간이 나옵니다'}</div>
                {!r.withinLimit && <div style={{ color: 'var(--color-warning)' }}>일반 계좌 세금 선을 연 {man(r.overLimitGross)} 넘습니다. 넘는 몫은 다른 계좌 배치나 급여로 메워야 해서, 일반 계좌만으로는 이 구성으로도 닿지 않습니다</div>}
                <div style={muted}>대가: {r.cost}</div>
              </div>
            ))}
            <div style={{ ...muted, marginTop: 8 }}>
              분배율은 한국 표본(커버드콜 균등 8.2%, 고배당+커버드콜 6.5%)이고 성장 중심 4.5%는 가정입니다. 연구에서 분배율을 1%p 올릴 때마다 같은 기간 총수익이 15~20%p 줄었습니다. 기간은 분배금 재투자를 뺀 단순 계산입니다.
            </div>
          </div>
        </More>
      )}

      {compareTarget && picked && shortfall && (
        <More label="목표에 모자랄 때 · 내 보유로 맞추기">
          <div style={{ fontSize: 12, lineHeight: 1.65 }}>
            <div>
              <strong>{picked.label}</strong>({picked.mix}) 기준 {compareTarget.label} 세후 월 {man(compareTarget.cumulative)}
              {picked.extraCapital > 0 ? <> — 지금보다 새 돈 약 <strong>{man(picked.extraCapital)}</strong>이 더 필요합니다.</> : ' — 일반 계좌 인컴 원금이 이미 충분합니다.'}
            </div>
            {picked.extraCapital > 0 && (
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {shortfall.monthsLeft != null ? (
                  <li>
                    기한({goal.age}세→{goal.targetAge}세, {Math.round(shortfall.monthsLeft / 12)}년) 안에 닿으려면 매달 약 <strong>{man(shortfall.neededDeposit ?? 0)}</strong>
                    {shortfall.depositGap > 0 ? <> 적립이 필요하고 지금 계획보다 월 {man(shortfall.depositGap)} 더입니다(적립 늘리기).</> : '이고 지금 계획으로 가능합니다.'}
                  </li>
                ) : <li>나이를 적으면 기한 안에 필요한 월 적립이 계산됩니다.</li>}
                <li>지금 적립 그대로면 {monthlyDeposit > 0 ? <>{years(shortfall.monthsAtCurrentDeposit)} 걸립니다(기한 늘리기).</> : '월 적립을 정하면 기간이 나옵니다.'}</li>
                {shortfall.reachableMonthly != null && (
                  <li>
                    지금 적립으로 기한 안에 닿는 세후 월은 약 <strong>{man(shortfall.reachableMonthly)}</strong>
                    {shortfall.reachableRung ? <> — <strong>{shortfall.reachableRung}</strong>까지 덮입니다(목표 낮추기).</> : '입니다.'}
                  </li>
                )}
                {shortfall.overLimitGross > 0 && (
                  <li style={{ color: 'var(--color-warning)' }}>
                    일반 계좌의 세금 선을 연 {man(shortfall.overLimitGross)} 넘는 몫은 이 계좌로 받지 말고, 연금저축·IRP 세액공제와 ISA를 먼저 채우는 순서와 다른 계좌 배치를 세무 확인 후 정하거나 {goal.taxProfile === 'worker' ? '급여' : '사업소득'}로 내는 쪽을 보세요. 연금 계좌 안 분배금은 고정비로 바로 쓸 수 없습니다.
                  </li>
                )}
              </ul>
            )}
            <div style={{ marginTop: 10 }}>
              <span className="sp__label">{generalCapital > 0 ? '지금 보유에서 맞추기' : '새로 시작하기'}</span>
              {generalCapital > 0 ? (
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  <li>일반 계좌 인컴 원금 {man(generalCapital)} · 점검 통과 후보 {check.filter((r) => r.verdict === 'add').length}개 — 새 돈은 위의 후보에게만 나눕니다. 이미 가진 것을 팔라는 안내는 아닙니다.</li>
                  {cautionRows.length > 0 && <li style={{ color: 'var(--color-warning)' }}>주의 {cautionRows.map((r) => r.name).join(', ')} — 분배가 줄거나 들쭉날쭉해 더 담지 말고 비중을 점검하세요.</li>}
                  <li>구성이 {picked.label}({picked.mix})와 얼마나 다른지, 계좌별 순서는 리밸런싱 가이드에서 이어서 봅니다.</li>
                </ul>
              ) : (
                <div style={muted}>보유한 인컴 상품이 없어 처음부터 {picked.label}({picked.mix}) 기준으로 매달 {monthlyDeposit > 0 ? man(monthlyDeposit) : '적립금'}을 나눠 담는 쪽입니다. 후보는 분배 이력이 쌓인 상품만 점검을 통과합니다.</div>
              )}
              <button type="button" className="sp__link" onClick={() => navigate('/income-guide')}>리밸런싱 가이드에서 계좌별 순서 보기</button>
            </div>
            <div style={{ ...muted, marginTop: 8 }}>목표 월 금액·나이는 모아가기 계획과 따로 저장되며, 입력하지 않으면 덮을 칸 기준으로만 계산합니다. 안내일 뿐 자동으로 사고팔지 않습니다.</div>
          </div>
        </More>
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
