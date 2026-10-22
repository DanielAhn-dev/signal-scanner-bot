import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AccountTag from '../../components/ui/AccountTag'
import { formatKrwMan, formatKrwReadable } from '../../lib/format'
import { projectValue } from '../../lib/goalReach'
import { FUTURE_DEFAULT_PATHS, shareAtLeast, simulateFuture } from '../../lib/futurePaths'
import type { MixIndex } from '../../lib/planMix'
import { SIM_PATH, simLinkState, weightsFromPlan } from '../../lib/sim/prefill'
import { useUserState } from '../../lib/userState'
import { EMPTY_STATE, type AccumulateState } from '../../lib/accumulate'
import GoalReachOptions from './GoalReachOptions'
import type { GoalView } from './useGoalTracker'
import '../accumulate/accumulate.css'

/** "오늘 물가로 보면" 한 줄에 쓰는 물가 가정 — 한국은행 물가안정목표 2% */
export const INFLATION_ASSUMPTION = 0.02

/**
 * 목표 트래커 '내 계획이면 언제 닿나' — 모아가기 4번 '목표에서 거꾸로'를 옮겨 왔다(화면 지도 5단계, 질문 하나에 집 하나).
 * 기준은 서버와 같다: [실제] 내 계좌 평가액 + 내 구성 과거 이력(보통·운 나쁨). '내가 가정한 수익률'은 보조로만.
 * 금액은 명목이고, 오늘 물가로 본 값을 한 줄 덧붙인다(물가 연 2% 가정).
 */
