import { useMemo, useState } from 'react'
import { MIX_ASOF, MIX_ASSETS } from '../../data/mixData'
import { MIX_PRESETS, fmtYm, normalize, simulateMix, type Rebalance, type Weights } from '../../lib/mix'
import '../accumulate/accumulate.css'
import './mix.css'

const pct = (v: number, d = 1) => `${(v * 100).toFixed(d)}%`

function Curve({ mix, base }: { mix: number[]; base: number[] | null }) {
  const W = 640, H = 240, L = 44, R = 12, T = 12, B = 24
  const n = mix.length - 1
  const all = [...mix, ...(base ?? [])]
  const maxY = Math.log(Math.max(...all) * 1.05)
  const minY = Math.log(Math.min(...all) * 0.95)
  const x = (i: number) => L + ((W - L - R) * i) / n
  const y = (v: number) => T + (H - T - B) * (1 - (Math.log(v) - minY) / (maxY - minY))
  const line = (a: number[]) => a.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const ticks = [0.5, 1, 2, 4, 8, 16, 32].filter((t) => Math.log(t) > minY && Math.log(t) < maxY)
  return (
    <svg className="acc-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="섞은 자산과 코스피200의 평가금 추이(로그 눈금)">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="acc-grid" />
          <text x={L - 6} y={y(t) + 4} textAnchor="end" className="acc-axis">{t}배</text>
        </g>
      ))}
      {base && <path d={line(base)} className="acc-line acc-paid" />}
      <path d={line(mix)} className="acc-line acc-median" />
    </svg>
  )
}

