import { useMemo, useState } from 'react'
import More from '../../components/ui/More'
import { SPLIT_PLAN_META, SPLIT_PLAN_STATS } from '../../data/splitPlans'
import { formatKrwMan } from '../../lib/format'
import { isFactStale } from '../../lib/planGuide'
import { splitSchedule } from '../../lib/splitPlan'

const man = formatKrwMan
const pct = (v: number) => `${((v - 1) * 100).toFixed(1)}%`
const todayKst = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10)

/** 목돈을 몇 번에 나눠 넣을지 정하고 날짜표를 만든다. 분할은 수익을 늘리는 방법이 아니라 도중 낙폭을 줄이는 후회 보험이다 */
export default function SplitPlanCard() {
  const [totalMan, setTotalMan] = useState('1000')
  const [planId, setPlanId] = useState('front')
  const [startDate, setStartDate] = useState(todayKst)

  const plan = SPLIT_PLAN_STATS.find((p) => p.id === planId) ?? SPLIT_PLAN_STATS[0]
  const total = Math.round((Number(totalMan.replace(/,/g, '')) || 0) * 10_000)
  const rows = useMemo(() => splitSchedule({ total, weights: plan.weights, startDate }), [total, plan, startDate])
  const stale = isFactStale(SPLIT_PLAN_META.generated)

  return (
    <section className="acc-card" aria-labelledby="acc-split">
      <h2 id="acc-split">목돈 나눠 넣기</h2>
      <p className="acc-note">더 오르기 전에 많이 담고 싶은 마음과, 담은 뒤 더 떨어질까 하는 걱정 사이에서 정하는 방식입니다. 날짜를 미리 정해 두면 그날 가격과 상관없이 기계적으로 넣을 수 있습니다.</p>
      <div className="acc-row">
        <label className="acc-field"><span>넣을 돈(만원)</span><input type="number" inputMode="numeric" min="0" value={totalMan} onChange={(e) => setTotalMan(e.target.value)} /></label>
        <label className="acc-field"><span>첫 매수일</span><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value || todayKst())} /></label>
      </div>
      <div className="acc-seg" role="radiogroup" aria-label="나눠 넣는 방식">
        {SPLIT_PLAN_STATS.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={planId === p.id} className={planId === p.id ? 'is-active' : ''} onClick={() => setPlanId(p.id)}>{p.label}</button>
        ))}
      </div>

      {rows.length === 0 ? <p className="acc-warn">금액을 입력하세요.</p> : (
        <>
          <table className="acc-table" aria-label="매수 날짜표">
            <thead><tr><th>회차</th><th>날짜</th><th>금액</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.index}><td>{r.index}회</td><td>{r.date}</td><td>{man(r.amount)}</td></tr>)}</tbody>
          </table>
          <p className="acc-note">휴장일이면 다음 거래일에 넣습니다. 이 화면은 주문을 내지 않으니 증권사 앱에서 예약 매수나 모아가기로 직접 걸어 두세요.</p>
          <p className="acc-summary">
            과거 하위 10% 시나리오에서는 6개월 안에 평가가 한때 <strong>{man(total * plan.minP10)}</strong>(원금 대비 {pct(plan.minP10)})까지 내려갔습니다.
          </p>
        </>
      )}

      <h3>방식별 과거 결과 <small>(시작 후 6개월, 원금=1)</small></h3>
      <table className="acc-table">
        <thead><tr><th>방식</th><th>평균</th><th>하위 10%</th><th>도중 최저(하위 10%)</th></tr></thead>
        <tbody>
          {SPLIT_PLAN_STATS.map((p) => (
            <tr key={p.id} className={p.id === plan.id ? 'is-picked' : undefined}>
              <td>{p.label}</td><td>{p.avg.toFixed(3)}</td><td>{p.p10.toFixed(3)}</td><td>{p.minP10.toFixed(3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="acc-note">먼저 많이 넣을수록 평균은 높고, 나눠 넣을수록 도중 낙폭이 줄었습니다. 분할은 돈을 더 벌게 하는 방법이 아니라 후회를 줄이는 보험입니다. "더 떨어지면 더 산다" 같은 조건부 방식은 검증된 근거가 없어 넣지 않았습니다.</p>
      <More>
        <p className="acc-note">기준 기간·표본: {SPLIT_PLAN_META.sample}</p>
        <p className="acc-note">한계: {SPLIT_PLAN_META.caveat}</p>
        <p className="acc-note">자료 기준일 {SPLIT_PLAN_META.asOf} · 생성일 {SPLIT_PLAN_META.generated} · <code>{SPLIT_PLAN_META.script}</code></p>
      </More>
      {stale && <p className="acc-warn">이 자료는 만든 지 180일이 지나 낡았을 수 있습니다. 스크립트를 다시 돌려 갱신하세요.</p>}
    </section>
  )
}