export default function ReachSection({ view, onSavePlan, saveMsg }: { view: GoalView; onSavePlan: (monthly: number) => void; saveMsg: string | null }) {
  const navigate = useNavigate()
  const { value: accRaw, set: setAcc } = useUserState<AccumulateState>('accumulate')
  const acc: AccumulateState = { ...EMPTY_STATE, ...(accRaw ?? {}) }
  const basis = view.basis
  const rates = basis?.rates ?? null
  const s = view.settings
  const retireYears = view.life && view.life.monthsToRetire > 0 ? Math.ceil(view.life.monthsToRetire / 12) : null
  const options = [...new Set([5, 10, 15, ...(retireYears ? [retireYears] : [])])].sort((a, b) => a - b)
  const [years, setYears] = useState<number>(retireYears ?? 10)
  const [showAssumed, setShowAssumed] = useState(false)
  // 목표 이상인 경우의 비율 — 모아가기 3번 '앞으로의 경우의 수'와 같은 계산·같은 구성(서버가 준 비중). 비중이 없는 옛 응답이면 줄을 숨긴다
  const weights = (rates?.weights ?? []).filter((w): w is { index: MixIndex; weight: number } => ['kospi200', 'sp500', 'nasdaq100'].includes(w.index))
  const wKey = weights.map((w) => `${w.index}:${w.weight}`).join(',')
  const target = view.target.requiredSeed
  const monthlyPlan = s.monthlyContribution
  const reachPct = useMemo(() => {
    if (!wKey || !(monthlyPlan > 0) || !(target > view.equity)) return null
    const r = simulateFuture({ mix: weights, monthly: monthlyPlan, lump: view.equity, years })
    return { hit: shareAtLeast(r, target), below: r.belowPrincipalPct }
  }, [wKey, monthlyPlan, view.equity, target, years])

  if (!basis || !rates) return null
  const monthly = s.monthlyContribution
  const value = (ratePct: number) => projectValue({ monthly, rate: ratePct / 100, lump: view.equity }, years * 12)
  const typical = value(rates.typicalPct)
  const low = value(rates.lowPct)
  const paid = view.equity + monthly * years * 12
  const todayPrice = (v: number) => v / Math.pow(1 + INFLATION_ASSUMPTION, years)
  const shortHistory = Number(rates.from.slice(0, 4)) >= 2010
  // 같은 계획(내 구성·지금 금액·매달·해마다 늘리기·기간)을 과거 실제 가격으로 — 시뮬레이터에 채워 넘긴다
  const openSim = () => navigate(SIM_PATH, { state: simLinkState({
    slots: weights.length ? [{ label: '내 계획 구성', weights: weightsFromPlan(weights) }] : undefined,
    monthly, lump: view.equity, raisePct: acc.raise?.pct, years,
  }) })

  return (
    <section className="goal-card" aria-label="내 계획이면 언제 닿나">
      <h2>내 계획이면 언제 닿나요?</h2>
      <p className="goal-card__lead">
        기준: <AccountTag kind={basis.assetSource === 'real' ? 'real' : 'virtual'} /> {basis.assetSource === 'real' ? '내 계좌' : '가상 계좌'} {formatKrwMan(view.equity)} ·
        매달 {formatKrwReadable(monthly)} · 내 구성({rates.label}) {rates.from}~ 이력 보통 연 {rates.typicalPct}%·운 나쁨 {rates.lowPct}%.
        과거 숫자이고 앞으로를 약속하지 않습니다.
      </p>
      {basis.assetSource === 'virtual' && (
        <p className="goal-note">내 계좌 기록이 없어 가상 계좌로 계산했어요. 포트폴리오에 내 계좌 보유·예수금을 적으면 그 금액으로 바뀝니다.</p>
      )}
      {shortHistory && (
        <p className="goal-note">이 구성은 이력이 {rates.from.slice(0, 4)}년부터라 짧고, 미국 주식이 유난히 강했던 구간이 대부분입니다. 운 나쁜 쪽 숫자를 기준으로 보세요.</p>
      )}

      <div className="acc-seg" role="radiogroup" aria-label="기간">
        {options.map((y) => (
          <button key={y} type="button" role="radio" aria-checked={years === y} className={years === y ? 'is-active' : ''} onClick={() => setYears(y)}>
            {y}년{retireYears === y ? ' · 은퇴까지' : ''}
          </button>
        ))}
      </div>
      <p className="acc-summary">
        {years}년 뒤 보통 <strong>{formatKrwMan(typical)}</strong>, 운 나쁘면 {formatKrwMan(low)} <small>(넣은 돈 {formatKrwMan(paid)})</small>
        <br />
        <small>오늘 물가로 보면 보통 {formatKrwMan(todayPrice(typical))} · 운 나쁘면 {formatKrwMan(todayPrice(low))} (물가 연 2% 가정)</small>
      </p>
      <p className="goal-note">
        평균으로 늘려 본 값입니다. 지난 {years}년을 실제 가격으로 따라가 보려면{' '}
        <button type="button" className="goal-link" onClick={openSim}>시뮬레이터에서 보기</button>
      </p>
      {reachPct && (
        <p className="goal-note">
          과거 1년 조각을 섞은 경우 {FUTURE_DEFAULT_PATHS.toLocaleString()}개 중 {years}년 뒤 필요 시드 {formatKrwMan(target)} 이상인 경우 <strong>{reachPct.hit.toFixed(0)}%</strong>
          {' '}(넣은 돈보다 적은 경우 {reachPct.below.toFixed(0)}%). 예측이 아닙니다 — 위기를 끼워 넣어 보려면{' '}
          <button type="button" className="goal-link" onClick={() => navigate('/accumulate')}>모아가기 3번 &lsquo;앞으로 경우의 수&rsquo;</button>
        </p>
      )}

      {monthly > 0 && view.target.requiredSeed > view.equity ? (
        <GoalReachOptions
          planMonthly={monthly}
          target={view.target.requiredSeed}
          lump={view.equity}
          rates={{ typical: rates.typicalPct / 100, low: rates.lowPct / 100, years: rates.years }}
          today={view.today}
          raise={acc.raise ?? null}
          onRaise={(next) => setAcc({ ...acc, raise: next ?? undefined })}
          onSavePlan={onSavePlan}
          saveMsg={saveMsg}
          onOpenMix={openSim}
        />
      ) : monthly <= 0 ? (
        <p className="goal-note">내 계획에 매달 넣을 돈을 정하면, 그 금액으로 언제 닿는지와 더 빨리 닿는 방법을 보여 드립니다.</p>
      ) : null}

      <label className="goal-assumed">
        <input type="checkbox" checked={showAssumed} onChange={(e) => setShowAssumed(e.target.checked)} /> 내가 가정한 수익률(연 {s.planAnnualPct}%)로도 보기
      </label>
      {showAssumed && (
        <p className="goal-note">
          가정 연 {s.planAnnualPct}%면 필요 시드 {formatKrwMan(view.target.requiredSeed)}에 {basis.etaAssumedMonth ? `${basis.etaAssumedMonth}쯤` : '50년 안에 못'} 닿습니다
          · {years}년 뒤 {formatKrwMan(value(s.planAnnualPct))}. 가정 수익률은 &lsquo;목표 설정&rsquo;에서 바꿉니다.
        </p>
      )}
    </section>
  )
}
