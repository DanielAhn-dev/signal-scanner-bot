import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AmountHint from '../../components/ui/AmountHint'
import More from '../../components/ui/More'
import { apiFetch } from '../../lib/api'
import { formatKrwMan } from '../../lib/format'
import { useCurrentClientId } from '../../stores/profileStore'
import { useUserState } from '../../lib/userState'
import StockSearchInput from '../../components/StockSearchInput'
import { dropPlanLines, sanitizeDropPlan, type DropPlan } from '../../lib/dropPlan'
import { INDEX_ETF_CANDIDATES } from '../../data/accumulateData'
import { useIndexEtfCandidates } from '../../lib/indexEtfLive'
import {
  EMPTY_STATE,
  PLAIN_TAX_DRAG_ANNUAL,
  KOSPI_HISTORY,
  averageReceived,
  candidateDataAgeDays,
  currentYmKst,
  monthsToGain,
  overseasHistoryFor,
  recommendCandidate,
  requiredMonthly,
  simulateDca,
  situationGuide,
  summarize,
  toMonthly,
  trackSummary,
  upsertMonth,
  type AccumulateState,
  type Candle,
  type Freq,
  type Goal,
  type HistorySeries,
  type SimResult,
} from '../../lib/accumulate'
import SplitPlanCard from './SplitPlanCard'
import SavingProgressCard from '../saving-progress/SavingProgressCard'
import MyPlanCard from '../my-plan/MyPlanCard'
import { useGoalTracker } from '../goal-tracker/useGoalTracker'
import { useLocation } from 'react-router-dom'
import PeriodSim from './PeriodSim'
import './accumulate.css'

const man = formatKrwMan
const won = (v: number) => `${Math.round(v).toLocaleString('ko-KR')}원`
const num = (v: string) => { const n = Number(v.replace(/,/g, '').trim()); return Number.isFinite(n) && n > 0 ? n : 0 }
const STALE_CANDIDATE_DAYS = 90
/** 지수 ETF 후보는 같은 지수를 따라가므로 시세 판단은 가장 이력이 긴 KODEX 200으로 한다 */
const INDEX_PRICE_CODE = '069500'

/** 해외지수 이력으로 계산할 때의 한계 — 짧은 기간·좋았던 구간·환율 */
function OverseasLimits({ h }: { h: HistorySeries }) {
  const first = h.monthly[0][0]
  const spanYears = Math.floor(h.monthly.length / 12)
  return (
    <div className="acc-note">
      <p>아래 시뮬레이션은 이 상품이 따르는 <strong>{h.name}</strong> 이력({ymLabel(first)} ~ {h.asOf}, {h.source})으로 계산합니다. 원화로 바꾼 월말 가격(분배금 반영)입니다.</p>
      <ul className="acc-limits">
        <li>약 {spanYears}년치뿐이라 긴 기간일수록 비교할 시작점이 적습니다. 시작점이 모자라면 계산하지 않습니다.</li>
        <li>{h.id === 'nasdaq100' ? '이 기간은 미국 기술주가 유난히 강했던 구간입니다.' : '이 기간은 미국 주식이 다른 나라보다 강했던 구간입니다.'} 결과가 좋게 나와도 앞으로도 그렇다는 근거는 아닙니다.</li>
        <li>원화 환산이라 환율 효과가 섞여 있습니다. 원화가 강해지면 같은 지수 상승에도 덜 오릅니다.</li>
        {h.dragPct > 0 && <li>한국 상장 상품이 없던 때는 미국 ETF 가격을 쓰고, 세금·보수 몫으로 연 {h.dragPct}%를 뺐습니다(섞어보기와 같은 값).</li>}
      </ul>
    </div>
  )
}

type IncomeView = { total: number; distribution: { monthlyNet: number } } | null

const ymLabel = (ym: string) => (ym.length === 6 ? `${ym.slice(0, 4)}-${ym.slice(4)}` : ym)

