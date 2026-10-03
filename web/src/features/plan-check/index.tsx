import { useMemo, useState } from 'react'
import { formatKrwMan } from '../../lib/format'
import {
  BAD10_DRAWDOWN, CHECK_FREQUENCY, SPLIT_OPTIONS, planWithdrawal, requiredMonthly, sleeveCost, stockCapFor,
} from '../../lib/planGuide'
import '../accumulate/accumulate.css'
import './plan-check.css'

const man = formatKrwMan
const toWon = (manText: string) => { const n = Number(manText.replace(/,/g, '').trim()); return Number.isFinite(n) && n > 0 ? Math.round(n * 10_000) : 0 }
const manRound = (won: number) => `${Math.round(won / 10_000).toLocaleString('ko-KR')}만원`

type Tab = 'first' | 'save' | 'retire'
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'first', label: '처음 넣는 법' },
  { key: 'save', label: '필요 월 적립' },
  { key: 'retire', label: '은퇴 인출' },
]

export default function PlanCheckPage() {
  const [tab, setTab] = useState<Tab>('first')
  return (
    <div className="acc plan">
      <header>
        <p className="acc-eyebrow">계획 점검</p>
        <h1>넣기 전에, 내 돈에 맞는 속도와 크기 보기</h1>
        <p>과거 자료로 "이 정도는 각오해야 한다"는 범위를 보여 드립니다. 종목 추천이나 주문은 없습니다. 모든 숫자는 과거 결과이고 미래를 약속하지 않습니다.</p>
      </header>
      <section className="acc-card">
        <div className="acc-seg" role="tablist">
          {TABS.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'is-active' : ''} onClick={() => setTab(t.key)}>{t.label}</button>
          ))}
        </div>
      </section>
      {tab === 'first' && <><ToleranceCard /><SleeveCard /><SplitCard /><CheckingCard /></>}
      {tab === 'save' && <SavingCard />}
      {tab === 'retire' && <RetireCard />}
      <p className="acc-note plan-foot">미국 주식·채권 1926~2023년(달러, 물가 반영) 자료를 겹쳐 본 값이라 독립 표본은 적고, 한국 사정(세금·환율·수수료)은 일부만 반영했습니다. 한국 자료는 24년뿐이라 참고로만 봅니다.</p>
    </div>
  )
}

