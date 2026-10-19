import { useMemo, useState } from 'react'
import More from '../../components/ui/More'
import { MIX_ASOF } from '../../data/mixData'
import { fmtYm } from '../../lib/mix'
import { isFactStale } from '../../lib/planGuide'
import { ENTRY_METHODS, compareMethods, summarizeWholeChoice, wholeChoiceOutcomes, type EntryMethod } from '../../lib/wholeChoice'

const PRODUCTS: Array<{ key: string; label: string; weights: Record<string, number> }> = [
  { key: 'kospi', label: '코스피200', weights: { kospi200: 100 } },
  { key: 'sp', label: 'S&P500(원화)', weights: { sp500: 100 } },
  { key: 'half', label: '코스피200·S&P500 반반', weights: { kospi200: 50, sp500: 50 } },
  { key: 'k6040', label: '코스피200 60·국고채 40', weights: { kospi200: 60, kbond10: 40 } },
]
const YEARS = [1, 3, 5, 10] as const

const pct = (v: number) => {
  const p = Math.round((v - 1) * 100)
  return `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p)}%`
}
const tenth = (share: number) => {
  if (share <= 0) return '없었음'
  const n = Math.round(share * 10)
  return n === 0 ? '10번 중 1번 미만' : `10번 중 ${n}번`
}
const share = (v: number) => `${Math.round(v * 100)}%`

function goDropPlan() {
  window.history.pushState({}, '', '/mix#drop-plan')
  window.dispatchEvent(new PopStateEvent('popstate'))
}

/**
 * 내 선택 한꺼번에 보기 — 상품·넣는 방식·기간을 따로 떼어 각각 좋은 쪽만 보는 편향을 막는다.
 * 셋을 한 번에 정하고, 시작 시점은 고를 수 없는 운으로 두어 과거의 모든 시작 달 결과를 범위로 보여준다.
 */
