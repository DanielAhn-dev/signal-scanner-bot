import { useMemo, useState, type ReactNode } from 'react'
import More from '../../components/ui/More'
import { GLIDE_PROFILES, MAX_GOALS, glidePlan, sanitizeGoalState, type AccountGoal, type GlideProfile } from '../../lib/accountGoals'
import { todayKst } from '../../lib/dropPlan'
import { formatKrwMan } from '../../lib/format'
import { GLIDE_FACTS } from '../../data/researchFacts'
import { useUserState } from '../../lib/userState'

const man = formatKrwMan
const toWon = (manText: string) => { const n = Number(manText.replace(/,/g, '').trim()); return Number.isFinite(n) && n > 0 ? Math.round(n * 10_000) : 0 }
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
const yearsLabel = (y: number) => (y >= 1 ? `${y.toFixed(1)}년` : `${Math.max(0, Math.round(y * 12))}개월`)

/** 계좌별 사용 시점 — 정하지 않으면 지수 100% 그대로, 정하면 남은 기간에 맞춰 비중 안내(주문 없음) */
export default function GoalCard({ basis }: { basis: ReactNode }) {
  const { value, set } = useUserState<{ goals: AccountGoal[] }>('accountGoals')
  const state = useMemo(() => sanitizeGoalState(value), [value])
  const today = todayKst()
  const save = (goals: AccountGoal[]) => set({ goals })
  return (
    <>
      <section className="acc-card">
        <h2>이 계좌는 언제 쓸 돈인가요</h2>
        <p className="acc-note">정하지 않은 계좌는 지금처럼 지수만 꾸준히 사면 됩니다. 쓸 날을 정하면 <strong>날짜가 다가오는 만큼</strong> 주식 비중을 미리 정한 표대로 내리도록 안내합니다. 시장을 예측해서 내리는 것이 아니고, 이 화면은 주문을 내지 않습니다.</p>
      </section>
      {state.goals.map((g) => <GoalItem key={g.id} goal={g} today={today} onChange={(n) => save(state.goals.map((x) => (x.id === g.id ? n : x)))} onRemove={() => save(state.goals.filter((x) => x.id !== g.id))} />)}
      {state.goals.length < MAX_GOALS && <AddGoal today={today} onAdd={(g) => save([...state.goals, g])} />}
      <ResultCard basis={basis} />
    </>
  )
}