function ToleranceCard() {
  const [tol, setTol] = useState(20)
  const cap = useMemo(() => stockCapFor(tol), [tol])
  return (
    <section className="acc-card">
      <h2>얼마나 떨어져도 버틸 수 있나요</h2>
      <p className="acc-note">시작하고 5년 안에 운이 나쁜 10%(열 번 중 한 번)에서 겪는 최대 하락이 이 정도까지 갑니다. 그 정도 하락을 보고도 팔지 않을 수 있는 크기만 주식에 두는 게 핵심입니다.</p>
      <label className="acc-field plan-slider">
        <span>버틸 수 있는 하락폭 <b>−{tol}%</b></span>
        <input type="range" min={10} max={50} step={5} value={tol} onChange={(e) => setTol(Number(e.target.value))} />
      </label>
      <dl className="acc-tiles">
        <div><dt>주식 비중 상한</dt><dd>{cap.cap}%</dd></div>
        <div className="is-main"><dt>처음엔 이 정도부터</dt><dd>{cap.recommended}%</dd></div>
      </dl>
      <p className="acc-note">사람들은 실제 하락을 겪기 전에 자기 감내를 높게 잡는 경향이 있다고 알려져 있습니다(이 연구에서 검증한 것은 아닙니다). 잘못 잡았을 때의 비용이 비대칭이라(너무 높으면 바닥에서 팝니다) 한 칸 낮은 값을 기본으로 제안합니다. 나머지는 현금성·채권으로 둡니다.</p>
      <table className="acc-table plan-table">
        <thead><tr><th>주식 비중</th><th>나쁜 10%에서</th><th>가장 나빴을 때</th></tr></thead>
        <tbody>
          {BAD10_DRAWDOWN.map((r) => (
            <tr key={r.stock} className={r.stock === cap.cap ? 'is-pick' : ''}>
              <td>{r.stock}%</td><td>−{r.bad10}%</td><td>−{r.worst}%</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="acc-note">보유를 20년으로 늘려도 이 표는 거의 달라지지 않지만, 시작 시대에 따라 크게 갈립니다(주식 100%의 나쁜 10%가 1946~65년 시작은 −21%, 대공황 시기 시작은 −82%). 이 표는 폭락 가까이에서 시작하는 경우까지 담은 보수적 범위입니다. 한국 자료로는 같은 비중에서 하락이 더 깊게 나옵니다(−20%를 버틴다면 20% 안팎). 한국에서 시작한다면 더 낮은 쪽을 고르세요. 안전자산 쪽도 금리가 급등한 시기에는 −23%까지 내려간 적이 있습니다.</p>
    </section>
  )
}

function SleeveCard() {
  const [w, setW] = useState(30)
  const cost = Math.round(sleeveCost(w))
  return (
    <section className="acc-card">
      <h2>지루하면 오래 못 갑니다 — 재미 몫을 정해 두기</h2>
      <p className="acc-note">매달 분배금이 들어오는 커버드콜·고배당은 꾸준히 보게 만드는 힘이 있습니다. 문제는 오르는 장에서 포기하는 몫이 크다는 점입니다. 그래서 <strong>금지가 아니라 한도</strong>를 정해 두는 걸 권합니다. 지수를 기본으로 두고 재미 몫만 따로 떼어 두세요.</p>
      <label className="acc-field plan-slider">
        <span>재미(인컴) 몫 <b>{w}%</b></span>
        <input type="range" min={0} max={100} step={10} value={w} onChange={(e) => setW(Number(e.target.value))} />
      </label>
      <dl className="acc-tiles">
        <div><dt>지수만 들었을 때 대비 끝 자산</dt><dd>약 {cost}%</dd></div>
        <div className="is-main"><dt>한도 제안</dt><dd>{w <= 40 ? '이 정도면 무난' : '40% 이하를 권장'}</dd></div>
      </dl>
      <p className="acc-note">한국 커버드콜 2종의 2021~2026년 실제 분배금 기록으로 본 값입니다. 이 기간은 한국 지수가 3배 가까이 오른 강세장이라 비용이 크게 나왔고, 하락이 긴 시기에는 다를 수 있습니다. 하락 방어는 상품마다 달랐습니다(한국 커버드콜 최대낙폭 −19%~−31% 대 지수 −22%, 미국은 QYLD −23% 대 −24%로 거의 방어가 없었고 JEPI는 −13%로 절반 가까이 줄었습니다). "커버드콜이라 방어된다"는 상품별로 확인해야 합니다. 인컴 상품 평가금이 오르면 파는 규칙을 정한다면 "수익률 50%"보다 <strong>"인컴 몫이 정해 둔 한도를 넘으면 넘는 만큼 지수로"</strong>가 실제로 작동했습니다(수익률 기준은 분배금을 쓰고 나면 한 번도 걸리지 않았습니다).</p>
    </section>
  )
}

function SplitCard() {
  const [amountMan, setAmountMan] = useState('3000')
  const amount = toWon(amountMan)
  return (
    <section className="acc-card">
      <h2>한 번에 넣을까, 나눠 넣을까</h2>
      <p className="acc-note"><strong>나눠 넣는다고 더 벌지는 않습니다.</strong> 오히려 평균적으로는 조금 덜 법니다. 대신 넣자마자 떨어지는 장면을 덜 보게 해 주는 "후회 보험"입니다. 보험료가 얼마인지 아래에서 비교하세요.</p>
      <label className="acc-field"><span>넣을 목돈 (만원)</span><input type="number" inputMode="numeric" min="0" value={amountMan} onChange={(e) => setAmountMan(e.target.value)} /></label>
      <table className="acc-table plan-table">
        <thead><tr><th>방식</th><th>평균 비용(5년 뒤)</th><th>첫해 최저 평가 (나쁜 10%)</th></tr></thead>
        <tbody>
          {SPLIT_OPTIONS.map((o) => (
            <tr key={o.months}>
              <td>{o.label}</td>
              <td>{o.avgCostPct === 0 ? '—' : `−${o.avgCostPct}%`}</td>
              <td>{amount > 0 ? manRound(amount * o.firstYearLowBad10) : `${Math.round(o.firstYearLowBad10 * 100)}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="acc-note">주식 100%, 미국 자료 기준입니다. 첫해에 가장 많이 줄어 보이는 시점의 평가액을 넣은 돈 대비로 계산했습니다. 12개월 분할은 첫해 화면은 가장 편하지만 5년 뒤 평균 격차가 가장 큽니다. 부담이 크다면 <strong>3~6개월 분할</strong>이 비용 대비 무난합니다. 분할 기간 동안 아직 안 넣은 돈은 현금성 상품에 두세요.</p>
    </section>
  )
}

function CheckingCard() {
  return (
    <section className="acc-card">
      <h2>얼마나 자주 볼까 — 월 1회를 권합니다</h2>
      <p className="acc-note">자주 본다고 결과가 바뀌지는 않습니다. 바뀌는 건 <strong>"원금 아래"인 화면을 마주치는 횟수</strong>입니다. 3년 보유 중앙값입니다.</p>
      <table className="acc-table plan-table">
        <thead><tr><th>확인 주기</th><th>코스피</th><th>S&P500</th></tr></thead>
        <tbody>
          {CHECK_FREQUENCY.map((r) => <tr key={r.label}><td>{r.label}</td><td>{r.kospi}번</td><td>{r.sp500}번</td></tr>)}
        </tbody>
      </table>
      <p className="acc-note">월 1회만 봐도 3년 안에 −10%를 한 번이라도 볼 확률은 코스피 53%, S&P500 37%입니다. "안 보면 안 아프다"가 아니라 <strong>마주쳤을 때 할 일을 미리 정해 두자</strong>가 정직한 말입니다. 하락 때 할 일은 섞어보기 화면의 "하락 때 할 일 미리 정해 두기"에서 적어 둘 수 있습니다.</p>
    </section>
  )
}

function SavingCard() {
  const [targetMan, setTargetMan] = useState('30000')
  const [years, setYears] = useState(20)
  const target = toWon(targetMan)
  const r = useMemo(() => requiredMonthly(target, years), [target, years])
  return (
    <section className="acc-card">
      <h2>목표 금액까지 매달 얼마가 필요한가</h2>
      <p className="acc-note">금액은 <strong>오늘 물가로 환산한 가치</strong>이고, 월 적립액도 오늘 가치로 고정했습니다. 단일 숫자 대신 시작 시점의 운에 따른 범위를 보여 드립니다.</p>
      <div className="acc-row">
        <label className="acc-field"><span>목표 금액 (만원)</span><input type="number" inputMode="numeric" min="0" value={targetMan} onChange={(e) => setTargetMan(e.target.value)} /></label>
        <label className="acc-field">
          <span>기간</span>
          <select value={years} onChange={(e) => setYears(Number(e.target.value))}>
            {[10, 15, 20, 25, 30].map((y) => <option key={y} value={y}>{y}년</option>)}
          </select>
        </label>
      </div>
      {r && (
        <>
          <dl className="acc-tiles">
            <div><dt>적금만(실질 연 0.5%)</dt><dd>{manRound(r.savings)}</dd></div>
            <div className="is-main"><dt>투자, 시작 운이 보통이면</dt><dd>{manRound(r.median)}</dd></div>
            <div><dt>열 번 중 8번 닿으려면</dt><dd>{manRound(r.eightOfTen)}</dd></div>
            <div><dt>열 번 중 9번 닿으려면</dt><dd>{manRound(r.nineOfTen)}</dd></div>
          </dl>
          {r.nineOfTen > r.savings && <p className="acc-warn">이 조건에서는 투자로 "거의 확실하게" 닿으려면 적금보다 더 많이 넣어야 합니다. 기간이 짧을수록 투자는 보험이 아니라 도박에 가까워집니다.</p>}
          <p className="acc-note">같은 "보통"도 <strong>어느 시대에 시작했느냐</strong>에 따라 크게 갈립니다. 20년 단위로 시작 시기를 묶어 보면 보통 필요액이 {manRound(r.eraMedianMin)}에서 {manRound(r.eraMedianMax)}까지 벌어집니다(대공황 직후 시작은 적게, 1946~65년 시작은 1966~82년의 긴 부진 때문에 많이). 지금이 어느 쪽인지는 아무도 모르니 "보통"보다 8/10·9/10 칸을 기준으로 잡는 편이 안전합니다.</p>
          <p className="acc-note">"투자하면 필요한 월 금액이 반으로 준다"는 말은 시작 시점 운이 보통일 때만 맞습니다. 40~50대 몇 억은 수익률보다 <strong>저축액이 먼저</strong>이고, 부족분을 레버리지·몰빵으로 메우려는 시도가 위험한 이유가 이 표에 있습니다. 미국 주식 100% 기준이라 비중을 낮추면 보통의 경우는 더 적어지고 하락은 얕아집니다. 세금·수수료·임금 상승은 반영하지 않았습니다.</p>
        </>
      )}
      {!r && <p className="acc-note">목표 금액을 적고 기간을 고르세요.</p>}
    </section>
  )
}

function RetireCard() {
  const [assetsMan, setAssetsMan] = useState('18000')
  const [netMan, setNetMan] = useState('150')
  const [pensionMan, setPensionMan] = useState('')
  const [insurance, setInsurance] = useState<'regional' | 'dependent'>('regional')
  const [propertyMan, setPropertyMan] = useState('')
  const plan = useMemo(() => planWithdrawal({
    assetsWon: toWon(assetsMan), targetNetMonthlyWon: toWon(netMan), publicPensionMonthlyWon: toWon(pensionMan), insurance, propertyBaseWon: toWon(propertyMan),
  }), [assetsMan, netMan, pensionMan, insurance, propertyMan])
  return (
    <section className="acc-card">
      <h2>월 생활비를 계좌에서 꺼내 쓴다면</h2>
      <p className="acc-note">"월 얼마 받고 싶다"를 <strong>세금·건강보험료를 낸 뒤 손에 남는 돈</strong>으로 받아, 계좌에서 실제로 얼마를 꺼내야 하는지 거꾸로 계산합니다. 인출이 크면 중간에 바닥날 위험이 커집니다.</p>
      <div className="acc-row">
        <label className="acc-field"><span>굴릴 금융자산 (만원)</span><input type="number" inputMode="numeric" min="0" value={assetsMan} onChange={(e) => setAssetsMan(e.target.value)} /></label>
        <label className="acc-field"><span>월 실수령 목표 (만원)</span><input type="number" inputMode="numeric" min="0" value={netMan} onChange={(e) => setNetMan(e.target.value)} /></label>
        <label className="acc-field"><span>국민연금 등 월 수령액 (만원, 선택)</span><input type="number" inputMode="numeric" min="0" value={pensionMan} placeholder="0" onChange={(e) => setPensionMan(e.target.value)} /></label>
      </div>
      <div className="acc-row">
        <label className="acc-field">
          <span>건강보험</span>
          <select value={insurance} onChange={(e) => setInsurance(e.target.value as 'regional' | 'dependent')}>
            <option value="regional">지역가입자 (직접 납부)</option>
            <option value="dependent">자녀·배우자 직장보험의 피부양자</option>
          </select>
        </label>
        <label className="acc-field"><span>집·재산세 과세표준 (만원, 모르면 비움)</span><input type="number" inputMode="numeric" min="0" value={propertyMan} placeholder="0" onChange={(e) => setPropertyMan(e.target.value)} /></label>
      </div>
      <p className="acc-note">재산세 과세표준은 재산세 고지서에 있고, 자가 주택이면 대략 공시가격의 40~60%입니다. 전월세는 (보증금 + 월세×40)의 30% 정도로 반영됩니다.</p>
      {plan?.unreachable && <p className="acc-warn">이 자산으로는 연 20%를 꺼내도 월 실수령 목표에 닿지 않습니다. 목표를 낮추거나 자산·연금을 다시 확인해 주세요. 아래 숫자는 연 20%까지 꺼냈을 때입니다.</p>}
      {plan && (
        <>
          <dl className="acc-tiles">
            <div className="is-main"><dt>계좌에서 매달 꺼낼 돈</dt><dd>{plan.withdrawMonthly > 0 ? manRound(plan.withdrawMonthly) : '없음'}</dd></div>
            <div><dt>연 인출률</dt><dd>{plan.ratePct.toFixed(1)}%</dd></div>
            <div><dt>세금·보험료로 나가는 돈</dt><dd>{manRound(plan.leakageMonthly)}</dd></div>
            <div><dt>30년 버티지 못할 확률</dt><dd>{Math.round(plan.fail30)}%</dd></div>
          </dl>
          {plan.withdrawMonthly > 0 && plan.withdrawRange[1] > plan.withdrawRange[0] && <p className="acc-note">재산 과표가 ±15% 달라지면 꺼낼 돈은 {manRound(plan.withdrawRange[0])}~{manRound(plan.withdrawRange[1])} 사이입니다. 건보료 계산은 근사라 이 정도 오차가 있습니다.</p>}
          {plan.withdrawMonthly === 0 && <p className="acc-note">연금만으로 목표가 채워집니다. 금융자산은 비상금과 예비로 두면 됩니다.</p>}
          {plan.ratePct > 3.5 && <p className="acc-warn">연 {plan.ratePct.toFixed(1)}%는 25년 기준 {Math.round(plan.fail25)}%, 30년 기준 {Math.round(plan.fail30)}%의 시작 시점에서 자산이 바닥났던 수준입니다(미국 주식60·채권40). 과거 시작월을 겹쳐 본 값이고, 10년 조각을 무작위로 이어 붙여 다시 보면 30년·4%에서도 약 7%로 더 나쁘게 나옵니다. 특히 1946~85년에 시작한 사람들은 4%에서도 8~10%가 바닥났습니다. 월 {manRound(plan.withdrawMonthly * 0.8)}로 줄이면 훨씬 안전해집니다.</p>}
          {plan.ratePct > 3.3 && <p className="acc-note"><strong>지출 줄이기 규칙을 미리 정해 두면</strong> 같은 자산에서 안전한 인출률이 4.0%에서 4.5~5.0%로 올라갑니다. 예: 자산이 처음의 75% 아래로 내려가면 인출을 20% 줄이고, 90%를 회복하면 되돌립니다. 대신 전체 기간의 약 4분의 1은 20% 줄여 살아야 합니다. 줄일 항목을 지금 정해 두세요.</p>}
          {plan.financialCliff && <p className="acc-warn">분배금·이자가 연 1,000만원에 가까워집니다. 지역가입자는 연 1,000만원을 넘으면 금융소득 <strong>전체</strong>가 건보료에 반영되어 보험료가 갑자기 뜁니다. 분배금이 적은 상품이나 연금계좌 활용도 비교해 보세요.</p>}
          {plan.dependentOk === false && <p className="acc-warn">피부양자 요건에서 벗어납니다({plan.dependentReason}). 이 경우 지역가입자로 보험료를 내는 것으로 계산해 두었습니다.</p>}
          {plan.dependentOk === true && <p className="acc-note">{plan.dependentReason}. 계산에는 건강보험료를 0원으로 두었습니다.</p>}
          <p className="acc-note">연구 결과, 지출 조정과 연금·주택 같은 다른 소득원이 투자 수익률 개선보다 훨씬 큰 영향을 줍니다. 한국 주식형 ETF 매도 차익은 비과세로 가정했고 분배금은 연 2.5%로 가정해 15.4% 과세로 계산했습니다. 정확한 보험료는 <a href="https://www.nhis.or.kr" target="_blank" rel="noreferrer">국민건강보험공단</a> 모의계산으로 확인하세요. 세무·보험 판단이 아니라 대략의 규모를 보는 용도입니다.</p>
        </>
      )}
    </section>
  )
}
