import { useMemo, useState } from 'react'
import { formatKrwMan } from '../../lib/format'
import { useProfileStore } from '../../stores/profileStore'
import More from '../../components/ui/More'
import GoalCard from './GoalCard'
import { EARLY_WITHDRAWAL_TAX_RATE, PENSION_SAVING_LIMIT_WON, PENSION_TOTAL_LIMIT_WON, TAX_RULES_YEAR, creditRate, planTaxShelter, type IncomeBand } from '../../lib/taxShelter'
import {
  BAD10_DRAWDOWN, CHECK_FREQUENCY, SPLIT_OPTIONS, ccDownturnCase, isFactStale, requiredMonthlyDetail, incomePlan, ratesLabels, planWithdrawal, requiredMonthly, sleeveCost, stockCapFor,
} from '../../lib/planGuide'
import { FACT_META, MARKET_PICK, RATES_LONG, RATES_NOW, RATES_REGIMES, START_YIELD, DOWNTURN, KR_RATES_FX } from '../../data/researchFacts'
import '../accumulate/accumulate.css'
import './plan-check.css'

const man = formatKrwMan
const toWon = (manText: string) => { const n = Number(manText.replace(/,/g, '').trim()); return Number.isFinite(n) && n > 0 ? Math.round(n * 10_000) : 0 }
/** 표·그래프 아래에 자료의 기간·표본·한계·생성일을 붙인다 — 숫자만 떼어 읽으면 오해하기 쉬우므로 */
function Basis({ id }: { id: string }) {
  const isAdmin = useProfileStore((st) => st.isAdmin)
  const m = FACT_META[id]
  if (!m) return null
  const stale = isFactStale(m.generated) && <span className="acc-warn"> 자료를 만든 지 6개월이 넘었습니다. 다시 확인이 필요합니다.</span>
  // 일반 사용자: 기간과 한계만 쉬운 말로. 관리자: 표본·자료 끝·생성일·스크립트까지 전부
  if (!isAdmin) return <p className="acc-note plan-basis">과거 자료({m.sample.split(',')[0]}) 기준이며 미래를 약속하지 않습니다. 한계: {m.caveat}{stale}</p>
  return (
    <p className="acc-note plan-basis">
      <strong>자료 기준</strong> {m.sample} · 자료 끝 {m.asOf} · 생성 {m.generated} · 스크립트 {m.script} · 한계: {m.caveat}{stale}
    </p>
  )
}

const manRound = (won: number) => `${Math.round(won / 10_000).toLocaleString('ko-KR')}만원`

type Tab = 'first' | 'save' | 'goal' | 'income' | 'rates' | 'retire' | 'tax'
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'first', label: '처음 넣는 법' },
  { key: 'save', label: '필요 월 적립' },
  { key: 'goal', label: '사용 시점' },
  { key: 'income', label: '인컴 점검' },
  { key: 'rates', label: '금리 환경' },
  { key: 'retire', label: '은퇴 인출' },
  { key: 'tax', label: '절세 계좌' },
]

export default function PlanCheckPage() {
  const [tab, setTab] = useState<Tab>('first')
  const isAdmin = useProfileStore((st) => st.isAdmin)
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
      {tab === 'first' && <><ToleranceCard /><MarketPickCard /><SleeveCard /><SplitCard /><CheckingCard /></>}
      {tab === 'save' && <SavingCard />}
      {tab === 'goal' && <GoalCard basis={<Basis id="glide" />} />}
      {tab === 'income' && <IncomeCard />}
      {tab === 'rates' && <RatesCard />}
      {tab === 'retire' && <RetireCard />}
      {tab === 'tax' && <TaxShelterCard />}
      {isAdmin && <AdminLab />}
      <More>
        <p className="acc-note plan-foot">미국 주식·채권 1926~2023년(달러, 물가 반영) 자료를 겹쳐 본 값이라 독립 표본은 적고, 한국 사정(세금·환율·수수료)은 일부만 반영했습니다. 한국 자료는 24년뿐이라 참고로만 봅니다. 일반 증권 앱(절세계좌 없음)에서는 코스피200 ETF 매매차익이 비과세라 세금 면에서 유리하고, 국내 상장 미국 지수 ETF는 차익에 15.4%가 붙어 연금저축·IRP·ISA 같은 절세계좌에서 하는 편이 맞습니다(가입 조건은 증권사 안내로 확인). 이 화면의 장기 숫자는 미국 자료 기준이라 코스피200에 그대로 맞지 않을 수 있고, 코스피200은 반도체 비중이 커서 분배율도 고배당 ETF보다 훨씬 낮습니다.</p>
      </More>
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
      <Basis id="tolerance" />
      <More>
        <p className="acc-note">보유를 20년으로 늘려도 이 표는 거의 달라지지 않지만, 시작 시대에 따라 크게 갈립니다(주식 100%의 나쁜 10%가 1946~65년 시작은 −21%, 대공황 시기 시작은 −82%). 이 표는 폭락 가까이에서 시작하는 경우까지 담은 보수적 범위입니다. 한국 자료로는 같은 비중에서 하락이 더 깊게 나옵니다(−20%를 버틴다면 20% 안팎). 한국에서 시작한다면 더 낮은 쪽을 고르세요. 안전자산 쪽도 금리가 급등한 시기에는 −23%까지 내려간 적이 있습니다.</p>
      </More>
    </section>
  )
}

