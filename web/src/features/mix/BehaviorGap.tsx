import { useMemo, useState } from 'react'
import { fmtYm } from '../../lib/mix'
import { summarizeGap, type GapMode, type Reentry } from '../../lib/behaviorGap'

const x = (v: number) => `${v.toFixed(2)}배`
const pct = (v: number) => `${Math.round(v * 100)}%`

const REENTRY: Array<{ key: Reentry; label: string; note: string }> = [
  { key: 'months6', label: '6개월 뒤 다시 매수', note: '시간이 지나면 괜찮아지겠지' },
  { key: 'rebound', label: '저점에서 +20% 오르면 매수', note: '반등을 확인하고 들어가자' },
  { key: 'recover', label: '직전 고점을 회복하면 매수', note: '완전히 회복하면 들어가자' },
]

/** 코스피200에서 "하락 중에 판 사람"이 계속 보유한 사람과 얼마나 달랐는지 — 과거 모든 시작월 비교 */
export default function BehaviorGap() {
  const [mode, setMode] = useState<GapMode>('lump')
  const [years, setYears] = useState(5)
  const [trigger, setTrigger] = useState(20)
  const [reentry, setReentry] = useState<Reentry>('rebound')

  const s = useMemo(() => summarizeGap({ mode, years, trigger: trigger / 100, reentry, cashAnnual: 0.025 }), [mode, years, trigger, reentry])
  const unit = mode === 'lump' ? '시작 금액 대비' : '넣은 돈 대비'

  return (
    <section className="acc-card">
      <h2>하락 중에 팔았다면</h2>
      <p className="acc-note">
        "그때 팔지 않았다면", "안 봤다면 올랐을 텐데"라는 후회가 드는 순간에 쓰는 도구입니다. 코스피200(KODEX 200, 분배금 반영)에서
        <strong> 고점 대비 {trigger}% 떨어지면 팔고 정해 둔 때 다시 산 사람</strong>이, 계속 들고 있던 사람과 얼마나 달랐는지를 2002년 이후 모든 시작월로 비교합니다.
      </p>
      <div className="acc-seg">
        {([['lump', '한 번에 투자'], ['dca', '매월 적립']] as const).map(([k, label]) => (
          <button key={k} type="button" className={mode === k ? 'is-active' : ''} onClick={() => setMode(k)}>{label}</button>
        ))}
        {[5, 10].map((y) => (
          <button key={y} type="button" className={years === y ? 'is-active' : ''} onClick={() => setYears(y)}>{y}년 보유</button>
        ))}
      </div>
      <label className="acc-field mix-slider">
        <span>이만큼 떨어지면 판다 <b>-{trigger}%</b></span>
        <input type="range" min={10} max={40} step={5} value={trigger} onChange={(e) => setTrigger(Number(e.target.value))} />
      </label>
      <div className="acc-seg">
        {REENTRY.map((r) => (
          <button key={r.key} type="button" className={reentry === r.key ? 'is-active' : ''} onClick={() => setReentry(r.key)}>
            {r.label}<br /><small>{r.note}</small>
          </button>
        ))}
      </div>

      {s ? (
        <>
          <dl className="acc-tiles">
            <div className="is-main"><dt>팔고 다시 산 사람 ({unit}, 중앙값)</dt><dd>{x(s.sell.median)}</dd><small>계속 보유 {x(s.hold.median)}</small></div>
            <div className="is-main"><dt>보유보다 나았던 경우</dt><dd>{pct(s.sellWins)}</dd><small>팔게 된 {s.touched}개 시작월 중</small></div>
            <div><dt>하위 10% 결과</dt><dd>{x(s.sell.p10)}</dd><small>계속 보유 {x(s.hold.p10)}</small></div>
            <div><dt>가장 나빴던 시작</dt><dd>보유의 {pct(s.worstRatio)}</dd><small>{fmtYm(s.worstStart)} 시작</small></div>
          </dl>
          <p className="acc-summary">
            {s.sellWins < 0.5
              ? `이 조건에서는 하락 중에 팔고 다시 산 쪽이 ${pct(1 - s.sellWins)}의 시작월에서 보유보다 못했습니다. 가장 좋았던 경우는 보유의 ${pct(s.bestRatio)}(${fmtYm(s.bestStart)} 시작)입니다.`
              : `이 조건에서는 팔고 다시 산 쪽이 ${pct(s.sellWins)}의 시작월에서 보유보다 나았습니다. 다만 아래 주의를 읽어 보세요. 이 값은 체결 시점 가정에 따라 크게 달라집니다.`}
          </p>
        </>
      ) : (
        <p className="acc-note">이 조건에서는 팔게 된 시작월이 없습니다.</p>
      )}

      <ul className="acc-note">
        <li><strong>결과는 몇 번의 큰 하락에 걸려 있습니다.</strong> 시작월은 겹치므로 독립적인 하락은 2008·2011·2020·2022·2026년 정도입니다. 시작월 수만큼 믿을 수 있는 표본은 아닙니다.</li>
        <li><strong>체결 시점에 민감합니다.</strong> 판정 다음 거래일 종가로 체결한다고 가정했습니다. 같은 날 종가로 바꾸거나 월말 종가로만 보면 "6개월 뒤 재매수"의 승률이 크게 달라졌습니다(5년 기준 5%~52%). 반면 "직전 고점 회복 후 재매수"는 어떤 가정에서도 일관되게 불리했습니다.</li>
        <li>비용·세금은 넣지 않았습니다. 넣으면 판 쪽이 더 불리해집니다. 팔고 있는 동안 현금은 연 2.5%로 계산했습니다.</li>
        <li>코스피200 한 시장, 2002년 이후입니다. 미래의 하락에서도 같다는 보장은 없습니다. 이 도구는 팔기 전에 "과거의 팔았던 사람들은 어땠는지"를 보여 줄 뿐 지시하지 않습니다.</li>
      </ul>
    </section>
  )
}
