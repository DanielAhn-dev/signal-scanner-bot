import { useMemo, useState } from 'react'
import More from '../../components/ui/More'
import { CHILD_ETF_DEFAULTS, childEtfCheck } from '../../lib/childEtf'
import {
  MAX_CHILDREN, MAX_GIFTS_TOTAL, allowance, adultOn, approxAge, daysBetween, filingDeadline, pendingFilings, planGift, reliefDates, sanitizeChildState,
  type Child, type ChildGiftState, type Gift,
} from '../../lib/childGift'
import { MAX_YEARS, MIN_YEARS, project } from '../../lib/childProjection'
import { todayKst } from '../../lib/dropPlan'
import { formatKrwMan } from '../../lib/format'
import { useUserState } from '../../lib/userState'
import '../accumulate/accumulate.css'
import './child-gift.css'

const man = formatKrwMan
const toWon = (manText: string) => { const n = Number(manText.replace(/,/g, '').trim()); return Number.isFinite(n) && n > 0 ? Math.round(n * 10_000) : 0 }
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

export default function ChildGiftPage() {
  const { value, set } = useUserState<ChildGiftState>('childGifts')
  const state = useMemo(() => sanitizeChildState(value), [value])
  const [selected, setSelected] = useState('')
  const today = todayKst()
  const child = state.children.find((c) => c.id === selected) ?? state.children[0] ?? null
  const save = (next: ChildGiftState) => set(next)
  const update = (id: string, fn: (c: Child) => Child) => save({ children: state.children.map((c) => (c.id === id ? fn(c) : c)) })
  const totalGifts = state.children.reduce((s, c) => s + c.gifts.length, 0)

  return (
    <div className="acc child">
      <header>
        <p className="acc-eyebrow">자녀 계좌</p>
        <h1>자녀에게 준 돈, 한도와 신고를 기록으로 챙기기</h1>
        <p>증여한 날짜와 금액을 적어 두면 10년 공제 한도가 얼마 남았는지, 신고 마감이 언제인지 알려드립니다. 세무 판단은 하지 않고 주문도 내지 않습니다. 기록은 이 서비스에만 저장되며 이름 대신 별칭과 출생 연월만 받습니다.</p>
      </header>

      {state.children.length > 0 && (
        <section className="acc-card">
          <div className="acc-seg">
            {state.children.map((c) => (
              <button key={c.id} type="button" className={c.id === child?.id ? 'is-active' : ''} onClick={() => setSelected(c.id)}>
                {c.alias} <small>{approxAge(c.birth, today)}세</small>
              </button>
            ))}
          </div>
        </section>
      )}

      {(!child || state.children.length < MAX_CHILDREN) && <AddChild first={!child} onAdd={(c) => { save({ children: [...state.children, c] }); setSelected(c.id) }} />}

      {child && (
        <>
          <LimitCard child={child} today={today} />
          <GiftsCard
            child={child}
            today={today}
            full={totalGifts >= MAX_GIFTS_TOTAL}
            onAdd={(g) => update(child.id, (c) => ({ ...c, gifts: [...c.gifts, g].sort((a, b) => a.date.localeCompare(b.date)) }))}
            onToggle={(id) => update(child.id, (c) => ({ ...c, gifts: c.gifts.map((g) => (g.id === id ? { ...g, reported: !g.reported } : g)) }))}
            onRemove={(id) => update(child.id, (c) => ({ ...c, gifts: c.gifts.filter((g) => g.id !== id) }))}
          />
          <ProjectionCard child={child} today={today} />
          <SimpleWayCard />
          <section className="acc-card">
            <button type="button" className="acc-danger" onClick={() => { if (window.confirm(`${child.alias}의 기록을 모두 지울까요?`)) { save({ children: state.children.filter((c) => c.id !== child.id) }); setSelected('') } }}>
              이 자녀 기록 지우기
            </button>
          </section>
        </>
      )}

      {!child && <section className="acc-card"><p className="acc-note">자녀를 추가하면 한도·신고 기록과 장기 시뮬레이션이 열립니다. 아직 기록이 없어도 괜찮습니다. 계산 없이 안내만 볼 수도 있습니다.</p></section>}
      {!child && <SimpleWayCard />}
      <p className="acc-note child-foot">증여세 규칙은 2026년 10월 기준 안내 자료를 바탕으로 한 정리이며 공식 원문과 다를 수 있습니다. 부모가 자녀 계좌를 계속 직접 매매하는 경우, 소액을 수시로 넣는 경우, 10년 경계 날짜 같은 사안은 사정에 따라 판단이 달라지니 세무사나 국세청(126)에서 확인하세요. 조부모 등 다른 직계존속의 증여가 있으면 한도가 합산됩니다.</p>
    </div>
  )
}