function MarketPickCard() {
  const d = MARKET_PICK
  const h10 = d.hold.find((x) => x.years === 10)!
  const x = (v: number) => `${v.toFixed(2)}배`
  const p = (v: number) => `${v.toFixed(0)}%`
  return (
    <section className="acc-card">
      <h2>코스피냐 미국이냐 — 고르기 어렵다면</h2>
      <p className="acc-note">원화로 환산한 실제 가격(분배금 반영)으로 비교했습니다. 표본이 짧고 한국 급등 해가 포함돼 있습니다.</p>
      <table className="acc-table plan-table">
        <thead><tr><th>비교</th><th>코스피200</th><th>S&P500</th><th>반반</th></tr></thead>
        <tbody>
          <tr><td>전체 연 수익률</td><td>{d.kCagr.toFixed(1)}%</td><td>{d.uCagr.toFixed(1)}%</td><td>—</td></tr>
          <tr><td>최대 낙폭</td><td>{p(d.mdd.k)}</td><td>{p(d.mdd.u)}</td><td>{p(d.mdd.mix)}</td></tr>
          <tr><td>10년 보유 중앙값</td><td>{x(h10.kMed)}</td><td>{x(h10.uMed)}</td><td>{x(h10.mixMed)}</td></tr>
          <tr><td>10년 보유 최저</td><td>{x(h10.kMin)}</td><td>{x(h10.uMin)}</td><td>{x(h10.mixMin)}</td></tr>
          <tr><td>10년 보유 중앙값, 일반계좌 세후</td><td>{x(h10.kTaxMed)}</td><td>{x(h10.uTaxMed)}</td><td>—</td></tr>
        </tbody>
      </table>
      <More>
        <p className="acc-note">전체 수익률은 비슷해서 "길게 보면 다르지 않다"는 느낌이 맞습니다. 다만 코스피는 몇 해에 몰아서 오르고 그 구간을 지나지 못한 시작에는 불리했습니다(10년 보유로 보면 미국이 {Math.round(h10.usWinPct)}% 이겼습니다). 둘은 따로 움직여서(월 상관 {d.corr.toFixed(2)}) <strong>반반이 가장 나쁜 경우가 덜 나빴습니다.</strong> 고르기 어렵다면 반반이 후회를 줄입니다. 일반 증권 앱(세후)에서도 10년 보유 중앙값은 미국 {x(h10.uTaxMed)}, 코스피 {x(h10.kTaxMed)}로 순서는 같았지만(세후로 보면 미국이 {Math.round(h10.usWinTaxPct)}% 이김) 격차는 조금 줄었습니다. 세후는 코스피200 분배금 연 2.3% 가정, 국내 상장 미국 지수는 매도 차익의 15.4%만 반영한 단순 계산이라 손익통산·종합과세는 빠져 있습니다. 절세계좌에서는 미국 지수 쪽 세금이 줄어듭니다. 환율의 영향은 전체 기간 연 {d.fx.fxCagr.toFixed(1)}%p로 작았고, 환율을 빼고 달러 수익만 봐도 10년 보유에서 미국이 {d.fx.usdOnlyWinPct}% 이겼습니다. 오히려 환율은 완충 역할을 했습니다. 미국 주식이 가장 나빴던 12개월(달러 기준 월평균 {d.fx.worstUsdAvg}%)에는 원화가 월평균 {d.fx.worstFxAvg > 0 ? '+' : ''}{d.fx.worstFxAvg}% 약해져 원화 기준 손실이 월평균 {d.fx.worstKrwAvg}%로 줄었습니다. 환헤지 상품은 이 완충이 없어집니다.</p>
      </More>
      <Basis id="market" />
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
      <More>
        <p className="acc-note">한국 커버드콜 2종(옵션을 지수 전체에 월물로 파는 1세대형)의 2021~2026년 실제 분배금 기록으로 본 값입니다. 주간·데일리·OTM으로 나온 최신 상품은 상승을 훨씬 많이 따라가서(지수 상승월의 87~100%, 1세대는 47%) 이 비용보다 작을 수 있지만, 하락은 지수와 비슷하게 같이 빠졌고 상장 1~2년이라 긴 하락장 기록이 없습니다. 이 기간은 한국 지수가 3배 가까이 오른 강세장이라 비용이 크게 나왔고, 하락이 긴 시기에는 다를 수 있습니다. 하락 방어는 상품마다 달랐습니다(한국 커버드콜 최대낙폭 −19%~−31% 대 지수 −22%, 미국은 QYLD −23% 대 −24%로 거의 방어가 없었고 JEPI는 −13%로 절반 가까이 줄었습니다). "커버드콜이라 방어된다"는 상품별로 확인해야 합니다. 인컴 상품 평가금이 오르면 파는 규칙을 정한다면 "수익률 50%"보다 <strong>"인컴 몫이 정해 둔 한도를 넘으면 넘는 만큼 지수로"</strong>가 실제로 작동했습니다(수익률 기준은 분배금을 쓰고 나면 한 번도 걸리지 않았습니다).</p>
      </More>
      <Basis id="sleeve" />
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
      <Basis id="split" />
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
      <Basis id="checking" />
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
          <More>
            <p className="acc-note">같은 "보통"도 <strong>어느 시대에 시작했느냐</strong>에 따라 크게 갈립니다. 20년 단위로 시작 시기를 묶어 보면 보통 필요액이 {manRound(r.eraMedianMin)}에서 {manRound(r.eraMedianMax)}까지 벌어집니다(대공황 직후 시작은 적게, 1946~65년 시작은 1966~82년의 긴 부진 때문에 많이). 지금이 어느 쪽인지는 아무도 모르니 "보통"보다 8/10·9/10 칸을 기준으로 잡는 편이 안전합니다.</p>
          </More>
          <p className="acc-note">"투자하면 필요한 월 금액이 반으로 준다"는 말은 시작 시점 운이 보통일 때만 맞습니다. 40~50대 몇 억은 수익률보다 <strong>저축액이 먼저</strong>이고, 부족분을 레버리지·몰빵으로 메우려는 시도가 위험한 이유가 이 표에 있습니다. 미국 주식 100% 기준이라 비중을 낮추면 보통의 경우는 더 적어지고 하락은 얕아집니다. 세금·수수료·임금 상승은 반영하지 않았습니다.</p>
          <Basis id="saving" />
        </>
      )}
      {!r && <p className="acc-note">목표 금액을 적고 기간을 고르세요.</p>}
    </section>
  )
}