function FanChart({ sim }: { sim: SimResult }) {
  const W = 640, H = 260, L = 56, R = 12, T = 12, B = 28
  const n = sim.months
  const real = sim.deepest
  const maxY = Math.max(...sim.p90, ...sim.paid, ...(real?.value ?? [])) * 1.05
  const x = (i: number) => L + ((W - L - R) * i) / n
  const y = (v: number) => T + (H - T - B) * (1 - v / maxY)
  const line = (arr: number[]) => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const band = `${line(sim.p90)} ${sim.p10.map((_, i) => `L${x(n - i).toFixed(1)},${y(sim.p10[n - i]).toFixed(1)}`).join(' ')} Z`
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => maxY * f)
  const years = Array.from({ length: Math.floor(n / 12) + 1 }, (_, i) => i * 12).filter((m) => m % (n > 84 ? 24 : 12) === 0)
  return (
    <svg className="acc-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="적립 평가금 추이: 중앙값, 하위10%, 최악, 납입액">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="acc-grid" />
          <text x={L - 6} y={y(t) + 4} textAnchor="end" className="acc-axis">{man(t)}</text>
        </g>
      ))}
      {years.map((m) => <text key={m} x={x(m)} y={H - 8} textAnchor="middle" className="acc-axis">{m / 12}년</text>)}
      <path d={band} className="acc-band" />
      <path d={line(sim.paid)} className="acc-line acc-paid" />
      <path d={line(sim.worst)} className="acc-line acc-worst" />
      <path d={line(sim.p10)} className="acc-line acc-p10" />
      <path d={line(sim.median)} className="acc-line acc-median" />
      {/* 분위수 선은 시점마다 다른 시작점 값을 이어 매끈하다 — 한 사람이 실제로 겪은 길을 점선으로 겹친다 */}
      {real && (
        <g>
          <path d={line(real.value)} className="acc-line acc-real" />
          <circle cx={x(real.troughStep)} cy={y(real.value[real.troughStep])} r={4} className="acc-trough" />
        </g>
      )}
    </svg>
  )
}

