import { useMemo, useState } from 'react'
import More from '../../components/ui/More'
import { formatKrwMan } from '../../lib/format'
import { isFactStale } from '../../lib/planGuide'
import { FUTURE_DEFAULT_PATHS, simulateFuture, type FutureWeights } from '../../lib/futurePaths'
import { MIX_INDEX_LABEL, PLAN_MIX_PRESETS, type MixEntry, type MixIndex } from '../../lib/planMix'
import { FUTURE_EVENTS, FUTURE_GENERATED, FUTURE_MATERIAL, STAGNATION_FACTS } from '../../data/futureMaterial'
import FanChart from './FanChart'

/**
 * 모아가기 3번 세 번째 보기 '앞으로의 경우의 수' — 과거 1년 조각을 섞어 만든 경우들(lib/futurePaths.ts).
 * 한 숫자("n년 뒤 얼마")나 순위를 내지 않고, 범위·운 나쁜 경우·원금 아래 비율을 보여 준다.
 * 섞기만으로는 일본식 장기 정체가 잘 나오지 않아, 실제 과거 경로를 끼워 넣는 사건 버튼과 반례를 함께 둔다.
 */
const AT_YEARS = [0, 1, 2, 5] as const
const ymLabel = (ym: string) => `${ym.slice(0, 4)}-${ym.slice(4)}`
const mixText = (mix: MixEntry[]) => mix.filter((e) => e.weight > 0).map((e) => `${MIX_INDEX_LABEL[e.index]} ${Math.round(e.weight * 100)}%`).join(' · ')
const pctOf = (ratio: number) => `${ratio >= 1 ? '+' : ''}${((ratio - 1) * 100).toFixed(0)}%`