function AddChild({ first, onAdd }: { first: boolean; onAdd: (c: Child) => void }) {
  const [alias, setAlias] = useState('')
  const [birth, setBirth] = useState('')
  const ok = /^\d{4}-(0[1-9]|1[0-2])$/.test(birth)
  return (
    <section className="acc-card">
      <h2>{first ? '자녀 추가하기' : '다른 자녀 추가'}</h2>
      <div className="acc-row">
        <label className="acc-field"><span>별칭</span><input type="text" maxLength={12} value={alias} placeholder="예: 첫째" onChange={(e) => setAlias(e.target.value)} /></label>
        <label className="acc-field"><span>태어난 연월</span><input type="month" value={birth} max={todayKst().slice(0, 7)} onChange={(e) => setBirth(e.target.value)} /></label>
      </div>
      <button type="button" className="acc-primary" disabled={!ok} onClick={() => { onAdd({ id: newId(), alias: alias.trim() || '자녀', birth, gifts: [] }); setAlias(''); setBirth('') }}>추가</button>
    </section>
  )
}

function LimitCard({ child, today }: { child: Child; today: string }) {
  const a = allowance(child, today)
  const relief = reliefDates(child, today)
  const adult = adultOn(child.birth)
  return (
    <section className="acc-card">
      <h2>지금 남은 증여 한도</h2>
      <dl className="acc-tiles">
        <div><dt>10년 한도 ({a.adult ? '성년' : '미성년'})</dt><dd>{man(a.limit)}</dd></div>
        <div className="is-main"><dt>남은 한도</dt><dd>{man(a.remaining)}</dd></div>
        <div><dt>최근 10년 쓴 금액</dt><dd>{man(a.used)}</dd></div>
        <div><dt>이 한도 안이면</dt><dd>증여세 0원</dd></div>
      </dl>
      {relief && (
        <p className="acc-note">
          한도가 다시 열리는 날: 가장 빠른 것은 <strong>{relief.first.safeOn}</strong>({man(relief.first.amount)}), 전부 회복은 <strong>{relief.full.safeOn}</strong>입니다.
          정확히 10년째 되는 날은 {relief.first.on}이지만 날짜 단위로 민감해서 며칠 여유를 두었습니다.
        </p>
      )}
      {!a.adult && <p className="acc-note">대략 {adult.slice(0, 7)} 이후 성년이 되면 한도가 5,000만원으로 바뀝니다. 혼인·출산 때는 별도로 최대 1억원이 더 공제되지만(평생 합산), 지금은 해당되지 않습니다.</p>}
    </section>
  )
}