function RatesCard() {
  const lab = ratesLabels(RATES_NOW)
  const r = RATES_REGIMES
  const L = RATES_LONG
  const K = KR_RATES_FX
  const pc = (v: number) => `${v.toFixed(1)}%`
  const sg = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%p`
  const rows: Array<[string, { stock: number; bond: number; cash: number }, boolean]> = [
    ['단기금리 인상기', r.hiking, lab.short === '인상기'], ['단기금리 횡보', r.flat, lab.short === '횡보'], ['단기금리 인하기', r.cutting, lab.short === '인하기'],
    ['장단기 역전', r.inverted, lab.curve === '역전'], ['장단기 정상', r.normal, lab.curve === '정상'],
  ]
  return (
    <>
      <section className="acc-card">
        <h2>지금 미국 금리 환경</h2>
        <dl className="acc-tiles">
          <div><dt>단기(3개월물)</dt><dd>{RATES_NOW.short.toFixed(2)}%</dd></div>
          <div><dt>장기(10년물)</dt><dd>{RATES_NOW.long.toFixed(2)}%</dd></div>
          <div><dt>단기 12개월 변화</dt><dd>{sg(RATES_NOW.shortChg12)}</dd></div>
          <div><dt>장기 12개월 변화</dt><dd>{sg(RATES_NOW.longChg12)}</dd></div>
        </dl>
        <p className="acc-note">기준 {RATES_NOW.asOf}. 단기금리는 <strong>{lab.short}</strong>, 장기금리는 <strong>{lab.long}</strong>, 장단기 금리차는 {lab.curve}({sg(RATES_NOW.spread)})입니다. 단기금리와 장기금리는 따로 움직일 수 있어서 따로 봐야 합니다.</p>
      </section>
      <section className="acc-card">
        <h2>금리 환경별로 과거에는 어땠나</h2>
        <p className="acc-note">1년 수익(연환산). 현금성은 초단기채·CD처럼 가격이 거의 안 움직이는 자산입니다.</p>
        <table className="acc-table plan-table">
          <thead><tr><th>환경</th><th>주식</th><th>10년 국채</th><th>현금성</th></tr></thead>
          <tbody>
            {rows.map(([name, v, now]) => (
              <tr key={name} className={now ? 'is-pick' : ''}><td>{name}{now ? ' (지금)' : ''}</td><td>{pc(v.stock)}</td><td>{pc(v.bond)}</td><td>{pc(v.cash)}</td></tr>
            ))}
          </tbody>
        </table>
        <More>
          <p className="acc-note">읽는 법: 금리를 올리던 시기에는 <strong>현금성({pc(r.hiking.cash)})이 주식({pc(r.hiking.stock)})과 국채({pc(r.hiking.bond)})를 앞섰고</strong>, 장단기가 거꾸로 선 시기에는 주식이 {pc(r.inverted.stock)}에 그쳤습니다. 반대로 금리를 내리던 시기에는 국채({pc(r.cutting.bond)})가 좋았습니다. 금리가 내려간다고 주식이 오르는 것은 아니었습니다. 인하는 경기가 나빠서 하는 경우가 많았기 때문입니다. 이 표는 금리가 원인이라는 뜻이 아니라, 그런 환경에서 과거에 무슨 일이 있었는지 보여 줄 뿐입니다.</p>
        </More>
        <Basis id="rates" />
      </section>
      <section className="acc-card">
        <h2>한국 금리·환율이 움직일 때</h2>
        <p className="acc-note">CD91(단기금리) 12개월 변화 ±0.75%p, 원/달러 12개월 변화 ±7%를 기준으로 나눈 연 수익입니다(원화 환산, {K.period}). 지금은 CD91 {K.now.cd91.toFixed(2)}%(12개월 {sg(K.now.cdChg12)}), 원/달러 12개월 {K.now.fxChg12 >= 0 ? '+' : ''}{K.now.fxChg12.toFixed(1)}%입니다(기준 {K.now.asOf}).</p>
        <table className="acc-table plan-table">
          <thead><tr><th>환경</th><th>개월</th><th>코스피200</th><th>S&P500(원화)</th><th>금(원화)</th><th>현금(CD)</th></tr></thead>
          <tbody>
            {([['금리 인상기', K.rate.hiking], ['금리 횡보', K.rate.flat], ['금리 인하기', K.rate.cutting], ['원화 약세', K.fx.weak], ['환율 횡보', K.fx.flat], ['원화 강세', K.fx.strong]] as const).map(([name, v]) => (
              <tr key={name}><td>{name}</td><td>{v.months}</td><td>{pc(v.kospi)}</td><td>{pc(v.spy_krw)}</td><td>{pc(v.gold_krw)}</td><td>{pc(v.cash)}</td></tr>
            ))}
          </tbody>
        </table>
        <More>
          <p className="acc-note">읽는 법: 한국에서도 단기금리를 올리던 시기에 코스피200은 연 {pc(K.rate.hiking.kospi)}로 약했고 현금({pc(K.rate.hiking.cash)})과 금({pc(K.rate.hiking.gold_krw)})이 버텼습니다. 원화가 약해질 때(원/달러 상승) 코스피200은 {pc(K.fx.weak.kospi)}였지만 달러 자산(S&P500 원화 {pc(K.fx.weak.spy_krw)}, 금 {pc(K.fx.weak.gold_krw)})이 완충했습니다. 금리 인하기의 높은 수익({pc(K.rate.cutting.kospi)})은 위기 직후 반등이 섞인 것이라 &quot;인하하면 오른다&quot;로 읽으면 안 됩니다. 인상기는 독립된 구간이 5개 안팎이라 표본이 짧습니다.</p>
        </More>
        <Basis id="krRatesFx" />
      </section>
      <section className="acc-card">
        <h2>장기금리가 움직일 때 자산별로</h2>
        <p className="acc-note">미국 10년 금리가 6개월 사이 0.5%p 넘게 오르는 구간과 내리는 구간의 연 수익입니다(원화 환산, {L.period}).</p>
        <table className="acc-table plan-table">
          <thead><tr><th>장기금리</th><th>개월</th><th>코스피200</th><th>S&P500</th><th>미국 장기채</th><th>금</th></tr></thead>
          <tbody>
            {([['오르는 구간', L.rising], ['횡보', L.flat], ['내리는 구간', L.falling]] as const).map(([name, v]) => (
              <tr key={name}><td>{name}</td><td>{v.months}</td><td>{pc(v.kospi200)}</td><td>{pc(v.sp500)}</td><td>{pc(v.usbond20)}</td><td>{pc(v.gold)}</td></tr>
            ))}
          </tbody>
        </table>
        <More>
          <p className="acc-note"><strong>장기채는 금리 방향이 곧 수익</strong>입니다. 장기금리가 오르는 구간에 미국 장기채는 연 {pc(L.rising.usbond20)}, 내리는 구간에 {pc(L.falling.usbond20)}였습니다. 초단기채는 금리가 오를수록 이자가 늘고 가격은 거의 안 움직이지만, 금리가 내리면 이자도 줄어듭니다(재투자 위험). 주식은 장기금리가 오를 때 코스피200이 {pc(L.rising.kospi200)}로 약했고 S&P500은 {pc(L.rising.sp500)}로 버텼습니다. 장기금리가 오르는 구간은 {L.rising.months}개월, 내리는 구간은 {L.falling.months}개월뿐이라 표본이 짧습니다.</p>
        </More>
        <Basis id="ratesLong" />
      </section>
    </>
  )
}

function IncomeCard() {
  const [principalMan, setPrincipalMan] = useState('10000')
  const [cc, setCc] = useState(50)
  const [ccType, setCcType] = useState<'gen1' | 'gen2' | 'gen3'>('gen1')
  const [targetMan, setTargetMan] = useState('50')
  const ccWon = (toWon(principalMan) * cc) / 100
  const plan = useMemo(() => incomePlan({ principalWon: toWon(principalMan), ccSharePct: cc, targetNetMonthlyWon: toWon(targetMan), ccType }), [principalMan, cc, targetMan, ccType])
  return (
    <section className="acc-card">
      <h2>인컴 계좌, 매달 얼마나 들어올까</h2>
      <p className="acc-note">커버드콜과 고배당을 섞어 매달 분배금을 받는 계좌의 <strong>낮은 해·보통·높은 해</strong> 범위를 보여 줍니다. 분배금은 이자처럼 일정하지 않고 시장 변동성에 따라 움직입니다.</p>
      <div className="acc-row">
        <label className="acc-field"><span>인컴 계좌 원금 (만원)</span><input type="number" inputMode="numeric" min="0" value={principalMan} onChange={(e) => setPrincipalMan(e.target.value)} /></label>
        <label className="acc-field"><span>월 실수령 목표 (만원)</span><input type="number" inputMode="numeric" min="0" value={targetMan} onChange={(e) => setTargetMan(e.target.value)} /></label>
      </div>
      <label className="acc-field">
        <span>커버드콜 유형</span>
        <select value={ccType} onChange={(e) => setCcType(e.target.value as 'gen1' | 'gen2' | 'gen3')}>
          <option value="gen1">월물형 (한국 코스피200 등, 옵션을 전부 팖)</option>
          <option value="gen2">주간 옵션형 (한국 위클리·타겟)</option>
          <option value="gen3">데일리·타겟형 (미국 지수, 월 분배 목표 설계)</option>
        </select>
      </label>
      <label className="acc-field plan-slider">
        <span>커버드콜 비중 <b>{cc}%</b> <small>(나머지는 고배당)</small></span>
        <input type="range" min={0} max={100} step={10} value={cc} onChange={(e) => setCc(Number(e.target.value))} />
      </label>
      {plan && (
        <>
          <dl className="acc-tiles">
            <div><dt>낮은 해 (세후, 월)</dt><dd>{manRound(plan.low.netMonthly)}</dd></div>
            <div className="is-main"><dt>보통 해 (세후, 월)</dt><dd>{manRound(plan.typical.netMonthly)}</dd></div>
            <div><dt>높은 해 (세후, 월)</dt><dd>{manRound(plan.high.netMonthly)}</dd></div>
            <div><dt>보통 해 분배율(연)</dt><dd>{plan.typical.yieldPct.toFixed(1)}%</dd></div>
          </dl>
          {plan.shortfallLowPct > 0 && <p className="acc-warn">분배금이 낮은 해에는 목표 실수령에서 약 {Math.round(plan.shortfallLowPct)}% 모자랍니다. 생활비 3~6개월치 현금을 완충으로 두거나, 목표를 낮은 해 기준으로 잡으세요.</p>}
          {plan.principalForTarget > 0 && <p className="acc-note">보통 해 기준으로 월 {manRound(toWon(targetMan))}를 세후로 받으려면 원금 약 <strong>{manRound(plan.principalForTarget)}</strong>이 필요합니다.</p>}
          {plan.over20m && <p className="acc-warn">연 분배금이 2,000만원을 넘어 금융소득 종합과세 대상이 됩니다. 절세계좌 활용을 같이 보세요.</p>}
          {!plan.over20m && plan.over10m && <p className="acc-warn">연 분배금이 1,000만원을 넘습니다. 지역가입자는 이 금액부터 건강보험료가 늘 수 있습니다.</p>}
          <More>
            <p className="acc-note">숫자는 한국 상장 커버드콜·고배당 ETF의 실제 분배 이력입니다. <strong>신형(주간·데일리) 유형은 이력이 2년 안팎이라</strong> 분배율의 범위가 실제 변동보다 좁게 나옵니다. 월 분배금의 흔들림은 유형별로 달랐습니다(월물형 약 0.4, 한국 주간형 약 0.3, 미국 데일리형 약 0.07의 변동계수). 분배금을 받는 것과 별개로 <strong>상품 가격이 내려가면 원금이 줄어듭니다</strong>(커버드콜 한 종은 같은 기간 실제 가격이 11% 내렸습니다). 고배당은 매달이 아니라 분기·4월에 몰려 지급되는 경우가 많아 월 현금 흐름을 맞추려면 월배당 상품과 섞게 됩니다. 세후는 분배금 15.4% 과세만 반영했습니다.</p>
          </More>
          <More>
            <p className="acc-note"><strong>하락장·박스권에서는?</strong> 신형 구조는 상장이 얼마 안 돼 하락장 기록이 없어서, 옵션 가격을 모델로 계산한 <strong>가정 결과</strong>입니다(선택한 유형과 비슷한 구조, 옵션 프리미엄을 전부 분배한다고 가정).</p>
            <table className="acc-table plan-table">
              <thead><tr><th>구간(지수)</th><th>원금(기준가)</th><th>연 분배율</th><th>분배 포함 합계</th></tr></thead>
              <tbody>
                {([['crisis2008', '2008 금융위기'], ['sideways', '2015~16 박스권'], ['rates2022', '2022 금리 급등']] as const).map(([k, label]) => {
                  const d = DOWNTURN[ccType][k]
                  return <tr key={k}><td>{label} ({d.index > 0 ? '+' : ''}{d.index}%)</td><td>{d.nav > 0 ? '+' : ''}{d.nav}%</td><td>{d.yield_.toFixed(0)}%</td><td>{d.total > 0 ? '+' : ''}{d.total}%</td></tr>
                })}
              </tbody>
            </table>
            {ccWon > 0 && (
              <>
                <p className="acc-note">내 커버드콜 몫 {manRound(ccWon)}에 적용하면(고배당 몫 제외):</p>
                <table className="acc-table plan-table">
                  <thead><tr><th>구간</th><th>원금이 남는 금액</th><th>월 분배금(세후)</th></tr></thead>
                  <tbody>
                    {(['crisis2008', 'sideways', 'rates2022'] as const).map((k) => {
                      const c = ccDownturnCase(ccWon, ccType, k)
                      return <tr key={k}><td>{k === 'crisis2008' ? '2008 금융위기' : k === 'sideways' ? '2015~16 박스권' : '2022 금리 급등'}</td><td>{manRound(c.principalAfter)}</td><td>{manRound(c.netMonthly)}</td></tr>
                    })}
                  </tbody>
                </table>
                <p className="acc-note">분배금을 쓰지 않고 다시 투자하지 않으면 원금은 위 금액까지 줄고, 분배율은 모델 값이라 실제보다 높게 나옵니다. 월 분배금은 시작 원금 기준 단순 환산입니다.</p>
              </>
            )}
            <p className="acc-note">읽는 법: 하락장에서는 변동성이 커서 옵션 프리미엄이 커지므로 <strong>분배금은 줄지 않고 오히려 늘었습니다.</strong> 분배금이 줄어드는 때는 오히려 조용한 박스권입니다. 다만 <strong>원금(기준가)은 지수보다 더 크게 내려갔습니다.</strong> 분배금을 받아서 쓰기만 하면 원금이 지수보다 빨리 줄고, 분배금을 다시 투자하면 합계로는 지수보다 덜 잃었습니다. 실제 상품의 분배율(연 7~20%)은 이 모델(20~50%)보다 낮고, 한국 지수 옵션이 아니라 미국 S&P500 기준입니다.</p>
            <Basis id="downturn" />
          </More>
          <Basis id="income" />
        </>
      )}
    </section>
  )
}

function TaxShelterCard() {
  const [band, setBand] = useState<IncomeBand>('low')
  const [savingMan, setSavingMan] = useState('600')
  const [irpMan, setIrpMan] = useState('300')
  const plan = useMemo(() => planTaxShelter({ band, pensionSavingWon: toWon(savingMan), irpWon: toWon(irpMan) }), [band, savingMan, irpMan])
  return (
    <section className="acc-card">
      <h2>연금저축·IRP에 넣으면 돌려받는 돈</h2>
      <p className="acc-note">투자 수익과 별개로, <strong>넣는 순간 연말정산에서 세금을 돌려받습니다</strong>. 같은 돈을 일반 계좌에 두면 없는 혜택이라 가장 확실한 수익입니다. 단 연금으로 받기 전에 꺼내면 환급받은 세금(기타소득세 {(EARLY_WITHDRAWAL_TAX_RATE * 100).toFixed(1)}%)을 다시 내므로 오래 묶어 둘 돈만 넣으세요.</p>
      <div className="acc-row">
        <label className="acc-field">
          <span>내 소득 구간</span>
          <select value={band} onChange={(e) => setBand(e.target.value as IncomeBand)}>
            <option value="low">총급여 5,500만원 이하 (종합소득 4,500만원 이하)</option>
            <option value="high">총급여 5,500만원 초과</option>
          </select>
        </label>
        <label className="acc-field"><span>올해 연금저축 납입 (만원)</span><input type="number" inputMode="numeric" min="0" value={savingMan} onChange={(e) => setSavingMan(e.target.value)} /></label>
        <label className="acc-field"><span>올해 IRP 납입 (만원)</span><input type="number" inputMode="numeric" min="0" value={irpMan} onChange={(e) => setIrpMan(e.target.value)} /></label>
      </div>
      <dl className="acc-tiles">
        <div className="is-main"><dt>연말정산 환급</dt><dd>{manRound(plan.refundWon)}</dd></div>
        <div><dt>넣은 돈 대비</dt><dd>{plan.immediateReturnPct.toFixed(1)}%</dd></div>
        <div><dt>공제 인정 금액</dt><dd>{manRound(plan.eligibleWon)}</dd></div>
        <div><dt>더 넣으면 받을 환급</dt><dd>{manRound(plan.extraRefundPossibleWon)}</dd></div>
      </dl>
      {plan.overLimitWon > 0 && <p className="acc-warn">공제 한도(연금저축 {manRound(PENSION_SAVING_LIMIT_WON)}, 연금저축+IRP 합산 {manRound(PENSION_TOTAL_LIMIT_WON)})를 넘는 {manRound(plan.overLimitWon)}은 환급을 받지 못합니다. 한도를 넘는 돈은 일반 계좌나 ISA를 검토하세요.</p>}
      <p className="acc-note">공제율은 {(creditRate(band) * 100).toFixed(1)}%(지방소득세 포함) 기준입니다. 총급여 1.2억원 초과 구간은 연금저축 한도가 줄어듭니다. {TAX_RULES_YEAR}년 기준이며 세법은 해마다 바뀌므로 가입·납입 전에 금융기관이나 국세청 안내로 확인하세요. 연금으로 받을 때는 연금소득세(나이에 따라 3.3~5.5%)가 붙습니다. ISA는 한도 개편이 논의 중이라 숫자를 적지 않았습니다.</p>
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
          <More>
            <p className="acc-note">연구 결과, 지출 조정과 연금·주택 같은 다른 소득원이 투자 수익률 개선보다 훨씬 큰 영향을 줍니다. 한국 주식형 ETF 매도 차익은 비과세로 가정했고 분배금은 연 2.5%로 가정해 15.4% 과세로 계산했습니다. 정확한 보험료는 <a href="https://www.nhis.or.kr" target="_blank" rel="noreferrer">국민건강보험공단</a> 모의계산으로 확인하세요. 세무·보험 판단이 아니라 대략의 규모를 보는 용도입니다.</p>
          </More>
          <More>
            <p className="acc-note">출발할 때의 미국 10년 금리 수준도 인출 안전도를 크게 갈랐습니다. 60/40으로 30년 꺼냈을 때 바닥난 비율(미국 {START_YIELD.period} 시작):</p>
            <table className="acc-table plan-table">
              <thead><tr><th>시작 금리</th><th>연 4.0%</th><th>연 4.5%</th></tr></thead>
              <tbody>
                {START_YIELD.tiers.map((t) => (
                  <tr key={t.label} className={RATES_NOW.long >= t.minYield && RATES_NOW.long <= t.maxYield ? 'is-pick' : ''}><td>{t.label} ({t.minYield}~{t.maxYield}%)</td><td>{t.fail40}%</td><td>{t.fail45}%</td></tr>
                ))}
              </tbody>
            </table>
            <p className="acc-note">지금 미국 10년 금리는 {RATES_NOW.long.toFixed(2)}%입니다. 금리가 높게 출발하면 채권이 앞으로 높은 수익을 주기 때문에 안전했지만, 중간 구간은 1966~82년 같은 긴 부진 시작이 대부분이라 표본이 사실상 2~3개뿐이어서 이 표를 인출률의 보증으로 읽으면 안 됩니다.</p>
            <Basis id="startYield" />
          </More>
          <Basis id="withdrawal" />
        </>
      )}
    </section>
  )
}

/** 관리자 전용 — 연구 원자료를 조건을 바꿔 가며 본다. 일반 사용자 화면에는 나오지 않는다 */
function AdminLab() {
  const [targetMan, setTargetMan] = useState('30000')
  const [years, setYears] = useState(20)
  const [from, setFrom] = useState(1926)
  const [to, setTo] = useState(2003)
  const d = useMemo(() => requiredMonthlyDetail(toWon(targetMan), years, from, to), [targetMan, years, from, to])
  return (
    <section className="acc-card plan-admin">
      <h2>관리자 · 연구 원자료</h2>
      <p className="acc-note">시작 연도 범위를 바꿔 필요 월 적립액의 분포 전체를 봅니다(미국 주식 100% 실질). 시대에 따라 결과가 얼마나 달라지는지 확인하는 용도입니다.</p>
      <div className="acc-row">
        <label className="acc-field"><span>목표 (만원)</span><input type="number" min="0" value={targetMan} onChange={(e) => setTargetMan(e.target.value)} /></label>
        <label className="acc-field"><span>기간(년)</span><input type="number" min="5" max="40" value={years} onChange={(e) => setYears(Number(e.target.value) || 20)} /></label>
        <label className="acc-field"><span>시작 연도 ~부터</span><input type="number" min="1926" max="2023" value={from} onChange={(e) => setFrom(Number(e.target.value) || 1926)} /></label>
        <label className="acc-field"><span>~까지</span><input type="number" min="1926" max="2023" value={to} onChange={(e) => setTo(Number(e.target.value) || 2003)} /></label>
      </div>
      {d ? (
        <table className="acc-table plan-table">
          <thead><tr><th>시작 시점 운</th><th>필요 월 적립</th></tr></thead>
          <tbody>{d.rows.map((r) => <tr key={r.label}><td>{r.label}</td><td>{manRound(r.monthly)}</td></tr>)}</tbody>
        </table>
      ) : <p className="acc-note">범위가 너무 좁거나 기간이 자료보다 깁니다(시작 월 12개 이상 필요).</p>}
      {d && <p className="acc-note">시작월 {d.windows}개(겹치는 창). 범위를 1926~1945, 1946~1965처럼 바꿔 시대 편차를 비교하세요.</p>}
      <details>
        <summary>화면에 쓰이는 연구 표의 출처 전체</summary>
        <table className="acc-table plan-table">
          <thead><tr><th>표</th><th>표본</th><th>생성</th><th>스크립트</th></tr></thead>
          <tbody>{Object.entries(FACT_META).map(([k, m]) => <tr key={k}><td>{m.title}</td><td>{m.sample}</td><td>{m.generated}</td><td>{m.script}</td></tr>)}</tbody>
        </table>
      </details>
    </section>
  )
}