export default function FutureView({ monthly, lump, years, mix }: { monthly: number; lump: number; years: number; mix: MixEntry[] }) {
  const [eventKey, setEventKey] = useState('')
  const [atYear, setAtYear] = useState(2)
  // 겹쳐 그릴 경우 하나 — 처음엔 끝 결과가 보통에 가장 가까운 경우(운 좋은 극단을 예시로 보이지 않게), 누르면 다른 경우
  const [caseIndex, setCaseIndex] = useState<number | null>(null)
  // 구성 배열은 렌더마다 새로 만들어질 수 있어 문자열 키로 계산을 묶는다(한 번 계산에 수십 ms)
  const wKey = mix.filter((e) => e.weight > 0).map((e) => `${e.index}:${e.weight}`).join(',')
  const atOptions = AT_YEARS.filter((y) => y < years)
  const at = atOptions.includes(atYear as (typeof AT_YEARS)[number]) ? atYear : 0
  const picked = FUTURE_EVENTS.find((e) => e.key === eventKey) ?? null

  const sim = useMemo(() => {
    if (!(monthly > 0 || lump > 0)) return null
    const weights: FutureWeights = wKey.split(',').map((t) => {
      const [index, weight] = t.split(':')
      return { index: index as MixIndex, weight: Number(weight) }
    })
    return simulateFuture({ mix: weights, monthly, lump, years, event: eventKey ? { key: eventKey, atYear: at } : null, caseIndex: caseIndex ?? undefined })
  }, [wKey, monthly, lump, years, eventKey, at, caseIndex])
  // 같은 경우들(같은 씨앗)을 세 가지 구성이 겪게 한 나란히 보기 — 순서는 이력이 긴 순(순위 아님)
  const presets = useMemo(() => {
    if (!(monthly > 0 || lump > 0)) return []
    return PLAN_MIX_PRESETS.map((p) => {
      const w = (Object.entries(p.weights) as Array<[MixIndex, number]>).map(([index, weight]) => ({ index, weight }))
      return { key: p.key, label: p.label, r: simulateFuture({ mix: w, monthly, lump, years, event: eventKey ? { key: eventKey, atYear: at } : null }) }
    })
  }, [monthly, lump, years, eventKey, at])

  if (!sim) return <p className="acc-warn">금액을 입력하세요.</p>
  const paidEnd = sim.paid[sim.months]
  const stale = isFactStale(FUTURE_GENERATED)
  const myIndexes = mix.filter((e) => e.weight > 0).map((e) => e.index)

  return (
    <div className="acc-future">
      <p className="acc-note">
        <strong>예측이 아닙니다.</strong> 1999년 이후 실제 1년 조각을 무작위로 이어 붙여 앞으로 {years}년의 경우 {FUTURE_DEFAULT_PATHS.toLocaleString()}개를 만들었습니다.
        같은 해의 세 지수·환율을 함께 뽑아 위기 때 같이 빠지는 관계는 남겼습니다. 내 구성: <strong>{mixText(mix)}</strong>
      </p>
      <div className="acc-row">
        <label className="acc-field"><span>끼워 넣을 사건</span>
          <select value={eventKey} onChange={(e) => setEventKey(e.target.value)}>
            <option value="">아무 일 없음(섞기만)</option>
            {FUTURE_EVENTS.map((e) => <option key={e.key} value={e.key}>{e.label}{e.assumed ? ' (가정)' : ''}</option>)}
          </select>
        </label>
        <label className="acc-field"><span>언제</span>
          <select value={at} onChange={(e) => setAtYear(Number(e.target.value))} disabled={!eventKey}>
            {atOptions.map((y) => <option key={y} value={y}>{y === 0 ? '지금 바로' : `${y}년 뒤`}</option>)}
          </select>
        </label>
      </div>
      {picked && (
        <p className="acc-note">
          {picked.note}. 한 번에 넣었다면 가장 깊을 때{' '}
          {myIndexes.map((i) => `${MIX_INDEX_LABEL[i]} ${picked.troughPct[i].toFixed(0)}%`).join(' · ')}.
          {sim.eventCutMonths > 0 && ` 기간 안에 다 들어가지 않아 뒤 ${sim.eventCutMonths}개월은 잘렸습니다.`}
        </p>
      )}

      <dl className="acc-tiles">
        <div><dt>넣은 돈</dt><dd>{formatKrwMan(paidEnd)}</dd></div>
        <div className="is-main"><dt>보통(중앙값)</dt><dd>{formatKrwMan(sim.typical * paidEnd)}</dd><small>{pctOf(sim.typical)}</small></div>
        <div><dt>운 나쁨(하위 10%)</dt><dd>{formatKrwMan(sim.low * paidEnd)}</dd><small>{pctOf(sim.low)}</small></div>
        <div><dt>넣은 돈보다 적은 경우</dt><dd>{sim.belowPrincipalPct.toFixed(0)}%</dd></div>
      </dl>
      <FanChart sim={sim} realName={sim.deepest?.start} />
      <p className="acc-legend">
        <span><i className="acc-k-median" />보통</span> <span><i className="acc-k-p10" />운 나쁨(하위10%)</span> <span><i className="acc-k-worst" />가장 나쁜 경우</span> <span><i className="acc-k-real" />경우 하나</span>
        <span>음영은 하위10%~상위10%(운 좋으면 {pctOf(sim.high)}) · 세로축은 넣은 돈 대비 %</span>
      </p>
      {sim.deepest && (
        <p className="acc-summary">
          {sim.deepest.start}: {sim.deepest.troughPct < 0 ? <>중간에 넣은 돈 대비 <strong>{sim.deepest.troughPct.toFixed(0)}%</strong>까지 내려갔고, </> : null}
          {years}년 끝에는 넣은 돈의 {(sim.deepest.finalRatio * 100).toFixed(0)}%.{' '}
          <button type="button" className="acc-secondary" onClick={() => setCaseIndex(((sim.caseIndex) + 137) % FUTURE_DEFAULT_PATHS)}>다른 경우 보기</button>
        </p>
      )}

      <div className="acc-compare">
        <h3>같은 경우들로 나란히 (순위가 아닙니다)</h3>
        <table className="acc-table">
          <thead><tr><th>구성</th><th>보통</th><th>운 나쁨</th><th>원금 아래</th></tr></thead>
          <tbody>
            {presets.map(({ key, label, r }) => (
              <tr key={key}><td>{label}</td><td>{pctOf(r.typical)}</td><td>{pctOf(r.low)}</td><td>{r.belowPrincipalPct.toFixed(0)}%</td></tr>
            ))}
          </tbody>
        </table>
        <p className="acc-note">세 구성이 똑같은 {FUTURE_DEFAULT_PATHS.toLocaleString()}가지 경우를 겪게 해서 비교했습니다. 보통이 높은 구성이 운 나쁜 경우에도 낫다는 보장은 없고, 재료 기간에 강했던 시장이 앞으로도 강하다는 근거도 아닙니다.</p>
      </div>

      <div className="acc-compare">
        <h3>&ldquo;결국 오른다&rdquo;는 살아남은 시장 이야기입니다</h3>
        <ul className="acc-future-facts">
          {STAGNATION_FACTS.map((f) => (
            <li key={f.key}>
              <strong>{f.label}</strong> {ymLabel(f.peak)} 고점을 다시 넘기까지{' '}
              {f.recovered ? `${f.years}년(${ymLabel(f.recovered)})` : '아직'}
              {f.stayed && f.stayed !== f.recovered ? `, 그 뒤 다시 빠져 계속 위에 머문 건 ${f.stayedYears}년 뒤(${ymLabel(f.stayed)})` : ''}.
              {f.dca10 != null && ` 그 고점부터 10년 매달 모았다면 넣은 돈의 ${(f.dca10 * 100).toFixed(0)}%.`}
            </li>
          ))}
        </ul>
        <p className="acc-note">현지 통화 가격지수(배당 제외) 기준입니다. 이런 긴 정체는 1년 조각 섞기로는 잘 나오지 않으니 위 &lsquo;끼워 넣을 사건&rsquo;에서 따로 보세요.</p>
      </div>

      <More>
        <p className="acc-note">재료: {ymLabel(FUTURE_MATERIAL.from)}~{ymLabel(FUTURE_MATERIAL.to)} 월 수익률 {FUTURE_MATERIAL.months}개월(원화, 분배금 반영). 코스피200은 KODEX 200, 그 이전(~2002-10)은 코스피 가격지수에 연 {FUTURE_MATERIAL.kospiGapPct}% 더한 근사. S&P500·나스닥100은 SPY·QQQ × 원/달러(한국은행), 한국 상장 상품 격차로 연 {FUTURE_MATERIAL.dragPct.sp500}%p 차감.</p>
        <p className="acc-note">방법: 12개월 덩어리를 무작위로 이어 붙이고(덩어리 사이는 독립 가정), 매달 초 넣고 매달 비중을 다시 맞춥니다. 세금·환전비·수수료는 넣지 않았습니다. 사건은 실제 경로를 그대로 끼우며, &lsquo;일본처럼&rsquo;은 닛케이 경로를 세 지수에 똑같이 적용한 가정입니다.</p>
        <p className="acc-note">생성일 {FUTURE_GENERATED} · <code>scripts/research/build_future_paths_data.py</code></p>
      </More>
      {stale && <p className="acc-warn">이 자료는 만든 지 180일이 지나 낡았을 수 있습니다. 스크립트를 다시 돌려 갱신하세요.</p>}
    </div>
  )
}
