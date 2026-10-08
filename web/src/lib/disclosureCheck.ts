/**
 * "이 종목 공시 점검" 문구 — 서버가 준 최근 1년 공시(사실)에 과거 검증 수치(disclosureStats.ts)를 붙인다.
 * 위험 범주는 평균이 아니라 '크게 뒤처진 비율'을 보여 준다: 평균은 표본이 작고 부호가 흔들렸지만(C44)
 * −30% 이하 비율은 모든 범주에서 평소보다 높았다. 매수·매도 지시가 아니라 참고 안내다.
 */
import { DISCLOSURE_STATS, DISCLOSURE_STATS_META } from '../data/disclosureStats'

export type DisclosureItem = { category: string; label: string; date: string; reportName: string; rceptNo: string }
export type DisclosureLine = { category: string; label: string; count: number; lastDate: string; lastRceptNo: string; tone: 'risk' | 'neutral'; evidence: string }

const SMALL_SAMPLE = 200
const STALE_DAYS = 180

const fmtDate = (d: string) => (d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d)

export function disclosureLines(items: DisclosureItem[]): DisclosureLine[] {
  const by = new Map<string, DisclosureItem[]>()
  for (const it of items) by.set(it.category, [...(by.get(it.category) ?? []), it])
  const lines: DisclosureLine[] = []
  for (const [category, list] of by) {
    const latest = [...list].sort((a, b) => b.date.localeCompare(a.date))[0]
    const st = DISCLOSURE_STATS[category]
    let evidence = ''
    if (st && category === 'buyback') {
      evidence = `과거 자사주 취득 공시 뒤 60거래일 수익은 지수와 뚜렷한 차이가 없었어요(평균 ${st.mean60 > 0 ? '+' : ''}${st.mean60}%, ${st.n.toLocaleString('ko-KR')}건).`
    } else if (st) {
      evidence = `과거 이런 공시가 난 종목은 60거래일 안에 지수보다 30% 넘게 뒤처진 경우가 ${st.tail30}%로, 평소(${st.tail30Base}%)보다 잦았어요(${st.n.toLocaleString('ko-KR')}건${st.n < SMALL_SAMPLE ? ', 표본 적음' : ''}).`
    }
    lines.push({
      category,
      label: latest.label,
      count: list.length,
      lastDate: fmtDate(latest.date),
      lastRceptNo: latest.rceptNo,
      tone: category === 'buyback' ? 'neutral' : 'risk',
      evidence,
    })
  }
  // 위험 먼저, 그다음 최근 순
  return lines.sort((a, b) => (a.tone === b.tone ? b.lastDate.localeCompare(a.lastDate) : a.tone === 'risk' ? -1 : 1))
}

export function disclosureSourceNote(today = new Date()): { text: string; stale: boolean } {
  const m = DISCLOSURE_STATS_META
  const ageDays = (today.getTime() - new Date(m.generated).getTime()) / 86400000
  const period = m.period.replace(/(\d{4})(\d{2})(\d{2})/g, '$1-$2-$3')
  return {
    text: `과거 수치: ${period} · ${m.method} · ${m.source} · ${m.generated} 생성`,
    stale: ageDays > STALE_DAYS,
  }
}

export const dartViewerUrl = (rceptNo: string) => `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${encodeURIComponent(rceptNo)}`
