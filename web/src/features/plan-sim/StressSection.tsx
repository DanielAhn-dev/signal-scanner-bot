import More from '../../components/ui/More'
import { SIM_ASSETS, type SimAssetClass } from '../../data/simData'
import { STRESS_PRESETS, stressTest, type Shocks, type StressClass, type Weights } from '../../lib/mix'

const pct = (v: number, d = 0) => `${(v * 100).toFixed(d)}%`

/** 13자산 → 하락 가정 묶음. 리츠는 주식처럼 떨어진다고 본다(2008년 낙폭이 주식보다 컸다), 현금은 그대로 */
const STRESS_OF: Record<SimAssetClass, StressClass> = { equity: 'equity', reit: 'equity', bond: 'bond', gold: 'gold', cash: 'cash' }
export const SIM_STRESS_CLASS: Record<string, StressClass> = Object.fromEntries(SIM_ASSETS.map((a) => [a.id, STRESS_OF[a.class]]))

type Props = {
  weights: Weights
  shocks: Shocks
  onShocks: (s: Shocks) => void
  tolerance: number
  onTolerance: (v: number) => void
}

/**
 * 하락이 왔다고 가정해보기 — 섞어보기에서 옮겨 왔다(계획 4단계). 예측이 아니라 가정이다.
 * 버틸 수 있는 손실을 먼저 정하고, 거기서 주식 비중을 거꾸로 정한다.
 */
export default function StressSection({ weights, shocks, onShocks, tolerance, onTolerance }: Props) {
  const stress = stressTest(weights, shocks, tolerance / 100, SIM_STRESS_CLASS)
  return (
    <>
      <More>
        <p className="acc-note">과거에 좋았던 조합을 고르면 미래도 좋을 거라는 보장이 없습니다. 하락이 <strong>온다고 예측하는 것이 아니라</strong>, 온다고 가정했을 때 이 구성이 버틸 수 있는지 미리 확인합니다. 하락 시점은 아무도 모르니 "이제 올 때가 됐다"는 판단은 근거가 되지 않지만, 대비는 언제 해도 됩니다.</p>
      </More>
      <div className="acc-seg">
        {STRESS_PRESETS.map((p) => (
          <button key={p.key} type="button" onClick={() => onShocks(p.shocks)}
            className={JSON.stringify(p.shocks) === JSON.stringify(shocks) ? 'is-active' : ''}>
            {p.label}<br /><small>{p.note}</small>
          </button>
        ))}
      </div>
      {([['equity', '주식·리츠', -70, 0], ['bond', '채권', -40, 20], ['gold', '금', -40, 40]] as const).map(([k, label, min, max]) => (
        <label key={k} className="acc-field mix-slider">
          <span>{label} <b>{Math.round(shocks[k] * 100)}%</b></span>
          <input type="range" min={min} max={max} step={5} value={Math.round(shocks[k] * 100)} onChange={(e) => onShocks({ ...shocks, [k]: Number(e.target.value) / 100 })} />
        </label>
      ))}
      <p className="acc-code">현금(CD91)은 이 가정에서 그대로 둡니다.</p>
      <label className="acc-field mix-slider">
        <span>내가 버틸 수 있는 손실 <b>{tolerance}%</b> <small className="acc-code">이 이상 잃으면 팔고 싶어질 것 같은 선</small></span>
        <input type="range" min={5} max={60} step={5} value={tolerance} onChange={(e) => onTolerance(Number(e.target.value))} />
      </label>
      {stress ? (
        <>
          <dl className="acc-tiles">
            <div className="is-main"><dt>이 하락에서 이 구성</dt><dd>{pct(stress.loss)}</dd><small>주식만 가졌다면 {pct(stress.equityOnly)}</small></div>
            <div><dt>원금으로 돌아오려면</dt><dd>{pct(stress.recoveryNeeded)} 상승</dd><small>손실이 클수록 회복은 더 가파릅니다</small></div>
          </dl>
          {-stress.loss <= tolerance / 100 ? (
            <p className="acc-summary">이 가정에서는 손실이 버틸 수 있는 선({tolerance}%) 안입니다. 손실이 선을 넘지 않아야 하락 중에 팔지 않고 계속 보유·적립을 이어가기 쉽습니다.</p>
          ) : (
            <p className="acc-warn">
              이 가정에서는 손실 {pct(-stress.loss)}로 버틸 수 있는 선({tolerance}%)을 넘습니다.
              {stress.maxEquityShare != null
                ? ` 지금 주식·리츠 비중 ${pct(stress.equityShare)}를 약 ${pct(stress.maxEquityShare)} 이하로 낮추면(나머지 자산 구성은 그대로) 이 가정에서 선 안에 들어옵니다.`
                : ' 이 하락에서는 채권·금을 섞어도 줄지 않아, 방어 자산의 종류나 현금 비중을 다시 생각해야 합니다.'}
            </p>
          )}
          <p className="acc-note">정해진 규칙 하나: 먼저 버틸 수 있는 손실을 정하고 거기서 주식 비중을 거꾸로 정합니다. 하락이 오면 이미 정한 비중으로 되돌리기(리밸런싱)와 적립 계속하기만 하고, 그때 가서 새로 판단하지 않습니다.</p>
        </>
      ) : (
        <p className="acc-note">비중을 정하면 계산합니다.</p>
      )}
    </>
  )
}
