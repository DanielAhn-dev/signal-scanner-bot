import { lifeVerdict } from '../../../../src/services/goalTracker'
import LifeProfileCard from '../profile/LifeProfileCard'
import { man, useMonthlySurplus, type GoalView } from './useGoalTracker'

const UP = 'var(--color-stock-up)'
const DOWN = 'var(--color-stock-down)'

/**
 * 은퇴 나이 기준 — 지금 나이와 스스로 정한 은퇴 나이로 "그때까지 매달 얼마를 모으면 되는지"를 기준으로 보여 준다.
 * 그 금액을 만드는 방법(급여 − 생활비 늘리기, 부업·N잡, 지출 줄이기)은 사용자가 정한다.
 * 계산은 src/services/goalTracker.ts buildLifePlan (금요일 텔레그램 보고와 같은 문구).
 */
export default function LifePlanCard({ view, reload }: { view: GoalView; reload: () => void }) {
  const l = view.life ?? null
  const surplus = useMonthlySurplus(l ? view.today : undefined)
  const s = view.settings
  const withdrawPct = s.withdrawalPct ?? 4

  if (!l) {
    return (
      <section className="goal-card" aria-label="은퇴 나이 정하기">
        <h2>언제 은퇴하고 싶나요?</h2>
        <p className="goal-card__lead">
          태어난 연월과 은퇴하고 싶은 나이를 넣으면, "언젠가"가 아니라 그 나이에 맞춰 매달 모을 금액을 계산합니다. 프로필에서도 바꿀 수 있습니다.
        </p>
        <LifeProfileCard compact onSaved={() => reload()} />
      </section>
    )
  }

  const need = l.contributionForTarget
  const now = Math.max(0, s.monthlyContribution)
  const years = Math.floor(l.monthsToRetire / 12)
  const restMonths = l.monthsToRetire % 12
  const surplusGap = surplus ? surplus.average - need : null

  return (
    <section className="goal-card" aria-label="은퇴 나이 기준">
      <h2>
        {l.status === 'retired' ? `은퇴 나이(${l.retireAge}세) 이후` : `${l.retireAge}세 은퇴까지 매달 모을 금액`}
      </h2>
      <div className="goal-tiles">
        <div className="goal-tile">
          <div className="goal-tile__label">지금 나이</div>
          <div className="goal-tile__value">만 {l.currentAge}세</div>
          <div className="goal-tile__sub">{l.stageGuide.label}</div>
        </div>
        <div className="goal-tile">
          <div className="goal-tile__label">은퇴까지</div>
          <div className="goal-tile__value">
            {l.monthsToRetire > 0 ? `${years}년${restMonths ? ` ${restMonths}개월` : ''}` : '도달'}
          </div>
          <div className="goal-tile__sub">{l.retireMonth}</div>
        </div>
        {l.status !== 'retired' && (
          <>
            <div className="goal-tile">
              <div className="goal-tile__label">매달 모을 금액</div>
              <div className="goal-tile__value">{man(need)}</div>
              <div className="goal-tile__sub">필요 시드 {man(view.target.requiredSeed)} 기준</div>
            </div>
            <div className="goal-tile">
              <div className="goal-tile__label">지금 월 적립</div>
              <div className="goal-tile__value">{man(now)}</div>
              <div className="goal-tile__sub" style={{ color: l.contributionGap > 0 ? DOWN : UP }}>
                {l.contributionGap > 0 ? `${man(l.contributionGap)} 모자람` : '충분'}
              </div>
            </div>
          </>
        )}
      </div>
      <div className="goal-note">
        <strong>판단</strong>: {lifeVerdict(l)}
      </div>

      {l.status !== 'retired' && (
        <div className="goal-note">
          <strong>이 금액을 만드는 건 내 몫</strong>:{' '}
          {surplus === undefined
            ? '우리 집 남는 돈을 불러오는 중…'
            : surplus
              ? `시드 만들기 기록으로 보면 매달 남는 돈은 ${man(surplus.average)}입니다(최근 ${surplus.months.length}개월 평균, 보너스 제외). ` +
                (surplusGap != null && surplusGap >= 0
                  ? `필요한 ${man(need)}보다 ${man(surplusGap)} 많아 남는 돈을 꾸준히 넣으면 닿습니다.`
                  : `필요한 ${man(need)}보다 ${man(-(surplusGap ?? 0))} 모자랍니다. 수입 늘리기(부업·N잡), 생활비 줄이기, 은퇴 늦추기 중 어느 쪽이든 이 차이만 메우면 됩니다.`)
              : '무슨 일을 하든, 급여 − 생활비 = 남는 돈을 이 금액 이상으로 만들면 닿습니다. 시드 만들기에 수입·지출을 적으면 지금 남는 돈과 비교해 보여 줍니다.'}
        </div>
      )}

      {l.options.length > 1 && (
        <table className="goal-table" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th scope="col">은퇴 나이</th>
              <th scope="col">시점</th>
              <th scope="col">매달 모을 금액</th>
              <th scope="col">지금 적립대로면 그때 월 인출</th>
            </tr>
          </thead>
          <tbody>
            {l.options.map((o) => (
              <tr key={o.retireAge} className={o.isChosen ? 'is-target' : undefined}>
                <td>
                  {o.retireAge}세{o.isChosen && <span className="goal-badge">내 선택</span>}
                </td>
                <td>{o.retireMonth}</td>
                <td>{o.months > 0 ? man(Math.ceil(o.contribution / 10_000) * 10_000) : '-'}</td>
                <td>{man(o.monthlyWithdrawal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div className="goal-note">
        <strong>{l.stageGuide.label}</strong>: {l.stageGuide.text}
      </div>
      <details className="goal-details">
        <summary>어떤 가정으로 계산했나요?</summary>
        <p>
          지금 자산 {man(view.equity)}에서 연 {s.planAnnualPct}% 재투자, 매달 말 적립을 가정했습니다. 필요 시드는 월 {man(s.targetMonthlyProfit)}을 연{' '}
          {withdrawPct}%로 꺼내 쓰는 규모입니다. 물가 상승은 따로 반영하지 않았으니 은퇴가 멀수록 목표 월 인출을 넉넉히 잡으세요. 국민연금은 넣지
          않았습니다. 기대수명 {l.lifeExpectancy}세는 통계청 2023 생명표 기준 참고선입니다. 목표 설정에서 수익률·인출률을 바꾸면 이 표도 바뀝니다.
        </p>
      </details>
    </section>
  )
}
