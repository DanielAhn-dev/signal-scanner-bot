import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import More from '../../components/ui/More'
import { SIM_ASOF, SIM_ASSETS, SIM_BUILT } from '../../data/simData'
import { apiFetch } from '../../lib/api'
import { STRESS_PRESETS, normalize, type Shocks } from '../../lib/mix'
import { commonMonths, rollingStarts, simulatePlan, type SimRebalance } from '../../lib/sim/engine'
import { PERIOD_PRESETS, resolveCustom, resolvePreset, sharedMonths, spanText, ymText } from '../../lib/sim/period'
import type { MixEntry } from '../../lib/planMix'
import { useCurrentChatId } from '../../stores/profileStore'
import AmountChart, { type ChartMode } from './AmountChart'
import BehaviorGap from './BehaviorGap'
import DropPlanCard from './DropPlanCard'
import MixEditor, { type Slot } from './MixEditor'
import { MAX_SLOTS, SIM_MIX_PRESETS, SLOT_NAMES, presetKeyOf } from './presets'
import { ResultTable, RollingList, type SlotResult } from './Results'
import SetPlanMix from './SetPlanMix'
import StressSection from './StressSection'
import '../accumulate/accumulate.css'
import './mix.css'
import './plan-sim.css'

const STALE_DAYS = 180
const preset = (key: string) => SIM_MIX_PRESETS.find((p) => p.key === key)!
const toWon = (man: string) => {
  const v = Number(man.replace(/,/g, ''))
  return Number.isFinite(v) && v > 0 ? v * 10_000 : 0
}
const monthInput = (ym: string) => `${ym.slice(0, 4)}-${ym.slice(4)}`
const fromMonthInput = (v: string) => v.replace('-', '')

let nextUid = 1
const newSlot = (key: string): Slot => ({ uid: nextUid++, label: preset(key).label, weights: { ...preset(key).weights } })

/**
 * 시뮬레이터 — 과거 실제 가격으로 "이 구성에 이렇게 넣었다면" (docs/plan-simulator-redesign-2026-10-22.md 3절 스케치).
 * 순위·최적 조합을 보여 주지 않는다. 주문은 내지 않는다. 섞어보기(하락 가정·내 계획으로 정하기·하락 중에 팔았다면)를 합쳤다.
 * 시드 만들기에서 오면 확인한 가용 현금(state.seedBuilderCapital)을 '처음에 한 번에'로 채운다(이번 이동에만, 저장하지 않음).
 */
