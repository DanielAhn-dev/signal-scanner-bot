/**
 * 경제 일정 공식 출처 페이지 해석 — 순수 함수만 둔다(수집은 scripts/economic_calendar_sync.ts).
 * 출처마다 다음 해 일정을 미리 공개하므로, 주기적으로 받아 두면 하드코딩 일정을 사람이 갱신하지 않아도 된다.
 *
 * - BLS(CPI·PPI·고용): bls.gov/schedule/news_release/{cpi,ppi,empsit}.htm — 봇 이름을 밝힌 User-Agent가 있어야 403이 안 난다
 * - BEA(GDP·PCE): bea.gov/news/schedule(올해), /news/schedule/next-year(다음 해) — ICS 구독 파일은 2025-09에 멈춰 있어 쓰지 않는다
 * - 연준(FOMC): federalreserve.gov/monetarypolicy/fomccalendars.htm
 * - 한국은행(기준금리): bok.or.kr 통화정책방향 결정회의 일정(?pYear=YYYY), 다음 해 일정은 보통 10월 말 공개
 */

export type SyncedEventKind = 'us-cpi' | 'us-ppi' | 'us-nfp' | 'us-gdp' | 'us-pce' | 'us-fomc' | 'kr-base-rate'

export type SyncedEvent = { kind: SyncedEventKind; date: string }

export type SyncedSourceStatus = {
  fetchedAt: string
  ok: boolean
  error?: string
  /** 마지막으로 성공한 수집 결과 — 실패하면 이전 값을 유지한다 */
  events: SyncedEvent[]
}

export type SyncedCalendarFile = {
  generatedAt: string
  sources: Record<string, SyncedSourceStatus>
}

export const SYNCED_CALENDAR_BUCKET = 'market-snapshots'
export const SYNCED_CALENDAR_PATH = 'economic-calendar/official.json'

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

function ymd(year: number, month: number, day: number): string | null {
  if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31)) return null
  const d = new Date(Date.UTC(year, month - 1, day))
  if (d.getUTCMonth() !== month - 1) return null
  return d.toISOString().slice(0, 10)
}

function monthIndex(name: string): number {
  return MONTHS.indexOf(name.trim().slice(0, 3).toLowerCase()) + 1
}

/** BLS 발표 일정표: `<td>October 2026</td><td>Nov. 10, 2026</td><td>08:30 AM</td>` 행에서 발표일만 뽑는다. */
export function parseBlsSchedule(html: string, kind: SyncedEventKind): SyncedEvent[] {
  const out: SyncedEvent[] = []
  const re = /<td>\s*[A-Za-z]+\.?\s+\d{4}\s*<\/td>\s*<td>\s*([A-Za-z]+)\.?\s+(\d{1,2}),\s*(\d{4})\s*<\/td>/g
  for (const m of html.matchAll(re)) {
    const date = ymd(Number(m[3]), monthIndex(m[1]), Number(m[2]))
    if (date) out.push({ kind, date })
  }
  return dedupe(out)
}

/**
 * BEA 발표 일정표: 표마다 머리글이 `Year 2027`이고, 행은 `<div class="release-date">January 28</div>` + 제목 칸.
 * GDP는 제목이 "GDP ("로 시작하는 행(속보·잠정·확정치), PCE는 "Personal Income and Outlays" 행.
 */
export function parseBeaSchedule(html: string): SyncedEvent[] {
  const out: SyncedEvent[] = []
  const flat = html.replace(/\s+/g, ' ')
  for (const table of flat.split(/<table\b/).slice(1)) {
    const year = Number(table.match(/>\s*Year (\d{4})\s*</)?.[1])
    if (!year) continue
    const rowRe = /<div class="release-date">\s*([A-Za-z]+)\s+(\d{1,2})\s*<\/div>.*?release-title[^>]*>([^<]*)</g
    for (const m of table.matchAll(rowRe)) {
      const date = ymd(year, monthIndex(m[1]), Number(m[2]))
      const title = m[3].trim()
      if (!date) continue
      if (/^GDP \(/.test(title)) out.push({ kind: 'us-gdp', date })
      else if (/^Personal Income and Outlays/.test(title)) out.push({ kind: 'us-pce', date })
    }
  }
  return dedupe(out)
}

/**
 * 연준 FOMC 일정: 연도 패널(`2027 FOMC Meetings`)마다 월(`April/May`)·날짜(`30-1*`) 칸.
 * 결정 발표는 회의 마지막 날이다. 임시 회의(unscheduled)·서면 의결(notation vote)은 미리 정해진 일정이 아니라 뺀다.
 */
export function parseFedCalendar(html: string): SyncedEvent[] {
  const out: SyncedEvent[] = []
  const flat = html.replace(/\s+/g, ' ')
  const panels = flat.split(/>(\d{4}) FOMC Meetings</)
  for (let i = 1; i + 1 < panels.length; i += 2) {
    const year = Number(panels[i])
    const body = panels[i + 1]
    const re = /fomc-meeting__month[^>]*>\s*<strong>([^<]+)<\/strong>.*?fomc-meeting__date[^>]*>([^<]+)</g
    for (const m of body.matchAll(re)) {
      const dateText = m[2].trim()
      if (/unscheduled|notation/i.test(dateText)) continue
      const months = m[1].split('/')
      const day = Number(dateText.match(/(\d{1,2})\D*$/)?.[1] ?? dateText.match(/(\d{1,2})/)?.[1])
      const date = ymd(year, monthIndex(months[months.length - 1]), day)
      if (date) out.push({ kind: 'us-fomc', date })
    }
  }
  return dedupe(out)
}

/** 한국은행 통화정책방향 결정회의 일정: 연도별 페이지의 `01월 15일(목)` 항목. 아직 공개 전이면 빈 배열. */
export function parseBokSchedule(html: string, year: number): SyncedEvent[] {
  const out: SyncedEvent[] = []
  for (const m of html.matchAll(/(\d{1,2})월\s*(\d{1,2})일\s*\([월화수목금토일]\)/g)) {
    const date = ymd(year, Number(m[1]), Number(m[2]))
    if (date) out.push({ kind: 'kr-base-rate', date })
  }
  return dedupe(out)
}

function dedupe(events: SyncedEvent[]): SyncedEvent[] {
  const seen = new Set<string>()
  return events
    .filter((e) => {
      const k = `${e.kind}|${e.date}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    .sort((a, b) => a.date.localeCompare(b.date))
}
