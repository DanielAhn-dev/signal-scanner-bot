import data from '../data/commonBeliefs.json'

/** 해설 점검 — scripts/research/build_common_beliefs.py가 만든 JSON을 읽는다 (직접 고치지 않는다) */
export type CommentaryClaim = {
  id: number
  quote: string
  rule: string
  short: string
  first: string
  last: string
  weeks: number
  onWeeks: number
  independentEvents: number
  rateOnPct: number
  rateOffPct: number
  ratio: number
  controlledDiffPp: number
  pHolm: number
  laterReturn60dDiffPct: number
  verdict: 'confirmed' | 'not_confirmed' | 'insufficient'
  directionOnly: boolean
}

export type CommentaryData = {
  generated: string
  script: string
  outcome: string
  market: string
  method: string
  caveats: string[]
  claims: CommentaryClaim[]
}

export const COMMENTARY: CommentaryData = data as CommentaryData

/** 자료를 만든 지 180일이 넘었는지 (planGuide.isFactStale과 같은 기준) */
export function commentaryStale(generated: string = COMMENTARY.generated, today: Date = new Date()): boolean {
  const t = Date.parse(generated)
  return Number.isFinite(t) && (today.getTime() - t) / 86_400_000 > 180
}

export type ClaimView = {
  headline: string
  tone: 'neutral' | 'caution'
  mainLine: string
  subLine: string
  detailLines: string[]
}

const sign = (v: number, digits = 1) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(digits)}`

/** 판정을 '확정 결론'이 아니라 '확인됐다/안 됐다'로 말한다. 매매 지시는 하지 않는다 */
export function claimView(c: CommentaryClaim): ClaimView {
  let headline: string
  if (c.verdict === 'confirmed') headline = '먼저 알려 주는 신호로 확인됐어요'
  else if (c.verdict === 'insufficient') headline = '판단하기엔 사례가 너무 적어요'
  else if (c.directionOnly) headline = '방향은 비슷했지만 우연과 구분되지 않았어요'
  else headline = '먼저 알려 주는 신호로는 확인되지 않았어요'

  const mainLine = `신호가 켜진 뒤 한 달 안에 7% 넘게 빠진 적: ${c.rateOnPct.toFixed(1)}% (그렇지 않은 때 ${c.rateOffPct.toFixed(1)}%)`
  const subLine = `${c.first.slice(0, 7)}~${c.last.slice(0, 7)} · 서로 겹치지 않는 사례 ${c.independentEvents}건`

  const detailLines = [
    `신호 기준: ${c.rule}`,
    `켜진 주 ${c.onWeeks}회 / 전체 ${c.weeks}주`,
    `최근 변동성 수준을 맞춰 비교한 차이: ${sign(c.controlledDiffPp)}%p (8개를 동시에 시험한 보정 뒤 우연일 가능성 ${Math.round(c.pHolm * 100)}%)`,
    `참고: 신호가 켜진 뒤 3개월 수익은 그렇지 않은 때보다 ${sign(c.laterReturn60dDiffPct)}%p`,
  ]
  if (c.verdict === 'insufficient') detailLines.push('독립 사례가 10건 미만이라 결론을 내리지 않았어요.')
  return { headline, tone: c.verdict === 'confirmed' || c.directionOnly ? 'caution' : 'neutral', mainLine, subLine, detailLines }
}