export default function PlanSimPage() {
  const chatId = useCurrentChatId()
  const location = useLocation()
  const seedCapital = Number((location.state as { seedBuilderCapital?: number } | null)?.seedBuilderCapital)
  const fromSeed = Number.isSafeInteger(seedCapital) && seedCapital > 0
  const [slots, setSlots] = useState<Slot[]>(() => [newSlot('half'), newSlot('kospi')])
  const [periodKey, setPeriodKey] = useState('r10')
  const [custom, setCustom] = useState<{ start: string; end: string } | null>(null)
  const [lumpMan, setLumpMan] = useState(() => (fromSeed ? String(Math.round(seedCapital / 10_000)) : '0'))
  const [monthlyMan, setMonthlyMan] = useState('50')
  const [raisePct, setRaisePct] = useState('0')
  const [rebalance, setRebalance] = useState<SimRebalance>('year')
  const [mode, setMode] = useState<ChartMode>('amount')
  // 아래 '이 구성 자세히'(하락 가정·내 계획으로 정하기)가 보는 구성
  const [focus, setFocus] = useState(0)
  const [shocks, setShocks] = useState<Shocks>(STRESS_PRESETS[0].shocks)
  const [tolerance, setTolerance] = useState(20)
  // 사용자가 먼저 바꿨으면 늦게 온 내 계획 값으로 덮어쓰지 않는다
  const touched = useRef({ a: false, monthly: false })

  useEffect(() => {
    if (!chatId) return
    let alive = true
    apiFetch('/api/ui/investment-prefs', { cacheMs: 30_000, timeoutMs: 10_000, retries: 0 })
      .then((res) => {
        if (!alive) return
        const plan = res?.data?.plan
        const mix = Array.isArray(plan?.mix) ? (plan.mix as MixEntry[]) : null
        if (mix?.length && !touched.current.a) {
          const weights = Object.fromEntries(mix.map((e) => [e.index, Math.round(e.weight * 1000) / 10]))
          setSlots((prev) => [{ uid: prev[0].uid, label: '내 계획 구성', weights }, ...prev.slice(1)])
        }
        const m = Number(plan?.monthly)
        if (m > 0 && !touched.current.monthly) setMonthlyMan(String(Math.round(m / 10_000)))
      })
      .catch(() => { /* 내 계획이 없거나 못 불러오면 예시 구성으로 계속 */ })
    return () => { alive = false }
  }, [chatId])

  const slotMonths = useMemo(() => slots.map((s) => commonMonths(s.weights, SIM_ASSETS)), [slots])
  const months = useMemo(() => sharedMonths(slotMonths.filter((m) => m.length)), [slotMonths])
  const period = useMemo(() => {
    if (periodKey === 'custom' && custom) return resolveCustom(custom.start, custom.end, months)
    const p = PERIOD_PRESETS.find((x) => x.key === periodKey) ?? PERIOD_PRESETS[1]
    return resolvePreset(p, months)
  }, [periodKey, custom, months])

  const lump = toWon(lumpMan)
  const monthly = toWon(monthlyMan)
  const raise = Math.max(0, Number(raisePct) || 0) / 100
  // 슬라이더를 끄는 동안 입력이 먼저 반응하도록 계산은 한 박자 늦게 따라간다
  const calc = useDeferredValue({ slots, period, lump, monthly, raise, rebalance })
  const results = useMemo<SlotResult[]>(() => {
    const { slots: ss, period: pr } = calc
    if (!pr) return []
    const out: SlotResult[] = []
    ss.forEach((s, k) => {
      if (!Object.keys(normalize(s.weights)).length) return
      const input = { weights: s.weights, startYm: pr.start, endYm: pr.end, lump: calc.lump, monthly: calc.monthly, monthlyRaisePct: calc.raise, rebalance: calc.rebalance, assets: SIM_ASSETS }
      const plan = simulatePlan(input)
      if (plan) out.push({ name: SLOT_NAMES[k], label: s.label, plan, rolling: rollingStarts(input) })
    })
    return out
  }, [calc])

  const updateSlot = (k: number, s: Slot) => {
    if (k === 0) touched.current.a = true
    setSlots(slots.map((x, i) => (i === k ? s : x)))
  }
  const addSlot = () => {
    const used = new Set(slots.map((s) => presetKeyOf(s.weights)))
    const key = SIM_MIX_PRESETS.find((p) => !used.has(p.key))?.key ?? 'kospi'
    setSlots([...slots, newSlot(key)])
  }
  const pickPeriod = (key: string) => {
    if (key === 'custom' && period) setCustom({ start: period.start, end: period.end })
    setPeriodKey(key)
  }

  const focusIdx = Math.min(focus, slots.length - 1)
  const focusSlot = slots[focusIdx]
  const presetNote = PERIOD_PRESETS.find((p) => p.key === periodKey)
  const picked = [...new Set(slots.flatMap((s) => Object.keys(normalize(s.weights))))]
  const pickedAssets = SIM_ASSETS.filter((a) => picked.includes(a.id))
  const latestStart = pickedAssets.length ? pickedAssets.reduce((a, b) => (b.first > a.first ? b : a)) : null
  const builtDays = Math.floor((Date.now() - new Date(`${SIM_BUILT}T00:00:00+09:00`).getTime()) / 86_400_000)
  const head = results[0]?.plan

  return (
    <div className="acc mix ps">
      <header>
        <p className="acc-eyebrow">시뮬레이터</p>
        <h1>과거 실제 가격으로 내 돈 넣어 보기</h1>
        <p>기간·구성·넣는 방식을 직접 골라, 그렇게 넣었다면 지금 얼마였을지 봅니다. <strong>과거 숫자일 뿐 미래를 약속하지 않습니다.</strong> 주문은 나가지 않습니다.</p>
      </header>

      <section className="acc-card" aria-labelledby="ps-when">
        <h2 id="ps-when">① 언제</h2>
        <div className="ps-chips" role="group" aria-label="기간 빠른 선택">
          {PERIOD_PRESETS.map((p) => (
            <button key={p.key} type="button" className={periodKey === p.key ? 'is-active' : ''} aria-pressed={periodKey === p.key} onClick={() => pickPeriod(p.key)}>{p.label}</button>
          ))}
          <button type="button" className={periodKey === 'custom' ? 'is-active' : ''} aria-pressed={periodKey === 'custom'} onClick={() => pickPeriod('custom')}>직접 고르기</button>
        </div>
        {periodKey === 'custom' && custom && months.length > 1 && (
          <div className="acc-row">
            <label className="acc-field"><span>시작</span>
              <input type="month" value={monthInput(period?.start ?? custom.start)} min={monthInput(months[0])} max={monthInput(months[months.length - 2])}
                onChange={(e) => e.target.value && setCustom({ ...custom, start: fromMonthInput(e.target.value) })} />
            </label>
            <label className="acc-field"><span>끝</span>
              <input type="month" value={monthInput(period?.end ?? custom.end)} min={monthInput(months[1])} max={monthInput(months[months.length - 1])}
                onChange={(e) => e.target.value && setCustom({ ...custom, end: fromMonthInput(e.target.value) })} />
            </label>
          </div>
        )}
        {period ? (
          <p className="acc-note">
            <strong>{ymText(period.start)} ~ {ymText(period.end)}</strong> · {spanText(results[0]?.plan.months ?? 0)}
            {presetNote?.kind === 'from' && ` · ${presetNote.note}`}
            <br /><small className="acc-code">고른 구성으로 계산할 수 있는 기간 {ymText(months[0])} ~ {ymText(months[months.length - 1])}</small>
          </p>
        ) : (
          <p className="acc-warn">고른 구성들이 함께 쓸 수 있는 기간이 없습니다. 구성을 바꿔 주세요.</p>
        )}
        {period?.clamped && latestStart && (
          <p className="acc-warn">고른 시작보다 이력이 짧아 {ymText(period.start)}부터 계산합니다. {latestStart.name} 이력이 {ymText(latestStart.first)}부터라 기간을 정합니다.</p>
        )}
      </section>

      <section className="acc-card" aria-labelledby="ps-money">
        <h2 id="ps-money">② 얼마나</h2>
        <div className="acc-row">
          <label className="acc-field"><span>처음에 한 번에 (만원)</span>
            <input inputMode="numeric" value={lumpMan} onChange={(e) => setLumpMan(e.target.value.replace(/[^\d]/g, ''))} />
          </label>
          <label className="acc-field"><span>매달 (만원)</span>
            <input inputMode="numeric" value={monthlyMan} onChange={(e) => { touched.current.monthly = true; setMonthlyMan(e.target.value.replace(/[^\d]/g, '')) }} />
          </label>
          <label className="acc-field"><span>해마다 매달 넣는 돈 늘리기 (%)</span>
            <input inputMode="numeric" value={raisePct} onChange={(e) => setRaisePct(e.target.value.replace(/[^\d]/g, '').slice(0, 2))} />
          </label>
        </div>
        {!lump && !monthly && <p className="acc-warn">처음 넣는 돈이나 매달 넣는 돈 중 하나는 정해 주세요.</p>}
      </section>

      <section className="acc-card" aria-labelledby="ps-what">
        <h2 id="ps-what">③ 무엇에 <small className="acc-code">최대 {MAX_SLOTS}개 비교</small></h2>
        {slots.map((s, k) => (
          <MixEditor key={s.uid} name={SLOT_NAMES[k]} slot={s} firstYm={slotMonths[k][0] ?? null}
            onChange={(next) => updateSlot(k, next)}
            onRemove={k > 0 ? () => setSlots(slots.filter((_, i) => i !== k)) : undefined} />
        ))}
        <div className="acc-row">
          {slots.length < MAX_SLOTS && <button type="button" className="ps-btn ps-btn--add" onClick={addSlot}>+ 비교 추가</button>}
          <label className="acc-field"><span>리밸런싱(비중 되돌리기)</span>
            <select value={rebalance} onChange={(e) => setRebalance(e.target.value as SimRebalance)}>
              <option value="year">1년에 한 번</option>
              <option value="month">매월</option>
              <option value="none">하지 않음</option>
              <option value="cashflow">새 돈으로만 맞추기</option>
            </select>
          </label>
        </div>
      </section>

      {period && head && results.length > 0 && (
        <>
          <section className="acc-card" aria-labelledby="ps-result">
            <h2 id="ps-result">결과 <small className="acc-code">{ymText(period.start)} ~ {ymText(period.end)} · {spanText(head.months)}</small></h2>
            <p className="acc-note">과거 실제 가격으로 따라간 값입니다. 세금은 빼지 않았습니다.</p>
            <ResultTable rows={results} />
            <div className="ps-chips" role="group" aria-label="그래프 세로축">
              <button type="button" className={mode === 'amount' ? 'is-active' : ''} aria-pressed={mode === 'amount'} onClick={() => setMode('amount')}>금액</button>
              <button type="button" className={mode === 'pct' ? 'is-active' : ''} aria-pressed={mode === 'pct'} onClick={() => setMode('pct')}>넣은 돈 대비 %</button>
            </div>
            <AmountChart labels={head.labels} paid={head.paid} mode={mode} series={results.map((r) => ({ name: r.name, label: r.label, value: r.plan.value }))} />
            <p className="acc-legend">
              {mode === 'amount' && <span><i className="acc-k-paid" />넣은 돈</span>}
              {results.map((r) => <span key={r.name}><i className={`ps-key ps-key--${r.name}`} />{r.name} {r.label}</span>)}
            </p>
          </section>

          <section className="acc-card" aria-labelledby="ps-roll">
            <h2 id="ps-roll">같은 {spanText(head.months)}을 다른 달에 시작했다면</h2>
            <p className="acc-note">고른 기간 하나만 보면 운이 좋았던 구간을 고르기 쉽습니다. 같은 길이·같은 금액을 데이터 안의 모든 시작 달로 돌린 끝 평가금 범위입니다.</p>
            <RollingList rows={results} months={head.months} />
            <p className="acc-legend"><span><i className="ps-k-range" />하위 10%~최고</span><span><i className="ps-k-mid" />중앙</span><span><i className="ps-k-me" />고른 기간</span></p>
          </section>
        </>
      )}

      <section className="acc-card" aria-labelledby="ps-stress">
        <h2 id="ps-stress">하락이 왔다고 가정하면</h2>
        {slots.length > 1 && (
          <div className="ps-chips" role="group" aria-label="살펴볼 구성">
            {slots.map((s, k) => (
              <button key={s.uid} type="button" className={k === focusIdx ? 'is-active' : ''} aria-pressed={k === focusIdx} onClick={() => setFocus(k)}>
                <i className={`ps-key ps-key--${SLOT_NAMES[k]}`} />{SLOT_NAMES[k]} {s.label}
              </button>
            ))}
          </div>
        )}
        <StressSection weights={focusSlot.weights} shocks={shocks} onShocks={setShocks} tolerance={tolerance} onTolerance={setTolerance} />
        <SetPlanMix weights={focusSlot.weights} />
      </section>

      <DropPlanCard tolerance={tolerance} />

      <BehaviorGap />

      <section className="acc-card" aria-labelledby="ps-notes">
        <h2 id="ps-notes">읽을 때 주의</h2>
        <ul className="acc-note">
          <li><strong>기간은 이력이 가장 짧은 자산이 정합니다.</strong>{latestStart ? ` 지금은 ${latestStart.name}(${ymText(latestStart.first)}~)입니다.` : ''} 비교하는 구성은 모두 같은 기간으로 맞춥니다.</li>
          <li>과거에 좋았던 구성이 앞으로도 좋다는 근거는 없습니다. 특히 지난 15년은 미국 주식이 유독 강했던 구간입니다.</li>
          <li>세금·환전 비용·호가 차이는 넣지 않았습니다. 리밸런싱은 바꾼 비중의 0.1%를 비용으로 뺐습니다.</li>
        </ul>
        <More label="자산별 자료와 한계">
          <ul className="acc-note">
            {(pickedAssets.length ? pickedAssets : SIM_ASSETS).map((a) => (
              <li key={a.id}><strong>{a.name}</strong> — {a.source}, {ymText(a.first)}~{ymText(a.last)}. {a.note}</li>
            ))}
          </ul>
        </More>
        <p className="acc-code">자료: {SIM_ASOF}까지 월말 가격(분배금 반영 수정주가, 원화) · 생성 {SIM_BUILT} · scripts/research/build_sim_data.py</p>
        {builtDays > STALE_DAYS && <p className="acc-warn">자료를 만든 지 {builtDays}일이 지났습니다. 최근 달이 빠져 있을 수 있습니다.</p>}
      </section>
    </div>
  )
}
