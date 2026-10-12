// 큰 하락일·급등일 카드 문구. 원인을 단정하지 않고 '얼마나 흔한 일인지'와 '같이 움직인 것'만 말한다(예측 아님).
// 빠질 때 주저하다 놓치는 실수와 오를 때 몰아 사는 실수를 같은 결론(정해 둔 계획대로)으로 막는다.
// 실시간 값은 /api/market-overview의 dropDay(src/services/dropDayContext.ts), 고정 수치는 data/dropDayFacts.ts.
import { DROP_DAY_FACTS, DROP_DAY_META } from '../data/dropDayFacts'

/** 서버 DropDayContext와 같은 모양 */
export type DropDayView = {
  asOf: string
  changePct: number
  fromHighPct: number
  downStreak: number
  yearCounts: Record<string, number>
  /** 예전 캐시 응답에는 없을 수 있다 */
  newHigh52w?: boolean
  foreign: { date: string; net: number; rank: number } | null
}

export type DropDayLines = {
  dayLabel: string
  headline: string
  sub: string
  /** 늘 보이는 경계 문구 — 바닥은 모른다는 것을 과거 추가 하락 비율로 보여 준다 */
  caution: string
  us: string | null
  foreign: string | null
  after: string
}

type Bucket = (typeof DROP_DAY_FACTS.buckets)[number]

/** 하루 등락(%)이 들어가는 가장 깊은 구간. −1.5%보다 덜 빠졌으면 null(카드 안 보임) */
export function pickDropBucket(changePct: number): Bucket | null {
  let hit: Bucket | null = null
  for (const b of DROP_DAY_FACTS.buckets) if (changePct <= b.threshold) hit = b
  return hit
}