export default function WholeChoiceCard() {
  const [product, setProduct] = useState(PRODUCTS[0].key)
  const [method, setMethod] = useState<EntryMethod>('lump')
  const [years, setYears] = useState<number>(1)
  const p = PRODUCTS.find((x) => x.key === product) ?? PRODUCTS[0]
  const other: EntryMethod = method === 'lump' ? 'split12' : 'lump'
  const otherLabel = ENTRY_METHODS.find((m) => m.id === other)!.label

  const view = useMemo(() => {
    const rows = wholeChoiceOutcomes(p.weights, method, years)
    const s = summarizeWholeChoice(rows, years)
    if (!s) return null
    return { s, cmp: compareMethods(rows, wholeChoiceOutcomes(p.weights, other, years)) }
  }, [p, method, years, other])

  const others = useMemo(() => PRODUCTS.map((x) => ({ x, s: summarizeWholeChoice(wholeChoiceOutcomes(x.weights, method, years), years) })), [method, years])

  return (
    <section className="acc-card" aria-labelledby="plan-whole">
      <h2 id="plan-whole">내 선택 한꺼번에 보기</h2>
      <p className="acc-note">상품·넣는 방식·기간을 따로 보면 각각 가장 좋았던 경우만 눈에 들어옵니다. 여기서는 셋을 한 번에 정하고, 언제 시작하느냐는 고를 수 없는 운으로 두어 과거의 모든 시작 달을 그대로 보여 드립니다.</p>

      <p className="acc-note"><strong>상품</strong></p>
      <div className="acc-seg">
        {PRODUCTS.map((x) => <button key={x.key} type="button" aria-pressed={product === x.key} className={product === x.key ? 'is-active' : ''} onClick={() => setProduct(x.key)}>{x.label}</button>)}
      </div>
      <p className="acc-note"><strong>넣는 방식</strong></p>
      <div className="acc-seg">
        {ENTRY_METHODS.map((m) => <button key={m.id} type="button" aria-pressed={method === m.id} className={method === m.id ? 'is-active' : ''} onClick={() => setMethod(m.id)}>{m.label}</button>)}
      </div>
      <p className="acc-note"><strong>기간</strong></p>
      <div className="acc-seg">
        {YEARS.map((y) => <button key={y} type="button" aria-pressed={years === y} className={years === y ? 'is-active' : ''} onClick={() => setYears(y)}>{y}년</button>)}
      </div>

      {!view ? <p className="acc-warn">이 조합은 자료 기간이 짧아 계산할 수 없습니다.</p> : (() => {
        const { s, cmp } = view
        return (
          <>
            <p className="acc-note">과거 {s.starts}개 시작 달({fmtYm(s.from)}~{fmtYm(s.to)})에 이 조합을 그대로 적용했을 때, {years}년 뒤 넣은 돈 대비</p>
            <table className="acc-table plan-table">
              <tbody>
                <tr><td>가장 좋았던 시작</td><td>{pct(s.end.best)}</td><td>{fmtYm(s.bestStart)} 시작 — 좋은 사례만 보면 이 숫자가 보입니다</td></tr>
                <tr className="is-pick"><td>보통(가운데)</td><td>{pct(s.end.median)}</td><td /></tr>
                <tr><td>나쁜 10%</td><td>{pct(s.end.p10)}</td><td>열 번 중 한 번은 이보다 나빴음</td></tr>
                <tr><td>가장 나빴던 시작</td><td>{pct(s.end.worst)}</td><td>{fmtYm(s.worstStart)} 시작</td></tr>
                <tr><td>끝에 원금 아래</td><td colSpan={2}>{tenth(s.belowPrincipalShare)}</td></tr>
              </tbody>
            </table>

            <p className="acc-note"><strong>가는 길에 보는 아픔</strong> — 끝 숫자보다 이 구간에서 많이 그만둡니다.</p>
            <table className="acc-table plan-table">
              <tbody>
                <tr><td>도중 가장 깊었던 손실</td><td>나쁜 10% {pct(s.low.p10)} · 최악 {pct(s.low.worst)}</td></tr>
                <tr><td>첫 1년 안에 −10% 이상 볼 확률</td><td>{tenth(s.firstYearHit10Share)}</td></tr>
              </tbody>
            </table>

            {cmp && (
              <>
                <p className="acc-note"><strong>어느 쪽을 골라도 후회할 몫</strong> (같은 시작 달끼리 비교)</p>
                <table className="acc-table plan-table">
                  <tbody>
                    <tr><td>{otherLabel} 넣었다면 끝이 더 좋았던 경우</td><td>{share(cmp.otherBetterShare)}</td></tr>
                    <tr><td>{otherLabel} 넣었다면 도중 손실이 덜 깊었던 경우</td><td>{share(cmp.otherLowerPainShare)}</td></tr>
                  </tbody>
                </table>
                <p className="acc-note">정답을 고르는 표가 아닙니다. 오를 때의 후회와 내릴 때의 후회 중 어느 쪽을 감수할지 고르는 표입니다.</p>
              </>
            )}

            <p className="acc-note">
              이 아픔을 보고도 팔지 않을 수 있나요?{' '}
              <button type="button" className="acc-secondary" onClick={goDropPlan}>하락 때 할 일 정해 두기 →</button>
            </p>

            <More>
              <p className="acc-note">같은 방식({ENTRY_METHODS.find((m) => m.id === method)!.label})·같은 기간({years}년), 다른 상품. 상품마다 자료 시작이 달라 시작 달 수도 다릅니다.</p>
              <table className="acc-table plan-table">
                <thead><tr><th>상품</th><th>보통</th><th>나쁜 10%</th><th>원금 아래</th><th>도중 최악</th></tr></thead>
                <tbody>
                  {others.map(({ x, s: o }) => (
                    <tr key={x.key} className={x.key === product ? 'is-pick' : ''}>
                      <td>{x.label}</td>
                      {o ? <><td>{pct(o.end.median)}</td><td>{pct(o.end.p10)}</td><td>{tenth(o.belowPrincipalShare)}</td><td>{pct(o.low.worst)}</td></> : <td colSpan={4}>자료 부족</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </More>

            <p className="acc-note plan-basis">
              과거 자료 기준이며 미래를 약속하지 않습니다. 섞어보기와 같은 월말 가격(분배금 반영 수정주가, 원화 환산, 연 1회 비중 되돌리기)이고, 나눠 넣는 동안 안 넣은 돈은 수익 0%로 계산했습니다.
              시작 달이 겹쳐 서로 독립이 아니라 실제로 다른 경우는 약 {s.independent}개뿐입니다. 한국 24년은 큰 상승장(2025~2026 포함)이 들어 있어 낙관 쪽으로 치우칠 수 있고, 국고채는 2011년부터라 그 조합은 표본이 더 짧습니다. 자료 끝 {MIX_ASOF}.
              {isFactStale(`${MIX_ASOF}-01`) && <span className="acc-warn"> 자료를 만든 지 6개월이 넘었습니다. 다시 확인이 필요합니다.</span>}
            </p>
          </>
        )
      })()}
    </section>
  )
}
