import { useEffect, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/api'
import { useCurrentChatId, useCurrentClientId } from '../../stores/profileStore'
import type { EconomicEvent } from '../../../../src/types/economics'
import '../accumulate/accumulate.css'
import './briefing.css'

/**
 * 오늘 시장 — 시장이 지금 어디를 보고 있나(뜨는·식는 테마)와 내 보유가 이어진 테마의 근거를 매일 한 화면에.
 * 테마는 고정 목록이 아니라 네이버 테마 전체에서 매일 자동으로 고른다. 판정은 매매 신호가 아니다.
 * 서버: /api/ui?route=market-themes (공개), my-themes (신원), market-overview·economic-calendar (기존 시장 화면과 같은 출처)
 * 계산: src/lib/themeFlow.ts · 수집: scripts/collect_market_themes.ts
 */

type NewsItem = { title: string; link: string; office: string; at: string; tone: 'pos' | 'neg' | 'neutral' }

type FlowItem = {
  themeNo: number
  name: string
  rank: number
  ret5: number
  breadth5: number | null
  valueRatio: number | null
  news5: number
  newsRatio: number | null
  daysUsed: number
  isNew: boolean
  news: NewsItem[]
  peakRank?: number
}

type ThemeFlowData = { asOf: string | null; daysCollected: number; hot: FlowItem[]; cooling: FlowItem[]; recentDays: number; baselineDays: number }

type Level = 'strong' | 'normal' | 'weak' | 'unknown'
type Overall = 'strong' | 'weak' | 'mixed' | 'pending'

type MyHolding = {
  code: string
  name: string
  isEtf: boolean
  category: string | null
  topWeightCovered: number | null
  links: Array<{ themeNo: number; name: string; overlap: number; matched: string[] }>
  primaryTheme: { themeNo: number; name: string; news: NewsItem[] } | null
  evidence: { signals: Array<{ key: string; label: string; level: Level; detail: string }>; overall: Overall }
}

type MyThemesData = {
  asOf: string | null
  holdings: MyHolding[]
  rules: { breadthStrong: number; breadthWeak: number; newsStrong: number; newsWeak: number; valueStrong: number; valueWeak: number }
  themeError: string | null
}

type Idx = { price: number; changeRate: number }

const LEVEL_LABEL: Record<Level, string> = { strong: '강함', normal: '보통', weak: '약함', unknown: '모름' }
const OVERALL_LABEL: Record<Overall, string> = { strong: '흐름 강함', weak: '흐름 약함', mixed: '엇갈림', pending: '판단 보류' }
const OVERALL_NOTE: Record<Overall, string> = {
  strong: '여러 신호가 같은 쪽(강함)을 가리킵니다.',
  weak: '여러 신호가 같은 쪽(약함)을 가리킵니다. 처음 정한 이유가 아직 맞는지 다시 볼 때입니다.',
  mixed: '신호가 한쪽으로 모이지 않았습니다. 하루이틀 움직임으로 생각을 바꿀 근거는 아닙니다.',
  pending: '판단할 신호가 아직 모자랍니다(테마 기록을 쌓는 중).',
}

const signed = (x: number, d = 1) => `${x >= 0 ? '+' : ''}${x.toFixed(d)}%`
const tone = (x: number) => (x > 0 ? 'bf-up' : x < 0 ? 'bf-down' : '')
const newsTime = (at: string) => (at.length >= 12 ? `${Number(at.slice(4, 6))}/${Number(at.slice(6, 8))} ${at.slice(8, 10)}:${at.slice(10, 12)}` : '')

/** KST 오늘 기준 며칠 지났나 (주말 포함 달력일) */
function daysSince(dateKey: string | null): number | null {
  if (!dateKey) return null
  const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10)
  return Math.round((Date.parse(today) - Date.parse(dateKey)) / 86_400_000)
}

/** 주말을 끼면 3일까지는 정상, 그보다 오래면 갱신 지연 */
const STALE_DAYS = 4

const CHIPS: Array<{ key: string; label: string; digits: number }> = [
  { key: 'kospi', label: '코스피', digits: 2 },
  { key: 'kosdaq', label: '코스닥', digits: 2 },
  { key: 'sp500', label: 'S&P500', digits: 2 },
  { key: 'nasdaq', label: '나스닥', digits: 2 },
  { key: 'usdkrw', label: '원/달러', digits: 1 },
  { key: 'us10y', label: '미 10년 금리', digits: 2 },
  { key: 'vix', label: 'VIX', digits: 2 },
  { key: 'wtiOil', label: 'WTI 유가', digits: 2 },
]