export default function MixPage() {
  const [weights, setWeights] = useState<Weights>(MIX_PRESETS[3].weights)
  const [rebalance, setRebalance] = useState<Rebalance>('year')
  const total = Object.values(weights).reduce((s, v) => s + v, 0)

  const result = useMemo(() => simulateMix(weights, rebalance), [weights, rebalance])
  // 비교 기준: 같은 기간의 코스피200 100%. 코스피200 이력이 가장 길어 항상 만들 수 있다.
  const base = useMemo(() => {
    if (!result) return null
    const b = simulateMix({ kospi200: 100 }, 'none')
    if (!b) return null
    const i0 = b.yms.indexOf(result.from) - 1
    const i1 = b.yms.indexOf(result.to)
    if (i0 < 0 || i1 < 0) return null
    const slice = b.curve.slice(i0, i1 + 1)
    const curve = slice.map((v) => v / slice[0])
    const years = result.months / 12
    let peak = 1, mdd = 0
    for (const v of curve) { peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1) }
    return { curve, cagr: curve[curve.length - 1] ** (1 / years) - 1, mdd }
  }, [result])

  const set = (id: string, v: number) => setWeights({ ...weights, [id]: v })
  const picked = Object.keys(normalize(weights))
  const shortest = picked.map((id) => MIX_ASSETS.find((a) => a.id === id)!).sort((a, b) => b.first.localeCompare(a.first))[0]

  return (
    <div className="acc mix">
      <header>
        <p className="acc-eyebrow">직접 섞어보기</p>
        <h1>자산을 섞으면 수익과 낙폭이 어떻게 달라질까</h1>
        <p>코스피200·미국지수·채권·금을 원하는 비중으로 섞어, 과거 실제 가격으로 연수익과 최대 낙폭을 확인합니다. 주문은 내지 않고, 과거 숫자일 뿐 미래를 약속하지 않습니다.</p>
      </header>

      <section className="acc-card">
        <h2>예시로 시작하기</h2>
        <div className="acc-seg">
          {MIX_PRESETS.map((p) => (
            <button key={p.key} type="button" onClick={() => setWeights(p.weights)}
              className={JSON.stringify(normalize(p.weights)) === JSON.stringify(normalize(weights)) ? 'is-active' : ''}>
              {p.label}<br /><small>{p.note}</small>
            </button>
          ))}
        </div>
      </section>

      <section className="acc-card">
        <h2>비중 정하기</h2>
        {MIX_ASSETS.map((a) => (
          <label key={a.id} className="acc-field mix-slider">
            <span>{a.name} <b>{weights[a.id] ?? 0}%</b> <small className="acc-code">{a.source} · {fmtYm(a.first)}~</small></span>
            <input type="range" min={0} max={100} step={5} value={weights[a.id] ?? 0} onChange={(e) => set(a.id, Number(e.target.value))} />
          </label>
        ))}
        <p className="acc-note">
          합계 {total}%{total !== 100 && total > 0 ? ' — 100이 아니어도 비율로 환산해 계산합니다.' : ''}
          {total === 0 && ' 비중을 하나 이상 정해주세요.'}
        </p>
        <div className="acc-field">
          <span>리밸런싱(비중 되돌리기)</span>
          <select value={rebalance} onChange={(e) => setRebalance(e.target.value as Rebalance)}>
            <option value="year">1년에 한 번</option>
            <option value="month">매월</option>
            <option value="none">하지 않음</option>
          </select>
        </div>
      </section>

      {result ? (
        <section className="acc-card">
          <h2>결과 <small className="acc-code">{fmtYm(result.from)} ~ {fmtYm(result.to)} · {(result.months / 12).toFixed(1)}년</small></h2>
          <dl className="acc-tiles">
            <div className="is-main"><dt>연평균 수익률</dt><dd>{pct(result.cagr)}</dd><small>코스피200 {base ? pct(base.cagr) : '-'}</small></div>
            <div className="is-main"><dt>최대 낙폭</dt><dd>{pct(result.mdd, 0)}</dd><small>코스피200 {base ? pct(base.mdd, 0) : '-'}</small></div>
            <div><dt>최악의 1년</dt><dd>{pct(result.worstYear, 0)}</dd></div>
            <div><dt>5년 보유, 최저</dt><dd>{result.rolling5 ? `연 ${pct(result.rolling5.min)}` : '기간 부족'}</dd>{result.rolling5 && <small>하위 10% 연 {pct(result.rolling5.p10)}</small>}</div>
          </dl>
          <Curve mix={result.curve} base={base?.curve ?? null} />
          <p className="acc-legend"><span><i className="acc-k-median" />내가 섞은 자산</span><span><i className="acc-k-paid" />코스피200 100% (같은 기간)</span></p>
          {base && result.cagr < base.cagr && result.mdd > base.mdd && (
            <p className="acc-summary">코스피200만 보유했을 때보다 연수익은 {pct(base.cagr - result.cagr)}p 낮았지만 최대 낙폭은 {pct(result.mdd - base.mdd, 0)}p 작았습니다. 수익을 일부 내주고 낙폭을 줄이는 선택입니다.</p>
          )}
          {base && result.cagr >= base.cagr && result.mdd > base.mdd && (
            <p className="acc-summary">이 기간에는 수익도 낙폭도 코스피200만 보유한 것보다 나았습니다. 아래 주의를 꼭 읽어보세요.</p>
          )}
        </section>
      ) : (
        <section className="acc-card"><p className="acc-note">계산할 수 있는 기간이 부족합니다. 비중을 조정해 주세요.</p></section>
      )}

      <section className="acc-card">
        <h2>읽을 때 주의</h2>
        <ul className="acc-note">
          <li><strong>기간이 가장 짧은 자산이 정합니다.</strong>{shortest ? ` 지금은 ${shortest.name}(${fmtYm(shortest.first)}~)이 기간을 정합니다.` : ''} 기간이 다른 조합끼리의 수익률 비교는 공정하지 않습니다.</li>
          <li><strong>지난 15년은 미국이 유독 강했던 구간입니다.</strong> 나스닥을 넣은 조합이 좋아 보이는 것은 그 구간의 결과일 수 있고, 같은 일이 반복된다는 근거는 아닙니다.</li>
          <li>S&amp;P500·미국 장기채는 한국 상장 상품 이력이 짧아 미국 원지수를 원화로 환산했고, 한국 상장 상품이 실제로 낮게 나온 만큼(연 0.9%p) 빼서 보정했습니다. 환헤지 여부에 따라 실제는 다를 수 있습니다.</li>
          <li>세금·호가 차이·환전 비용은 넣지 않았습니다. 리밸런싱은 바꾼 비중의 0.1%를 비용으로 뺐습니다.</li>
          <li>데이터 기준: {MIX_ASOF}까지의 월말 가격(분배금 반영 총수익).</li>
        </ul>
      </section>
    </div>
  )
}
