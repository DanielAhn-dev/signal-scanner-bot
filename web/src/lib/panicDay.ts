/**
 * 최근 급락 흔적(투매일) — 종목 분석·시세 창용 안내 (H84 ⓔ). 매매를 막지 않는 참고다.
 * 투매일 = 일 −7% 이하이면서 거래대금이 직전 20일 평균의 3배 이상인 날. 최근 20거래일 안에 있으면 '있음'.
 * 과거 수치는 거래대금 상위 300급 대형주에서만 의미가 확인돼서(301~600위는 변동성 통제 후 약함) 그 크기 이상일 때만 보여 준다.
 */
import { PANIC_DAY_META, PANIC_DAY_STATS } from '../data/panicDayStats'

export type PanicBar = { date: string; close: number | null; volume: number | null }
type Bar = { date: string; close: number; volume: number }
export type PanicDay = { date: string; changePct: number; valueMult: number }
export type PanicResult = { days: PanicDay[]; tv20: number }

const DROP = -0.07
const MULT = 3
const WINDOW = 20
const STALE_DAYS = 180

const ok = (n: number | null): n is number => n != null && Number.isFinite(n) && n > 0

/** 막대는 날짜 오름차순으로 정렬해 쓴다. 최근 20거래일 + 그 앞 20일 평균 + 전날 종가가 필요해 41봉 미만이면 null. */
export function findPanicDays(bars: PanicBar[]): PanicResult | null {
  const b = bars
    .filter((x): x is Bar => ok(x.close) && x.volume != null && Number.isFinite(x.volume) && x.volume >= 0)
    .sort((a, c) => a.date.localeCompare(c.date))
  const n = b.length
  if (n < WINDOW * 2 + 1) return null
  const tv = b.map((x) => x.close * x.volume)
  const avg = (end: number) => tv.slice(end - WINDOW + 1, end + 1).reduce((s, v) => s + v, 0) / WINDOW // end 포함 20일 평균
  const days: PanicDay[] = []
  for (let t = n - WINDOW; t < n; t++) {
    const ref = avg(t - 1)
    const chg = b[t].close / b[t - 1].close - 1
    if (ref > 0 && chg <= DROP && tv[t] / ref >= MULT) days.push({ date: b[t].date, changePct: chg * 100, valueMult: tv[t] / ref })
  }
  return { days, tv20: avg(n - 2) }
}

export type PanicNote = {
  headline: string
  detail: string
  fold: string
  stale: boolean
}

const mmdd = (d: string) => (d.length >= 10 ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : d)

export function panicNote(bars: PanicBar[], today = new Date()): PanicNote | null {
  const r = findPanicDays(bars)
  if (!r || !r.days.length || r.tv20 < PANIC_DAY_STATS.tv20Top300) return null
  const last = r.days[r.days.length - 1]
  const S = PANIC_DAY_STATS
  const age = (today.getTime() - new Date(PANIC_DAY_META.generated).getTime()) / 86400000
  const more = r.days.length > 1 ? ` 외 ${r.days.length - 1}번` : ''
  return {
    headline: `최근 4주 안에 ${mmdd(last.date)}에 ${last.changePct.toFixed(1)}% 급락(거래대금 ${last.valueMult.toFixed(1)}배)이 있었어요${more}.`,
    detail: `과거 이런 대형주는 이후 석 달 안에 20% 넘게 떨어진 비율이 ${S.on}%로, 그런 날이 없던 종목(${S.off}%)보다 잦았어요.`,
    fold: `거래대금 상위 300급 종목, ${S.first.slice(0, 4)}~${S.last.slice(0, 4)}년 월말 기준 ${S.months}개월 비교. 변동성이 비슷한 종목끼리 비교하면 차이가 ${S.ctrl}%p로 줄어요(상당 부분은 원래 흔들리는 종목이라는 뜻). 거래대금 301~600위 종목에서는 이 차이가 뚜렷하지 않아 보여 주지 않아요. 매매 신호가 아니라 참고예요. ${PANIC_DAY_META.generated} 생성${age > STALE_DAYS ? ' · ⚠️ 생성한 지 오래된 수치' : ''}`,
    stale: age > STALE_DAYS,
  }
}