function MarketChips() {
  const navigate = useNavigate()
  const [indices, setIndices] = useState<Record<string, Idx | undefined> | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    apiFetch('/api/ui?route=market-overview', { cacheMs: 60_000, timeoutMs: 20_000, retries: 0 })
      .then((res) => { if (active) setIndices(res?.data?.indices ?? null) })
      .catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [])
  return (
    <section className="acc-card" aria-label="한눈에">
      <div className="bf-head">
        <h2>한눈에</h2>
        <button type="button" className="bf-link" onClick={() => navigate('/market')}>시장 화면에서 자세히 <ChevronRight size={14} /></button>
      </div>
      {failed ? <p className="acc-note">시세를 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.</p> : !indices ? <p className="acc-note">불러오는 중…</p> : (
        <ul className="bf-chips">
          {CHIPS.map((c) => {
            const v = indices[c.key]
            if (!v || !Number.isFinite(v.price) || v.price <= 0) return null
            return (
              <li key={c.key}>
                <span className="bf-chip__label">{c.label}</span>
                <span className="bf-chip__value">{v.price.toLocaleString('ko-KR', { maximumFractionDigits: c.digits })}</span>
                <span className={`bf-chip__chg ${tone(v.changeRate)}`}>{signed(v.changeRate, 2)}</span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

function NewsList({ items, limit = 2 }: { items: NewsItem[]; limit?: number }) {
  if (!items.length) return null
  const shown = items.slice(0, limit)
  // 부정 기사가 있으면 하나는 꼭 보이게 (한쪽 기사만 보이지 않게)
  const neg = items.find((n) => n.tone === 'neg')
  if (neg && !shown.includes(neg)) shown[shown.length - 1] = neg
  return (
    <ul className="bf-news">
      {shown.map((n) => (
        <li key={n.link}>
          <a href={n.link} target="_blank" rel="noreferrer">{n.title}</a>
          <span className="bf-muted"> {n.office} {newsTime(n.at)}{n.tone === 'neg' ? ' · 부정적 기사' : ''}</span>
        </li>
      ))}
    </ul>
  )
}

function FlowRow({ t, cooling }: { t: FlowItem; cooling?: boolean }) {
  return (
    <li className="bf-flow">
      <div className="bf-flow__head">
        <span className="bf-flow__rank">{cooling ? `최고 ${t.peakRank}위` : `${t.rank}`}</span>
        <span className="bf-flow__name">{t.name}</span>
        {t.isNew && <span className="bf-tag">새로 등장</span>}
      </div>
      <div className="bf-flow__facts">
        <span>{t.daysUsed}일 <b className={tone(t.ret5)}>{signed(t.ret5)}</b></span>
        {t.breadth5 != null && <span>오른 종목 {Math.round(t.breadth5 * 100)}%</span>}
        <span>뉴스 {t.news5}건{t.newsRatio != null ? ` (평소의 ${t.newsRatio.toFixed(1)}배)` : ''}</span>
        {t.valueRatio != null && <span>거래대금 평소의 {t.valueRatio.toFixed(1)}배</span>}
      </div>
      <NewsList items={t.news} />
    </li>
  )
}

function ThemeFlowSection() {
  const [data, setData] = useState<ThemeFlowData | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    apiFetch('/api/ui?route=market-themes', { cacheMs: 300_000, timeoutMs: 20_000, retries: 1 })
      .then((res) => { if (active) setData(res?.data ?? null) })
      .catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [])

  const age = daysSince(data?.asOf ?? null)
  return (
    <section className="acc-card" aria-label="테마 흐름">
      <div className="bf-head">
        <h2>지금 시장이 보는 테마</h2>
        {data?.asOf && <span className="bf-muted">{data.asOf} 장 마감 기준</span>}
      </div>
      {failed ? <p className="acc-note">테마 기록을 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.</p>
        : !data ? <p className="acc-note">불러오는 중…</p>
        : !data.asOf ? <p className="acc-note">테마 기록을 아직 모으기 전입니다. 장 마감 뒤 첫 수집이 끝나면 여기에 나옵니다.</p>
        : (
          <>
            {age != null && age > STALE_DAYS && <p className="acc-warn">갱신 지연: 마지막 기록이 {age}일 전입니다. 아래 숫자는 그때 기준입니다.</p>}
            <p className="acc-note">
              네이버 테마 전체(약 260개)에서 최근 {data.recentDays}거래일 등락·오른 종목 비율·거래대금·뉴스 언급을 합쳐 매일 다시 고릅니다.
              {data.daysCollected < data.recentDays + 5 ? ` 기록이 ${data.daysCollected}일치뿐이라 '평소 대비'는 쌓이는 대로 채워집니다.` : ''}
            </p>
            <h3>떠오르는 테마</h3>
            <ol className="bf-flows">{data.hot.map((t) => <FlowRow key={t.themeNo} t={t} />)}</ol>
            {data.cooling.length > 0 && (
              <>
                <h3>식는 테마</h3>
                <p className="acc-note">최근 2주 안에 10위 안에 들었다가 지금은 순위가 내려가고 5일 등락이 마이너스인 테마입니다.</p>
                <ol className="bf-flows">{data.cooling.map((t) => <FlowRow key={t.themeNo} t={t} cooling />)}</ol>
              </>
            )}
            <p className="bf-caution">
              알아두기용입니다. 급하게 오른 뒤 따라 사는 것은 과거 검증에서 불리했습니다(급등 5일 매수 회피 규칙). 이 순위는 매수·매도 신호가 아닙니다.
            </p>
          </>
        )}
    </section>
  )
}

function MyThemesSection() {
  const navigate = useNavigate()
  const chatId = useCurrentChatId()
  const clientId = useCurrentClientId()
  const [data, setData] = useState<MyThemesData | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (!chatId && !clientId) return
    let active = true
    setFailed(false)
    apiFetch('/api/ui?route=my-themes', { cacheMs: 300_000, timeoutMs: 30_000, retries: 0 })
      .then((res) => { if (active) setData(res?.data ?? null) })
      .catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [chatId, clientId])

  if (!chatId && !clientId) return null
  return (
    <section className="acc-card" aria-label="내 보유와 이어진 테마">
      <div className="bf-head">
        <h2>내 보유와 이어진 테마</h2>
        {data?.asOf && <span className="bf-muted">테마 {data.asOf} 기준</span>}
      </div>
      <p className="acc-note">
        보유 종목(ETF는 상위 10종목)이 어느 테마에 들어 있는지 자동으로 잇고, 지금 시장이 그 테마를 어떻게 보는지 네 가지로 나눠 보여 줍니다.
        팔거나 사라는 뜻이 아닙니다. 처음 정한 이유가 아직 맞는지 볼 때 쓰세요.
      </p>
      {failed ? <p className="acc-note">불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.</p>
        : !data ? <p className="acc-note">불러오는 중…</p>
        : !data.holdings.length ? (
          <p className="acc-note">
            입력한 실계좌 보유가 없습니다.{' '}
            <button type="button" className="bf-link" onClick={() => navigate('/portfolio')}>포트폴리오에서 보유 입력 <ChevronRight size={14} /></button>
          </p>
        ) : (
          <>
            {data.themeError && <p className="acc-warn">테마 기록을 읽지 못해 가격 흐름만 보입니다.</p>}
            <div className="bf-holdings">
              {data.holdings.map((h) => <HoldingCard key={h.code} h={h} />)}
            </div>
            <details className="bf-rules">
              <summary>판정 기준 (미리 정해 둔 값)</summary>
              <ul>
                <li>가격 흐름: 200일선 위이고 3달 등락이 0 이상이면 강함, 200일선 아래이고 3달 마이너스면 약함</li>
                <li>종목 폭: 최근 5거래일 평균으로 오른 종목 {Math.round(data.rules.breadthStrong * 100)}% 이상 강함, {Math.round(data.rules.breadthWeak * 100)}% 이하 약함</li>
                <li>언론 관심: 최근 5일 언급이 평소(앞 20거래일)의 {data.rules.newsStrong}배 이상 강함, {data.rules.newsWeak}배 이하 약함</li>
                <li>거래 관심: 최근 5일 거래대금이 평소의 {data.rules.valueStrong}배 이상 강함, {data.rules.valueWeak}배 이하 약함</li>
                <li>종합: 같은 쪽 신호가 2개 이상이고 그중 하나는 가격이 아니며 반대쪽 신호가 없을 때만 강함·약함. 가격만 빠져서는 약함이 되지 않습니다.</li>
              </ul>
            </details>
          </>
        )}
    </section>
  )
}

function HoldingCard({ h }: { h: MyHolding }) {
  const p = h.primaryTheme
  const link = h.links[0]
  return (
    <article className="bf-holding">
      <div className="bf-holding__head">
        <span className="bf-holding__name">{h.name}</span>
        {h.category && <span className="bf-muted">네이버 분류 {h.category}</span>}
      </div>
      {!link ? (
        <p className="acc-note">이어진 테마를 찾지 못했습니다{h.isEtf ? ' (상위 10종목이 한 테마에 15% 이상 몰려 있지 않음)' : ''}.</p>
      ) : (
        <p className="bf-holding__link">
          <b>{link.name}</b>
          <span className="bf-muted"> · {h.isEtf ? `상위 10종목 중 ${Math.round(link.overlap * 100)}%` : '이 종목이 속한 테마'}{link.matched.length && h.isEtf ? ` (${link.matched.slice(0, 4).join(', ')})` : ''}</span>
          {h.links[1] && <span className="bf-muted"> · 함께: {h.links[1].name} {Math.round(h.links[1].overlap * 100)}%</span>}
        </p>
      )}
      <div className={`bf-overall bf-overall--${h.evidence.overall}`}>
        <b>{OVERALL_LABEL[h.evidence.overall]}</b>
        <span>{OVERALL_NOTE[h.evidence.overall]}</span>
      </div>
      <dl className="bf-signals">
        {h.evidence.signals.map((s) => (
          <div key={s.key}>
            <dt>{s.label}</dt>
            <dd><span className={`bf-level bf-level--${s.level}`}>{LEVEL_LABEL[s.level]}</span> <span className="bf-muted">{s.detail}</span></dd>
          </div>
        ))}
      </dl>
      {p && <NewsList items={p.news} limit={3} />}
    </article>
  )
}

function WeekCalendar() {
  const navigate = useNavigate()
  const [events, setEvents] = useState<EconomicEvent[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    apiFetch('/api/ui?route=economic-calendar', { cacheMs: 3_600_000, timeoutMs: 10_000, retries: 1 })
      .then((res) => { if (active) setEvents(res?.data?.events ?? []) })
      .catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [])
  const now = Date.now()
  const week = (events ?? [])
    .filter((e) => (e.importance === 'high' || e.importance === 'critical'))
    .filter((e) => { const t = Date.parse(e.scheduledAt); return t >= now - 86_400_000 && t <= now + 7 * 86_400_000 })
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
  return (
    <section className="acc-card" aria-label="이번 주 큰 일정">
      <div className="bf-head">
        <h2>이번 주 큰 일정</h2>
        <button type="button" className="bf-link" onClick={() => navigate('/market')}>전체 일정 <ChevronRight size={14} /></button>
      </div>
      {failed ? <p className="acc-note">일정을 불러오지 못했습니다.</p> : !events ? <p className="acc-note">불러오는 중…</p> : !week.length ? (
        <p className="acc-note">앞으로 7일 안에 중요도 높은 경제 일정이 없습니다.</p>
      ) : (
        <ul className="bf-events">
          {week.map((e) => {
            const d = new Date(e.scheduledAt)
            const done = e.actualValue !== undefined || d.getTime() < now
            return (
              <li key={e.id} className={done ? 'is-done' : ''}>
                <span className="bf-events__when">{d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                <span className="bf-events__name">{e.name}</span>
                <span className="bf-muted">{done ? (e.actualValue !== undefined ? `발표 ${e.actualValue}${e.unit ?? ''}` : '지남') : e.forecastValue !== undefined ? `예상 ${e.forecastValue}${e.unit ?? ''}` : ''}</span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

export default function BriefingPage() {
  return (
    <div className="acc bf">
      <header>
        <p className="acc-eyebrow">오늘 시장</p>
        <h1>시장이 지금 어디를 보고 있나</h1>
        <p>테마는 정해 두지 않고 매일 데이터로 다시 고릅니다. 흐름을 알기 위한 화면이며, 매매 판단은 각자의 계획을 따릅니다. 미래 수익을 약속하지 않습니다.</p>
      </header>
      <MarketChips />
      <ThemeFlowSection />
      <MyThemesSection />
      <WeekCalendar />
      <p className="bf-foot">출처: 네이버 증권 테마·주요 뉴스(장 마감 뒤 하루 한 번 수집), 시세·경제 일정은 시장 화면과 같은 출처.</p>
    </div>
  )
}