const signed = (v: number, digits = 1) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}`

const dayLabelOf = (asOf: string, todayKst: string) =>
  asOf === todayKst ? '오늘' : `${Number(asOf.slice(5, 7))}월 ${Number(asOf.slice(8, 10))}일`

function foreignText(f: DropDayView['foreign']): string | null {
  if (!f) return null
  const { net, rank } = f
  const amount = `${Math.abs(Math.round(net)).toLocaleString('ko-KR')}억원 ${net < 0 ? '순매도' : '순매수'}`
  const where =
    rank <= 0.1 ? `최근 1년 중 가장 많이 판 쪽 ${Math.max(1, Math.round(rank * 100))}% 안` : rank >= 0.9 ? '최근 1년 중 많이 산 편' : '최근 1년 평소 범위'
  return `외국인 ${amount} — ${where}`
}

export function dropDayLines(view: DropDayView, sp500ChangePct: number | null | undefined, todayKst: string): DropDayLines | null {
  if (!Number.isFinite(view.changePct)) return null
  const bucket = pickDropBucket(view.changePct)
  if (!bucket) return null
  const t = String(bucket.threshold)
  const dayLabel = dayLabelOf(view.asOf, todayKst)
  const yearNth = view.yearCounts[t] ?? 0

  const headline = `${dayLabel} 코스피 ${signed(view.changePct, 2)}% — 1년에 약 ${Math.round(bucket.perYear)}번 있는 크기의 하락`
  const subParts = [
    view.fromHighPct <= -1 ? `최근 고점 대비 ${signed(view.fromHighPct)}%` : null,
    view.downStreak >= 2 ? `${view.downStreak}일 연속 하락` : null,
    yearNth > 0 ? `올해 ${yearNth}번째(${signed(bucket.threshold)}% 이하 기준)` : null,
  ].filter(Boolean)

  let us: string | null = null
  if (sp500ChangePct != null && Number.isFinite(sp500ChangePct)) {
    const part = DROP_DAY_FACTS.us.beta * sp500ChangePct
    const rest = view.changePct - part
    us =
      `간밤 미국 S&P500 ${signed(sp500ChangePct, 2)}% → 평소 민감도로 옮겨오는 몫은 약 ${signed(part)}%p, ` +
      `나머지 ${signed(rest)}%p는 국내·아시아 장중 요인입니다. ` +
      `(${DROP_DAY_FACTS.us.period} 코스피 하루 등락 중 간밤 미국으로 설명되는 비율은 ${DROP_DAY_FACTS.us.r2Pct}% 정도)`
  }

  const foreign = foreignText(view.foreign)

  const h60 = bucket.h60
  const h250 = bucket.h250
  const after =
    `과거 ${signed(bucket.threshold)}% 이하 하락 ${bucket.events}번 뒤: 3개월 뒤 중앙 ${signed(h60.medianPct)}%(오른 경우 ${h60.upPct}%), ` +
    `1년 뒤 중앙 ${signed(h250.medianPct)}%(오른 경우 ${h250.upPct}%). 1년 뒤에도 마이너스였던 때가 ${100 - h250.upPct}% 있었습니다.`

  const f = bucket.further60
  const base = DROP_DAY_FACTS.baseFurther60
  const caution =
    `바닥은 아무도 모릅니다. 과거 이런 날 뒤 3개월 안에 5% 넘게 더 빠진 경우가 ${f.down5Pct}%, 10% 넘게 더 빠진 경우가 ${f.down10Pct}%였습니다. ` +
    `한 번에 몰아서 사거나 팔지 말고 정해 둔 계획대로 하세요.`
  const vsBase =
    f.down10Pct >= base.down10Pct + 5
      ? `평소 아무 날(10% 더 빠진 경우 ${base.down10Pct}%)보다 높았습니다.`
      : `평소 아무 날(10% 더 빠진 경우 ${base.down10Pct}%)과 큰 차이가 없습니다 — 큰 하락 뒤라서 바닥이 가까운 것도, 더 위험한 것도 아니었습니다.`

  return { dayLabel, headline, sub: subParts.join(' · '), caution, us, foreign, after: `${after} 추가 하락 비율은 ${vsBase}` }
}

/** 자료를 만든 지 180일이 넘었는지(planGuide.isFactStale과 같은 기준). planGuide는 큰 장기 데이터를 끌고 와 대시보드에서 직접 쓰지 않는다 */
export function dropDayFactsStale(today: Date = new Date()): boolean {
  const t = Date.parse(DROP_DAY_META.generated)
  return Number.isFinite(t) && (today.getTime() - t) / 86_400_000 > 180
}

/** 급등 기준(%). 신고가 날은 하락 카드와 같은 크기(+1.5%) 이상 오른 날만 보여 준다(상승장에서 매일 뜨지 않게) */
export const NEW_HIGH_MIN_CHANGE_PCT = 1.5

export type RallyLines = { kind: 'surge' | 'newHigh'; dayLabel: string; headline: string; sub: string; caution: string; foreign: string | null; after: string }

/** +3% 이상 급등일, 또는 +1.5% 이상 오르며 52주 신고가인 날. 아니면 null */
export function rallyLines(view: DropDayView, todayKst: string): RallyLines | null {
  if (!Number.isFinite(view.changePct)) return null
  const { surge, newHigh, baseH250 } = DROP_DAY_FACTS.rally
  const base10 = DROP_DAY_FACTS.baseFurther60.down10Pct
  const isSurge = view.changePct >= surge.threshold
  const isNewHigh = view.newHigh52w === true && view.changePct >= NEW_HIGH_MIN_CHANGE_PCT
  if (!isSurge && !isNewHigh) return null
  const dayLabel = dayLabelOf(view.asOf, todayKst)
  const foreign = foreignText(view.foreign)
  const plan = '몰아서 사지 말고 적립일에 계획대로 하세요.'

  if (isSurge) {
    const f = surge.further60
    const nth = view.yearCounts[`+${surge.threshold}`] ?? 0
    const sub = [view.newHigh52w ? '52주 신고가' : null, nth > 0 ? `올해 ${nth}번째(+${surge.threshold}% 이상 기준)` : null].filter(Boolean).join(' · ')
    const shaky = f.down10Pct >= base10 + 5
    return {
      kind: 'surge',
      dayLabel,
      headline: `${dayLabel} 코스피 ${signed(view.changePct, 2)}% — 1년에 약 ${Math.round(surge.perYear)}번 있는 급등`,
      sub,
      caution:
        `오를 때가 가장 사고 싶은 때입니다. 과거 +${surge.threshold}% 이상 급등 뒤 3개월 안에 10% 넘게 빠진 경우가 ${f.down10Pct}%(평소 ${base10}%)였습니다` +
        (shaky ? ' — 급등은 시장이 크게 흔들리는 때라는 신호였습니다. ' : '. ') + plan,
      foreign,
      after: `과거 급등 ${surge.events}번 뒤 1년 뒤 중앙 ${signed(surge.h250.medianPct)}%(오른 경우 ${surge.h250.upPct}%), 평소 아무 날은 중앙 ${signed(baseH250.medianPct)}%(${baseH250.upPct}%).`,
    }
  }

  const f = newHigh.further60
  const notWorse = f.down10Pct <= base10 && newHigh.h250.upPct >= baseH250.upPct
  return {
    kind: 'newHigh',
    dayLabel,
    headline: `${dayLabel} 코스피 52주 신고가 (${signed(view.changePct, 2)}%)`,
    sub: '',
    caution:
      (notWorse ? '늦었다고 서두를 필요도, 고점이라 피할 필요도 없습니다. ' : '고점에서는 서두르기 쉽습니다. ') +
      `과거 신고가 날 뒤 3개월 안에 10% 넘게 빠진 경우 ${f.down10Pct}%(평소 ${base10}%), 1년 뒤 오른 경우 ${newHigh.h250.upPct}%(평소 ${baseH250.upPct}%). ` + plan,
    foreign,
    after: `과거 신고가 ${newHigh.events}번(20거래일 안의 신고가는 한 번으로 셈) 뒤 1년 뒤 중앙 ${signed(newHigh.h250.medianPct)}%, 평소 아무 날은 ${signed(baseH250.medianPct)}%. 오를 때 몰아 사는 근거도, 고점이라 피하는 근거도 아닙니다.`,
  }
}
