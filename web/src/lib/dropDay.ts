// 큰 하락일 카드 문구. 원인을 단정하지 않고 '얼마나 흔한 일인지'와 '같이 움직인 것'만 말한다(예측 아님).
// 실시간 값은 /api/market-overview의 dropDay(src/services/dropDayContext.ts), 고정 수치는 data/dropDayFacts.ts.
import { DROP_DAY_FACTS, DROP_DAY_META } from '../data/dropDayFacts'

/** 서버 DropDayContext와 같은 모양 */
export type DropDayView = {
  asOf: string
  changePct: number
  fromHighPct: number
  downStreak: number
  yearCounts: Record<string, number>
  foreign: { date: string; net: number; rank: number } | null
}

export type DropDayLines = {
  dayLabel: string
  headline: string
  sub: string
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

export function dropDayLines(view: DropDayView, sp500ChangePct: number | null | undefined, todayKst: string): DropDayLines | null {
  if (!Number.isFinite(view.changePct)) return null
  const bucket = pickDropBucket(view.changePct)
  if (!bucket) return null
  const t = String(bucket.threshold)
  const dayLabel = view.asOf === todayKst ? '오늘' : `${Number(view.asOf.slice(5, 7))}월 ${Number(view.asOf.slice(8, 10))}일`
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

  let foreign: string | null = null
  if (view.foreign) {
    const { net, rank } = view.foreign
    const amount = `${Math.abs(Math.round(net)).toLocaleString('ko-KR')}억원 ${net < 0 ? '순매도' : '순매수'}`
    const where =
      rank <= 0.1 ? `최근 1년 중 가장 많이 판 쪽 ${Math.max(1, Math.round(rank * 100))}% 안` : rank >= 0.9 ? '최근 1년 중 많이 산 편' : '최근 1년 평소 범위'
    foreign = `외국인 ${amount} — ${where}`
  }

  const h60 = bucket.h60
  const h250 = bucket.h250
  const after =
    `과거 ${signed(bucket.threshold)}% 이하 하락 ${bucket.events}번 뒤: 3개월 뒤 중앙 ${signed(h60.medianPct)}%(오른 경우 ${h60.upPct}%), ` +
    `1년 뒤 중앙 ${signed(h250.medianPct)}%(오른 경우 ${h250.upPct}%). 1년 뒤에도 마이너스였던 때가 ${100 - h250.upPct}% 있었습니다.`

  return { dayLabel, headline, sub: subParts.join(' · '), us, foreign, after }
}

/** 자료를 만든 지 180일이 넘었는지(planGuide.isFactStale과 같은 기준). planGuide는 큰 장기 데이터를 끌고 와 대시보드에서 직접 쓰지 않는다 */
export function dropDayFactsStale(today: Date = new Date()): boolean {
  const t = Date.parse(DROP_DAY_META.generated)
  return Number.isFinite(t) && (today.getTime() - t) / 86_400_000 > 180
}