function GiftsCard({ child, today, full, onAdd, onToggle, onRemove }: { child: Child; today: string; full: boolean; onAdd: (g: Gift) => void; onToggle: (id: string) => void; onRemove: (id: string) => void }) {
  const [date, setDate] = useState(today)
  const [amountMan, setAmountMan] = useState('')
  const amount = toWon(amountMan)
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today && amount > 0 && !full
  const plan = amount > 0 && date <= today ? planGift(child, date, amount) : null
  const pending = pendingFilings(child, today)
  return (
    <section className="acc-card">
      <h2>증여 기록</h2>
      <p className="acc-note">자녀 계좌로 돈을 보낸 날이 증여일입니다. 용돈이어도 저축·투자로 돌린 돈은 기록해 두세요. 한 번에 모아서 넣으면 신고도 한 번이면 됩니다.</p>
      <div className="acc-row">
        <label className="acc-field"><span>증여한 날</span><input type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="acc-field"><span>금액 (만원)</span><input type="number" inputMode="numeric" min="0" value={amountMan} placeholder="2000" onChange={(e) => setAmountMan(e.target.value)} /></label>
      </div>
      {plan && (
        <p className={plan.withinLimit ? 'acc-summary' : 'acc-warn'}>
          {plan.withinLimit
            ? <>이 금액은 한도 안이라 증여세는 0원입니다.</>
            : <>한도를 <strong>{man(plan.overBy)}</strong> 넘습니다. 넘은 부분에 대한 증여세는 대략 <strong>{man(plan.tax)}</strong>(자진 신고 3% 공제 반영)입니다.</>}
        </p>
      )}
      {full && <p className="acc-warn">기록은 전체 {MAX_GIFTS_TOTAL}건까지 저장합니다. 오래된 기록을 지운 뒤 추가해 주세요.</p>}
      <button type="button" className="acc-primary" disabled={!ok} onClick={() => { onAdd({ id: newId(), date, amount, giver: 'parent', reported: false }); setAmountMan('') }}>기록하기</button>

      {pending.length > 0 && (
        <div className="acc-guide is-drop">
          <strong>신고 표시가 안 된 증여</strong>
          {pending.map((p) => (
            <span key={p.gift.id}>
              {p.gift.date} {man(p.gift.amount)} — 마감 {p.deadline}{' '}
              {p.overdue ? <b className="child-over">({Math.abs(p.daysLeft)}일 지남, 세무사 확인 권장)</b> : <b>({p.daysLeft}일 남음)</b>}
            </span>
          ))}
          <small>한도 안이라 세금이 없어도 신고해 두면 나중에 증여 사실을 입증하기 좋다는 안내가 있습니다. 신고는 홈택스나 세무서에서 직접 하며, 이 화면은 신고를 대신하지 않습니다.</small>
        </div>
      )}

      {child.gifts.length > 0 && (
        <table className="acc-table child-table">
          <thead><tr><th>날짜</th><th>금액</th><th>신고 마감</th><th>신고함</th><th /></tr></thead>
          <tbody>
            {[...child.gifts].reverse().map((g) => (
              <tr key={g.id}>
                <td>{g.date}</td>
                <td>{man(g.amount)}</td>
                <td>{filingDeadline(g.date)}{daysBetween(today, filingDeadline(g.date)) < 0 && !g.reported ? ' (지남)' : ''}</td>
                <td><input type="checkbox" checked={g.reported} aria-label={`${g.date} 신고함`} onChange={() => onToggle(g.id)} /></td>
                <td><button type="button" className="acc-remove" onClick={() => onRemove(g.id)}>삭제</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function ProjectionCard({ child, today }: { child: Child; today: string }) {
  const remaining = allowance(child, today).remaining
  const [lumpMan, setLumpMan] = useState(remaining > 0 ? String(Math.round(remaining / 10_000)) : '2000')
  const [again, setAgain] = useState(true)
  const [monthlyMan, setMonthlyMan] = useState('')
  const [years, setYears] = useState(20)
  const lump = toWon(lumpMan)
  const monthly = toWon(monthlyMan)
  const result = useMemo(() => (lump + monthly > 0 ? project({ lump, periodicLump: again ? lump : 0, monthly, years }) : null), [lump, again, monthly, years])
  const age = approxAge(child.birth, today)
  return (
    <section className="acc-card">
      <h2>오래 두면 어느 정도가 될까</h2>
      <p className="acc-note">지수 ETF에 넣어 두고 건드리지 않는다고 가정했을 때, 과거 모든 시작 시점에서의 결과 범위입니다. 금액은 <strong>오늘의 물가로 환산한 가치</strong>입니다.</p>
      <div className="acc-row">
        <label className="acc-field"><span>지금 넣는 금액 (만원)</span><input type="number" inputMode="numeric" min="0" value={lumpMan} onChange={(e) => setLumpMan(e.target.value)} /></label>
        <label className="acc-field"><span>매달 적립 (만원, 선택)</span><input type="number" inputMode="numeric" min="0" value={monthlyMan} placeholder="0" onChange={(e) => setMonthlyMan(e.target.value)} /></label>
        <label className="acc-field">
          <span>얼마 동안 (자녀 {age}세 → {age + years}세)</span>
          <select value={years} onChange={(e) => setYears(Number(e.target.value))}>
            {[10, 15, 20, 25, 30].filter((y) => y >= MIN_YEARS && y <= MAX_YEARS).map((y) => <option key={y} value={y}>{y}년</option>)}
          </select>
        </label>
      </div>
      <label className="mix-check"><input type="checkbox" checked={again} onChange={(e) => setAgain(e.target.checked)} /><span>10년마다 한도가 다시 열리면 같은 금액을 한 번 더 넣는다</span></label>
      {result && (
        <>
          <dl className="acc-tiles">
            <div><dt>넣은 돈 합계</dt><dd>{man(result.invested)}</dd></div>
            <div><dt>같은 돈을 적금에 (실질)</dt><dd>{man(result.savings)}</dd></div>
            <div><dt>운이 나쁜 10%에서도</dt><dd>{man(result.p10)}</dd></div>
            <div className="is-main"><dt>보통의 경우</dt><dd>{man(result.median)}</dd></div>
            <div><dt>운이 좋은 10%에서는</dt><dd>{man(result.p90)}</dd></div>
            <div><dt>가장 나빴던 시작</dt><dd>{man(result.worst)}</dd></div>
          </dl>
          <More>
            <p className="acc-note">미국 지수 1926~2023년의 모든 시작 시점 {result.windows}개를 겹쳐서 본 값이라 서로 독립된 표본은 훨씬 적습니다. 한국 상장 지수 ETF는 길게 보면 표본이 24년뿐이라 참고만 합니다. 세금·수수료는 빼지 않았고, 과거 결과이며 미래를 약속하지 않습니다.</p>
          </More>
          {result.worst < result.invested && <p className="acc-warn">가장 나빴던 시작에서는 넣은 돈보다 줄었습니다. 그래서 이 돈을 20년 안에 써야 할 돈에 섞지 않는 게 중요합니다.</p>}
        </>
      )}
    </section>
  )
}

function SimpleWayCard() {
  const [name, setName] = useState('')
  const check = name.trim() ? childEtfCheck(name) : null
  return (
    <section className="acc-card">
      <h2>단순하게 가져가려면</h2>
      <ul className="acc-note">
        <li><strong>현금으로 증여</strong>한 뒤 자녀 계좌에서 사는 쪽이 계산이 간단합니다. 주식을 그대로 옮기면 증여일 전후 2개월 종가 평균으로 평가해야 합니다.</li>
        <li><strong>ETF만, 지수를 따라가는 것으로 한두 개</strong>. 개별 주식·레버리지·인버스·커버드콜은 오래 두는 계좌에 맞지 않습니다.</li>
        <li>부모가 <strong>자주 사고팔지 않습니다</strong>. 부모가 계속 직접 운용하면 그 수익까지 증여로 볼 수 있다는 설명이 있습니다.</li>
        <li>소액은 <strong>분기·반기마다 모아서</strong> 한 번에 증여하고 한 번에 신고합니다.</li>
      </ul>
      <div className="acc-pick">
        <strong>처음 고르기 쉬운 후보</strong>
        <ul>{CHILD_ETF_DEFAULTS.map((e) => <li key={e.code}>{e.name} <span className="acc-code">{e.code}</span> — {e.note}</li>)}</ul>
      </div>
      <label className="acc-field"><span>담으려는 종목 이름 확인해 보기</span><input type="text" value={name} placeholder="예: TIGER 200커버드콜ATM" onChange={(e) => setName(e.target.value)} /></label>
      {check && <p className={check.ok ? 'acc-summary' : 'acc-warn'}>{check.ok ? '가능: ' : '피하세요: '}{check.reason}</p>}
    </section>
  )
}