function GoalItem({ goal, today, onChange, onRemove }: { goal: AccountGoal; today: string; onChange: (g: AccountGoal) => void; onRemove: () => void }) {
  const p = glidePlan(goal, today)
  const move = Math.abs(p.reduceWon)
  return (
    <section className="acc-card">
      <h2>{goal.label} <small>{goal.targetDate} 사용</small></h2>
      <dl className="acc-tiles">
        <div><dt>남은 기간</dt><dd>{p.due ? '사용 시점 도래' : yearsLabel(p.remainingYears)}</dd></div>
        <div className="is-main"><dt>지금 권장 주식 비중</dt><dd>{p.recommendedPct}%</dd></div>
        <div><dt>지금 내 주식 비중</dt><dd>{p.currentPct}%</dd></div>
      </dl>
      {p.due
        ? <p className="acc-warn">사용 시점이 되었습니다. 쓸 금액만큼은 이미 안전자산(현금성·단기채)에 있어야 합니다.</p>
        : p.reduceWon > 0
          ? <p className="acc-warn">권장 비중까지 맞추려면 주식 약 {man(move)}을 안전자산(현금성·단기채)으로 옮기는 것이 안내값입니다. 한꺼번에 팔 필요는 없고 몇 번에 나눠도 됩니다.</p>
          : <p className="acc-note">{p.reduceWon < 0 ? `이미 권장보다 안전하게 들고 있습니다(주식 ${man(move)}만큼 여유).` : '권장 비중과 같습니다.'}</p>}
      {p.next && <p className="acc-note">다음 전환: <strong>{p.next.date}</strong>에 주식 {p.next.pct}%로.</p>}
      {!p.gliding && !p.due && <p className="acc-note">아직 10년 넘게 남아 표의 첫 구간입니다. 기본 방식(지수 꾸준히)을 그대로 유지하면 됩니다.</p>}
      <div className="acc-row">
        <label className="acc-field"><span>평가액 (만원)</span><input type="number" inputMode="numeric" min="0" value={Math.round(goal.valueWon / 10_000)} onChange={(e) => onChange({ ...goal, valueWon: toWon(e.target.value) })} /></label>
        <label className="acc-field"><span>주식(지수) 비중 %</span><input type="number" inputMode="numeric" min="0" max="100" value={goal.stockPct} onChange={(e) => onChange({ ...goal, stockPct: Math.min(100, Math.max(0, Math.round(Number(e.target.value) || 0))) })} /></label>
        <label className="acc-field"><span>전환 방식</span>
          <select value={goal.profile} onChange={(e) => onChange({ ...goal, profile: e.target.value as GlideProfile })}>
            {GLIDE_PROFILES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
        </label>
      </div>
      <More>
        <p className="acc-note">폭락한 직후에 기계적으로 내리지 마세요. 연구에서 대공황 직전에 시작한 계좌는 폭락 뒤 비중을 내리는 바람에 끝까지 들고 있던 경우보다 결과가 나빴습니다(최악 0.78 대 0.95). 큰 하락 중이라면 전환 시점을 몇 달 늦추는 것을 고려하고, 사용 시점이 가까운 돈은 처음부터 낮은 비중이 맞습니다.</p>
      </More>
      <button type="button" className="acc-link" onClick={() => { if (window.confirm(`${goal.label} 설정을 지울까요?`)) onRemove() }}>이 설정 지우기</button>
    </section>
  )
}

function AddGoal({ today, onAdd }: { today: string; onAdd: (g: AccountGoal) => void }) {
  const [label, setLabel] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [valueMan, setValueMan] = useState('')
  const [stockPct, setStockPct] = useState('100')
  const [profile, setProfile] = useState<GlideProfile>('gentle')
  const ok = targetDate > today && toWon(valueMan) > 0
  return (
    <section className="acc-card">
      <h2>계좌 추가</h2>
      <div className="acc-row">
        <label className="acc-field"><span>이름</span><input type="text" maxLength={20} value={label} placeholder="예: 전세 자금" onChange={(e) => setLabel(e.target.value)} /></label>
        <label className="acc-field"><span>쓸 날짜</span><input type="date" value={targetDate} min={today} onChange={(e) => setTargetDate(e.target.value)} /></label>
      </div>
      <div className="acc-row">
        <label className="acc-field"><span>지금 평가액 (만원)</span><input type="number" inputMode="numeric" min="0" value={valueMan} onChange={(e) => setValueMan(e.target.value)} /></label>
        <label className="acc-field"><span>주식(지수) 비중 %</span><input type="number" inputMode="numeric" min="0" max="100" value={stockPct} onChange={(e) => setStockPct(e.target.value)} /></label>
      </div>
      <div className="acc-seg" role="radiogroup" aria-label="전환 방식">
        {GLIDE_PROFILES.map((x) => <button key={x.key} type="button" role="radio" aria-checked={profile === x.key} className={profile === x.key ? 'is-active' : ''} onClick={() => setProfile(x.key)}>{x.label}</button>)}
      </div>
      <p className="acc-note">{GLIDE_PROFILES.find((x) => x.key === profile)?.note}</p>
      <button type="button" className="acc-primary" disabled={!ok} onClick={() => { onAdd({ id: newId(), label: label.trim() || '계좌', targetDate, valueWon: toWon(valueMan), stockPct: Math.min(100, Math.max(0, Math.round(Number(stockPct) || 0))), profile }); setLabel(''); setTargetDate(''); setValueMan(''); setStockPct('100') }}>추가</button>
    </section>
  )
}

function ResultCard({ basis }: { basis: ReactNode }) {
  const [market, setMarket] = useState<'us' | 'kr'>('us')
  const m = GLIDE_FACTS.markets[market]
  return (
    <section className="acc-card">
      <h2>과거에는 이렇게 달랐습니다</h2>
      <p className="acc-note">쓸 날 N년 전에 일시금을 넣고 날짜만 보고 비중을 내렸을 때와 끝까지 100% 보유했을 때를 모든 시작월로 비교했습니다. 쓸 날 직전 3년의 최대 하락이 크게 줄고, 대신 중앙값 수익을 그만큼 포기합니다.</p>
      <div className="acc-seg" role="tablist">
        <button type="button" role="tab" aria-selected={market === 'us'} className={market === 'us' ? 'is-active' : ''} onClick={() => setMarket('us')}>미국 S&amp;P500</button>
        <button type="button" role="tab" aria-selected={market === 'kr'} className={market === 'kr' ? 'is-active' : ''} onClick={() => setMarket('kr')}>코스피</button>
      </div>
      <table className="acc-table plan-table">
        <thead><tr><th>쓸 날까지</th><th>방식</th><th>끝 배율(중앙값)</th><th>원금 미만 확률</th><th>마지막 3년 최대 하락(나쁜 10%)</th></tr></thead>
        <tbody>
          {m.rows.flatMap((r) => ([['hold', '끝까지 100%'], ['gentle', '완만'], ['safe', '보수']] as const).map(([k, name]) => (
            <tr key={`${r.years}-${k}`}>
              <td>{k === 'hold' ? `${r.years}년` : ''}</td><td>{name}</td><td>{r[k].median.toFixed(2)}</td><td>{r[k].lossPct.toFixed(1)}%</td><td>{r[k].ddBad10.toFixed(1)}%</td>
            </tr>
          )))}
        </tbody>
      </table>
      <p className="acc-note">표본 {m.rows[0].starts}~{m.rows[2].starts}개 시작 시점(겹치는 창). 안전자산은 연 3% 현금으로 가정했습니다.</p>
      {basis}
    </section>
  )
}