export default function AccumulatePage() {
  const clientId = useCurrentClientId()
  const { value, set } = useUserState<AccumulateState>('accumulate')
  const { value: dropPlanRaw } = useUserState<DropPlan>('dropPlan')
  const dropPlan = sanitizeDropPlan(dropPlanRaw)
  const state: AccumulateState = { ...EMPTY_STATE, ...(value ?? {}) }
  const update = (patch: Partial<AccumulateState>) => set({ ...state, ...patch })
  const ym = currentYmKst()
  const { view: goalView } = useGoalTracker()
  // 홈에서 '계획 바꾸기'·'자세히'로 오면 해당 칸으로 내린다 — 카드가 데이터를 받은 뒤에 생기므로 잠깐 기다린다
  const location = useLocation()
  useEffect(() => {
    const id = location.hash.replace('#', '')
    if (!id) return
    let tries = 0
    const timer = window.setInterval(() => {
      const el = document.getElementById(id)
      if (el || ++tries > 20) {
        window.clearInterval(timer)
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }, 150)
    return () => window.clearInterval(timer)
  }, [location.hash])

  // 입력은 화면 상태 — 저장하는 것은 기록(분배금·적립·평가금)과 대상 선택뿐이다
  const [freq, setFreq] = useState<Freq>('month')
  const [amount, setAmount] = useState('500000')
  // 계산기 처음 값은 '내 계획' 매달 금액(계획이 없거나 0이면 50만원). 사용자가 고친 뒤에는 계획이 바뀌어도 덮지 않는다
  const [planMonthly, setPlanMonthly] = useState(0)
  const amountTouched = useRef(false)
  const onPlanMonthly = useCallback((m: number) => {
    setPlanMonthly(m)
    if (m > 0 && !amountTouched.current) {
      setAmount(String(m))
      setFreq('month')
    }
  }, [])
  const resetToPlan = () => {
    amountTouched.current = false
    setAmount(String(planMonthly))
    setFreq('month')
  }
  const [years, setYears] = useState(10)
  const [mode, setMode] = useState<'direct' | 'income'>('direct')
  // 3번 카드 보기: 모든 시작 시점 분포 / 기간 하나를 골라 실제 경로
  const [pastView, setPastView] = useState<'all' | 'period'>('all')
  const [extra, setExtra] = useState('0')
  const [incomeAdj, setIncomeAdj] = useState(1)
  const [lumpText, setLumpText] = useState('')
  const [targetText, setTargetText] = useState('')
  const [goalAmount, setGoalAmount] = useState('100000000')
  const [income, setIncome] = useState<IncomeView>(null)
  const [recMonth, setRecMonth] = useState(ym)
  const [recReceived, setRecReceived] = useState('')
  const [recDeposit, setRecDeposit] = useState('')
  const [valueText, setValueText] = useState('')
  const [candles, setCandles] = useState<Candle[] | null>(null)
  const [candleError, setCandleError] = useState('')

  useEffect(() => {
    if (!clientId) return
    apiFetch('/api/ui/income-guide', { cacheMs: 0, retries: 0, timeoutMs: 20_000 })
      .then((res) => { if (res?.data?.distribution) setIncome({ total: Number(res.data.total) || 0, distribution: { monthlyNet: Number(res.data.distribution.monthlyNet) || 0 } }) })
      .catch(() => { /* 인컴 계좌를 안 쓰면 직접 입력으로 계속 쓴다 */ })
  }, [clientId])

  const etfView = useIndexEtfCandidates()
  const rec = useMemo(() => recommendCandidate(state.goal, etfView.cands, etfView.asOf), [state.goal, etfView])
  const custom = state.target
  const pick = custom ? null : rec.pick
  const targetCode = custom?.code ?? pick?.code ?? INDEX_PRICE_CODE
  const targetName = custom?.name ?? pick?.name ?? 'KODEX 200'
  const isIndexTarget = !custom || INDEX_ETF_CANDIDATES.some((c) => c.code === custom.code)
  const priceCode = isIndexTarget ? INDEX_PRICE_CODE : targetCode
  // 나스닥100·S&P500을 그대로 따르는 상품이면 그 지수 이력으로, 아니면 코스피200 이력으로 계산한다
  // 매번 새 객체면 아래 시뮬레이션이 렌더마다 다시 돈다 — 이름이 바뀔 때만
  const overseas = useMemo(() => (custom && !isIndexTarget ? overseasHistoryFor(custom.name) : null), [custom?.name, isIndexTarget])
  const history: HistorySeries = overseas ?? KOSPI_HISTORY
  const histPrices = useMemo(() => history.monthly.map(([, p]) => p), [history])
  const histMonths = useMemo(() => history.monthly.map(([m]) => m), [history])
  const drag = (state.goal === 'income' || (pick?.kind === 'plain') || (custom && INDEX_ETF_CANDIDATES.find((c) => c.code === custom.code)?.kind === 'plain') ? PLAIN_TAX_DRAG_ANNUAL : 0) + history.dragPct / 100

  useEffect(() => {
    let cancelled = false
    setCandles(null)
    setCandleError('')
    apiFetch(`/api/ui/stock-latest?code=${encodeURIComponent(priceCode)}`, { cacheMs: 0, retries: 0, timeoutMs: 20_000 })
      .then((res) => {
        if (cancelled) return
        const rows: Candle[] = (Array.isArray(res?.data) ? res.data : []).map((r: any) => ({ date: String(r.date || ''), close: Number(r.close) }))
        setCandles(rows)
      })
      .catch((e) => { if (!cancelled) setCandleError(e instanceof Error ? e.message : String(e)) })
    return () => { cancelled = true }
  }, [priceCode])

  const { avg, months: avgMonths, partial } = averageReceived(state.received, ym)
  const estimate = income?.distribution.monthlyNet ?? null
  const baseIncome = avg ?? estimate ?? 0
  const incomeSource = avg != null ? `완료된 ${avgMonths}개월 실제 입금 평균` : estimate != null ? '보유 종목 최근 12개월 분배율로 낸 추정(실제 기록 없음)' : '기록 없음'
  const monthlyFromIncome = Math.round(baseIncome * incomeAdj)
  const monthly = mode === 'income' ? monthlyFromIncome + toMonthly(num(extra), 'month') : toMonthly(num(amount), freq)
  const lump = num(lumpText) || state.lump

  const sim = useMemo(() => simulateDca({ monthly, years, annualDrag: drag, lump, prices: histPrices, months: histMonths }), [monthly, years, drag, lump, histPrices, histMonths])
  const simTr = useMemo(() => simulateDca({ monthly, years, annualDrag: 0, lump }), [monthly, years, lump])
  const simPlain = useMemo(() => simulateDca({ monthly, years, annualDrag: PLAIN_TAX_DRAG_ANNUAL, lump }), [monthly, years, lump])
  const summary = sim ? summarize(sim) : null
  const gain20 = useMemo(() => monthsToGain({ annualDrag: drag, prices: histPrices }), [drag, histPrices])
  const goalNeed = useMemo(() => requiredMonthly({ target: num(goalAmount), years, annualDrag: drag, lump, prices: histPrices }), [goalAmount, years, drag, lump, histPrices])
  const guide = useMemo(() => (candles ? situationGuide(candles) : null), [candles])
  const track = trackSummary(state)

  const candleAge = candidateDataAgeDays(new Date(), etfView.asOf)
  const incomeAssets = income?.total ?? 0

  const saveRecord = () => {
    const received = num(recReceived)
    const deposit = num(recDeposit)
    update({
      received: received ? upsertMonth(state.received, recMonth, received) : state.received,
      deposits: deposit ? upsertMonth(state.deposits, recMonth, deposit) : state.deposits,
    })
    setRecReceived('')
    setRecDeposit('')
  }

  return (
    <main className="acc">
      <header>
        <span className="acc-eyebrow">모아가기</span>
        <h1>꾸준히 모으면 어떻게 되나</h1>
        <p>증권사 앱의 모아가기로 직접 사는 지수 ETF를, 과거 실제 가격으로 시뮬레이션합니다. 주문은 내지 않습니다. 미래 예측이 아니라 "그때 시작했다면"의 분포입니다.</p>
      </header>

      <SavingProgressCard variant="full" />
      <div id="my-plan">
        <MyPlanCard goal={goalView ? { progressPct: goalView.target.progressPct, gapPct: goalView.plan.gapPct } : null} onPlanMonthly={onPlanMonthly} />
      </div>

      <section className="acc-card" aria-labelledby="acc-target">
        <h2 id="acc-target">1. 무엇으로 모을까</h2>
        <div className="acc-seg" role="radiogroup" aria-label="목적">
          {([['growth', '키우기 (분배금 없이 자동 재투자)'], ['income', '분배금 받기']] as const).map(([g, label]) => (
            <button key={g} type="button" role="radio" aria-checked={state.goal === g} className={state.goal === g ? 'is-active' : ''} onClick={() => update({ goal: g as Goal })}>{label}</button>
          ))}
        </div>
        {pick && (
          <div className="acc-pick">
            <div className="acc-pick-head"><span className="acc-badge">추천</span><strong>{pick.name}</strong><span className="acc-code">{pick.code}</span></div>
            <ul>{rec.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
            <p className="acc-note">같은 코스피200 지수를 따라가는 상품은 과거 수익률이 거의 같아서(연 0.1%p 안팎) 수익률 순위가 아니라 규모·거래대금·보수로 골랐습니다. {state.goal === 'growth' ? '일반형은 분배금에 세금(15.4%)이 붙어 연 약 0.3%p 불리합니다.' : '분배금이 필요한 목적이라 일반형을 추천합니다.'}</p>
          </div>
        )}
        {custom && (
          <div className="acc-pick">
            <div className="acc-pick-head"><span className="acc-badge acc-badge-user">직접 지정</span><strong>{custom.name}</strong><span className="acc-code">{custom.code}</span></div>
            {!isIndexTarget && !overseas && <p className="acc-warn">추천 기준 밖의 종목입니다. 아래 시뮬레이션은 이 종목의 이력이 아니라 코스피200 장기 이력으로 계산하므로 참고용입니다. 상황 안내는 이 종목의 시세로 합니다.</p>}
            {overseas && <OverseasLimits h={overseas} />}
            <button type="button" className="acc-secondary" onClick={() => update({ target: null })}>추천으로 되돌리기</button>
          </div>
        )}
        <label className="acc-field">
          <span>직접 지정하려면 종목 검색</span>
          <StockSearchInput value={targetText} onChange={setTargetText} onSelect={(s) => { update({ target: { code: s.code, name: s.name } }); setTargetText('') }} placeholder="ETF·종목 이름이나 코드" />
        </label>
        <details>
          <summary>이 기준을 통과한 후보 {rec.eligible.length}개 비교</summary>
          <table className="acc-table">
            <thead><tr><th>상품</th><th>보수</th><th>순자산</th><th>일 거래대금</th></tr></thead>
            <tbody>{rec.eligible.map((c) => <tr key={c.code}><td>{c.name}</td><td>{c.feePct}%</td><td>{(c.marketCapEok / 10_000).toFixed(1)}조</td><td>{Math.round(c.tradingValueMil / 100).toLocaleString('ko-KR')}억</td></tr>)}</tbody>
          </table>
        </details>
        <p className={`acc-note${candleAge > STALE_CANDIDATE_DAYS ? ' acc-warn' : ''}`}>
          보수·순자산 기준일 {etfView.asOf}{etfView.live ? ' · 일 거래대금은 최근 20거래일 평균' : ''}{candleAge > STALE_CANDIDATE_DAYS ? ` — ${candleAge}일이 지나 낡았을 수 있습니다. 증권사 앱에서 보수와 순자산을 확인하세요.` : ''}
        </p>
      </section>

      <section className="acc-card" aria-labelledby="acc-amount">
        <h2 id="acc-amount">2. 얼마를 모을까</h2>
        <p className="acc-note">
          아래 계산용 금액입니다. 여기서 바꿔도 위 '내 계획'은 바뀌지 않습니다.
          {mode === 'direct' && planMonthly > 0 && (num(amount) !== planMonthly || freq !== 'month') && (
            <> <button type="button" className="acc-link" onClick={resetToPlan}>내 계획({man(planMonthly)})으로 되돌리기</button></>
          )}
        </p>
        <div className="acc-seg" role="radiogroup" aria-label="금액 기준">
          {([['direct', '직접 입력'], ['income', '인컴 분배금을 성장으로']] as const).map(([m, label]) => (
            <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? 'is-active' : ''} onClick={() => setMode(m)}>{label}</button>
          ))}
        </div>
        {mode === 'direct' ? (
          <div className="acc-row">
            <label className="acc-field"><span>금액</span><input type="number" inputMode="numeric" min="0" value={amount} onChange={(e) => { amountTouched.current = true; setAmount(e.target.value) }} /><AmountHint value={amount} /></label>
            <label className="acc-field"><span>주기</span>
              <select value={freq} onChange={(e) => { amountTouched.current = true; setFreq(e.target.value as Freq) }}>
                <option value="day">매일</option><option value="week">매주</option><option value="month">매달</option>
              </select>
            </label>
          </div>
        ) : (
          <>
            <p className="acc-note">인컴은 지금 수준에서 더 늘리지 않고, 받는 분배금(세후)을 전부 성장 자산 매수에 쓰며 분배금은 비슷하게 유지된다고 가정합니다.</p>
            <dl className="acc-facts">
              <div><dt>월 분배금 기준</dt><dd>{baseIncome ? won(baseIncome) : '없음'}</dd></div>
              <div><dt>산출 방식</dt><dd>{incomeSource}</dd></div>
              {partial != null && <div><dt>이번 달 지금까지</dt><dd>{won(partial)} <small>(월초·중순·월말에 나눠 들어와 평균에서 뺐습니다)</small></dd></div>}
            </dl>
            {avg == null && <p className="acc-warn">아래 "내 기록"에 월별로 실제 입금액을 적으면 더 정확해집니다. 지금 값은 추정이라 실제와 다를 수 있습니다.</p>}
            <div className="acc-row">
              <label className="acc-field"><span>분배금 변동 가정</span>
                <select value={incomeAdj} onChange={(e) => setIncomeAdj(Number(e.target.value))}>
                  <option value={0.8}>20% 줄어듦</option><option value={1}>지금과 비슷</option><option value={1.2}>20% 늘어남</option>
                </select>
              </label>
              <label className="acc-field"><span>추가로 넣는 돈(월)</span><input type="number" inputMode="numeric" min="0" value={extra} onChange={(e) => setExtra(e.target.value)} /></label>
            </div>
          </>
        )}
        <div className="acc-row">
          <label className="acc-field"><span>기간: {years}년</span><input type="range" min="1" max="15" value={years} onChange={(e) => setYears(Number(e.target.value))} /></label>
          <label className="acc-field"><span>이미 가진 성장 자산(원)</span><input type="number" inputMode="numeric" min="0" placeholder="0" value={lumpText} onChange={(e) => setLumpText(e.target.value)} onBlur={() => update({ lump: num(lumpText) })} /><AmountHint value={lumpText} /></label>
        </div>
        <p className="acc-summary">매달 <strong>{won(monthly)}</strong> × {years}년 = 총 납입 <strong>{man(monthly * years * 12 + lump)}</strong></p>
      </section>

      <section className="acc-card" aria-labelledby="acc-result">
        <h2 id="acc-result">3. 과거에 이렇게 모았다면</h2>
        <div className="acc-seg acc-view-toggle" role="group" aria-label="보기 방식">
          <button type="button" className={pastView === 'all' ? 'is-active' : ''} aria-pressed={pastView === 'all'} onClick={() => setPastView('all')}>모든 시작 시점</button>
          <button type="button" className={pastView === 'period' ? 'is-active' : ''} aria-pressed={pastView === 'period'} onClick={() => setPastView('period')}>기간 골라 보기</button>
        </div>
        {pastView === 'period' ? (
          <PeriodSim monthly={monthly} lump={lump} drag={drag} years={years} series={history.monthly} />
        ) : !sim || !summary ? (
          <p className="acc-warn">{monthly <= 0 ? '금액을 입력하세요.' : '이 기간은 비교할 시작점이 너무 적어 계산하지 않습니다. 기간을 줄여 보세요.'}</p>
        ) : (
          <>
            <dl className="acc-tiles">
              <div><dt>총 납입</dt><dd>{man(summary.paid)}</dd></div>
              <div className="is-main"><dt>중앙값</dt><dd>{man(summary.median)}</dd><small>{((summary.median / summary.paid - 1) * 100).toFixed(0)}%</small></div>
              <div><dt>하위 10%</dt><dd>{man(summary.p10)}</dd></div>
              <div><dt>최악</dt><dd>{man(summary.worst)}</dd></div>
            </dl>
            <FanChart sim={sim} />
            <p className="acc-legend"><i className="acc-k-median" />중앙값 <i className="acc-k-p10" />하위10% <i className="acc-k-worst" />최악 <i className="acc-k-paid" />납입 · 음영은 하위10%~상위10%{sim.deepest && <> <i className="acc-k-real" />실제 한 사람({ymLabel(sim.deepest.start)} 시작)</>}</p>
            {sim.deepest && sim.deepest.troughPct < 0 && (
              <p className="acc-summary">
                색 선은 시점마다 {sim.starts}가지 결과의 순위값을 이은 것이라 실제보다 매끈합니다. 한 사람이 실제로 겪는 길은 점선처럼 출렁입니다 —{' '}
                {ymLabel(sim.deepest.start)}에 시작했다면 {sim.deepest.troughStep < 12 ? `${sim.deepest.troughStep}개월` : `${(sim.deepest.troughStep / 12).toFixed(1)}년`} 차에 넣은 돈 대비 <strong>{sim.deepest.troughPct.toFixed(0)}%</strong>까지 내려갔고,
                {' '}{years}년 끝에는 넣은 돈의 {(sim.deepest.finalRatio * 100).toFixed(0)}%였습니다. 이런 구간에서 멈추지 않는 것이 결과를 정합니다.
              </p>
            )}
            <p className="acc-note">시작 시점 {sim.starts}가지({history.monthly[0][0].slice(0, 4)}~, {history.name})를 모두 해 본 결과입니다. 원금보다 적었던 경우 {summary.lossPct.toFixed(0)}%, 원금의 +20% 이상이었던 경우 {summary.over20Pct.toFixed(0)}%. 시작점이 겹쳐 서로 독립적이지는 않고, 최근 큰 상승장이 포함되어 있습니다.</p>
            {gain20.median != null && (
              <More>
                <p className="acc-note"><strong>의미 있는 상승</strong>의 한 기준으로, 원금 대비 +20%에 처음 닿기까지 중앙값 <strong>{Math.round(gain20.median)}개월</strong>(빠른 25% {Math.round(gain20.p25 ?? 0)}개월, 느린 25% {Math.round(gain20.p75 ?? 0)}개월, 최대 {Math.round(gain20.max ?? 0)}개월)이 걸렸습니다.</p>
              </More>
            )}
            {mode === 'income' && incomeAssets > 0 && (
              <p className="acc-summary">인컴 자산 {man(incomeAssets)}(지금 수준 유지 가정) + 성장 자산 중앙값 {man(summary.median)} = <strong>{man(incomeAssets + summary.median)}</strong> <small>(하위 10%라면 {man(incomeAssets + summary.p10)})</small></p>
            )}
          </>
        )}
        {pastView === 'all' && !overseas && simTr && simPlain && (
          <div className="acc-compare">
            <h3>KODEX 200 vs KODEX 200TR</h3>
            <table className="acc-table">
              <thead><tr><th>상품</th><th>중앙값</th><th>하위 10%</th></tr></thead>
              <tbody>
                <tr><td>KODEX 200 (분배금 세후 재투자)</td><td>{man(summarize(simPlain).median)}</td><td>{man(summarize(simPlain).p10)}</td></tr>
                <tr><td>KODEX 200TR</td><td>{man(summarize(simTr).median)}</td><td>{man(summarize(simTr).p10)}</td></tr>
              </tbody>
            </table>
            <p className="acc-note">TR이 중앙값 기준 <strong>{man(summarize(simTr).median - summarize(simPlain).median)}</strong> 앞섭니다(연 약 0.3%p). 크지 않지만 세금으로 새는 몫이 꾸준히 복리로 굴러가는 구조 차이입니다. ISA·연금 계좌에서는 분배금 과세가 미뤄져 차이가 더 작습니다.</p>
          </div>
        )}
      </section>

      <section className="acc-card" aria-labelledby="acc-goal">
        <h2 id="acc-goal">4. 목표 금액에서 거꾸로</h2>
        <label className="acc-field"><span>{years}년 뒤 갖고 싶은 성장 자산(원)</span><input type="number" inputMode="numeric" min="0" value={goalAmount} onChange={(e) => setGoalAmount(e.target.value)} /><AmountHint value={goalAmount} /></label>
        {goalNeed ? (
          <dl className="acc-facts">
            <div><dt>보통의 경우(중앙값)</dt><dd>매달 {won(goalNeed.typical)}</dd></div>
            <div><dt>보수적으로(하위 10%)</dt><dd>매달 {won(goalNeed.conservative)}</dd></div>
            {monthly > 0 && <div><dt>지금 계획({won(monthly)})</dt><dd>{monthly >= goalNeed.conservative ? '보수적으로 봐도 닿는 수준' : monthly >= goalNeed.typical ? '보통은 닿지만 부진하면 모자람' : '보통의 경우에도 모자람'}</dd></div>}
          </dl>
        ) : <p className="acc-warn">이 기간은 계산할 수 없습니다.</p>}
      </section>

      <section className="acc-card" aria-labelledby="acc-guide">
        <h2 id="acc-guide">5. 지금 상황</h2>
        {candleError ? <p className="acc-warn">시세를 불러오지 못해 안내를 보류합니다. ({candleError})</p>
          : !guide ? <p className="acc-note">시세를 확인하는 중…</p>
          : (
            <div className={`acc-guide is-${guide.state}`}>
              <strong>{guide.title}</strong>
              <p>{guide.text}</p>
              {guide.note && <p className="acc-note">{guide.note}</p>}
              {guide.state === 'drop' && dropPlan && (
                <div className="acc-pick">
                  <strong>하락 전에 내가 정해 둔 계획 ({dropPlan.savedAt})</strong>
                  <ul>{dropPlanLines(dropPlan).map((l) => <li key={l}>{l}</li>)}</ul>
                </div>
              )}
              <More>
                <p className="acc-note">기준: {isIndexTarget ? 'KODEX 200(같은 지수)' : targetName} 시세 {guide.lastDate ?? '없음'}{guide.drawdownPct != null ? ` · 1년 고점 대비 ${guide.drawdownPct.toFixed(1)}%` : ''}{guide.gain12mPct != null ? ` · 1년 수익 ${guide.gain12mPct.toFixed(0)}%` : ''}</p>
              </More>
            </div>
          )}
        <p className="acc-note">이 안내는 수익을 올리는 규칙이 아닙니다. 과거 검증에서 "내리면 더 넣고 오르면 줄이기"가 꾸준히 넣는 것보다 나았다는 근거는 없었습니다. 흔들려서 멈추거나 몰아 넣는 실수를 막는 용도입니다.</p>
      </section>

      <SplitPlanCard />

      <section className="acc-card" aria-labelledby="acc-rec">
        <h2 id="acc-rec">내 기록</h2>
        <p className="acc-note">입금액은 증권사 앱에 보이는 세후 금액 그대로 적습니다. 분배금은 월초·중순·월말에 나눠 들어오니 그달 합계를 적고, 진행 중인 달은 평균에서 제외됩니다.</p>
        <div className="acc-row">
          <label className="acc-field"><span>월</span><input type="month" value={recMonth} onChange={(e) => setRecMonth(e.target.value)} /></label>
          <label className="acc-field"><span>받은 분배금(세후)</span><input type="number" inputMode="numeric" min="0" value={recReceived} onChange={(e) => setRecReceived(e.target.value)} placeholder={state.received.find(([m]) => m === recMonth)?.[1]?.toString() ?? ''} /><AmountHint value={recReceived} /></label>
          <label className="acc-field"><span>적립한 금액</span><input type="number" inputMode="numeric" min="0" value={recDeposit} onChange={(e) => setRecDeposit(e.target.value)} placeholder={state.deposits.find(([m]) => m === recMonth)?.[1]?.toString() ?? ''} /><AmountHint value={recDeposit} /></label>
        </div>
        <button type="button" className="acc-primary" disabled={!recMonth || (!num(recReceived) && !num(recDeposit))} onClick={saveRecord}>이 달 기록 저장</button>
        {(state.received.length > 0 || state.deposits.length > 0) && (
          <table className="acc-table">
            <thead><tr><th>월</th><th>받은 분배금</th><th>적립</th><th /></tr></thead>
            <tbody>
              {Array.from(new Set([...state.received.map(([m]) => m), ...state.deposits.map(([m]) => m)])).sort().reverse().map((m) => (
                <tr key={m}>
                  <td>{m}{m === ym ? ' (진행 중)' : ''}</td>
                  <td>{state.received.find(([x]) => x === m)?.[1]?.toLocaleString('ko-KR') ?? '-'}</td>
                  <td>{state.deposits.find(([x]) => x === m)?.[1]?.toLocaleString('ko-KR') ?? '-'}</td>
                  <td><button type="button" className="acc-remove" onClick={() => update({ received: upsertMonth(state.received, m, 0), deposits: upsertMonth(state.deposits, m, 0) })}>삭제</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {/* 위 '이 달 기록 저장'과 같은 규칙: 입력칸 줄 아래에 버튼 (같은 줄 grid에 넣으면 버튼이 라벨 높이만큼 어긋났다) */}
        <div className="acc-row acc-row--single">
          <label className="acc-field"><span>증권사 앱의 현재 평가금</span><input type="number" inputMode="numeric" min="0" value={valueText} onChange={(e) => setValueText(e.target.value)} placeholder={state.valuation ? String(state.valuation.value) : ''} /><AmountHint value={valueText} /></label>
        </div>
        <button type="button" className="acc-primary" disabled={!num(valueText)} onClick={() => { update({ valuation: { ym, value: num(valueText) } }); setValueText('') }}>평가금 저장</button>
        {track.value != null && (
          <p className="acc-summary">누적 납입 {man(track.paid)} → 평가금 {man(track.value)} ({state.valuation?.ym} 확인) · <strong>{track.gainPct != null ? `${track.gainPct >= 0 ? '+' : ''}${track.gainPct.toFixed(1)}%` : '-'}</strong></p>
        )}
      </section>
    </main>
  )
}
