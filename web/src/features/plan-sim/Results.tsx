import { formatKrwMan } from '../../lib/format'
import type { RollingResult, SimPlanResult } from '../../lib/sim/engine'
import { spanText } from '../../lib/sim/period'

export type SlotResult = { name: string; label: string; plan: SimPlanResult; rolling: RollingResult | null }

const pct = (v: number | null, d = 1) => (v == null || !Number.isFinite(v) ? '-' : `${(v * 100).toFixed(d)}%`)
const signedMan = (v: number) => `${v >= 0 ? '+' : ''}${formatKrwMan(v)}`

/** 결과 표 — 행이 항목, 열이 구성(A·B·C). 좁은 화면에서도 열이 최대 4개라 가로로 넘치지 않는다 */
export function ResultTable({ rows }: { rows: SlotResult[] }) {
  const line = (label: string, f: (r: SlotResult) => string, hint?: string) => (
    <tr>
      <th scope="row">{label}{hint && <small className="ps-hint">{hint}</small>}</th>
      {rows.map((r) => <td key={r.name}>{f(r)}</td>)}
    </tr>
  )
  return (
    <table className="acc-table xls-card-table ps-table">
      <thead>
        <tr>
          <th scope="col">항목</th>
          {rows.map((r) => <th key={r.name} scope="col"><i className={`ps-key ps-key--${r.name}`} />{r.name}</th>)}
        </tr>
      </thead>
      <tbody>
        {line('넣은 돈', (r) => formatKrwMan(r.plan.stats.paidTotal))}
        {line('끝 평가금', (r) => formatKrwMan(r.plan.stats.endValue))}
        {line('손익', (r) => signedMan(r.plan.stats.endValue - r.plan.stats.paidTotal))}
        {line('내 돈 연수익률', (r) => pct(r.plan.stats.irr), '넣은 시점까지 따진 값')}
        {line('구성 연수익률', (r) => pct(r.plan.stats.cagr), '처음에 한 번에 넣었다면')}
        {line('최대 낙폭', (r) => pct(r.plan.stats.mdd, 0), '구성 자체, 월말 기준')}
        {line('원금 아래였던 가장 긴 기간', (r) => (r.plan.stats.longestUnderwaterMonths ? spanText(r.plan.stats.longestUnderwaterMonths) : '없음'))}
        {line('원금 대비 가장 깊었던 때', (r) => (r.plan.stats.trough ? `${r.plan.stats.trough.pct.toFixed(0)}%` : '없음'))}
      </tbody>
    </table>
  )
}

/**
 * 같은 길이·같은 금액을 데이터 안의 모든 시작 달로 돌린 끝 평가금 범위 — 고른 기간이 운이 좋았는지 본다.
 * 끝 배율 × 고른 기간에 넣은 돈으로 금액을 보여 준다(넣는 방식이 같으니 넣은 돈도 같다).
 */
export function RollingList({ rows, months }: { rows: SlotResult[]; months: number }) {
  const ok = rows.filter((r) => r.rolling)
  if (!ok.length) return <p className="acc-note">넣은 돈이 있어야 범위를 계산할 수 있습니다.</p>
  return (
    <div className="ps-rolling">
      {ok.map((r) => {
        const roll = r.rolling!
        const paid = r.plan.stats.paidTotal
        const span = roll.max - roll.min
        const at = (v: number) => `${span > 0 ? ((v - roll.min) / span) * 100 : 50}%`
        const place = roll.worsePct >= 70 ? '좋았던 편' : roll.worsePct <= 30 ? '나빴던 편' : '중간쯤'
        return (
          <div key={r.name} className="ps-roll">
            <p className="ps-roll-head"><i className={`ps-key ps-key--${r.name}`} /><strong>{r.name}</strong> {r.label} <small className="acc-code">시작 달 {roll.count}개</small></p>
            <div className="ps-roll-bar" aria-hidden="true">
              <span className="ps-roll-range" style={{ left: at(roll.p10), right: `calc(100% - ${at(roll.max)})` }} />
              <span className="ps-roll-mid" style={{ left: at(roll.median) }} />
              <span className="ps-roll-me" style={{ left: at(roll.chosen) }} />
            </div>
            <dl className="ps-roll-facts">
              <div><dt>최저</dt><dd>{formatKrwMan(roll.min * paid)}</dd></div>
              <div><dt>하위 10%</dt><dd>{formatKrwMan(roll.p10 * paid)}</dd></div>
              <div><dt>중앙</dt><dd>{formatKrwMan(roll.median * paid)}</dd></div>
              <div><dt>최고</dt><dd>{formatKrwMan(roll.max * paid)}</dd></div>
            </dl>
            <p className="acc-note">
              고른 기간의 끝 평가금 {formatKrwMan(roll.chosen * paid)}은 {roll.count}개 시작 달 중 <strong>{place}</strong>입니다(이보다 나빴던 시작 달 {roll.worsePct.toFixed(0)}%).
              {roll.min < 1 && ` 같은 ${spanText(months)} 동안 같은 돈을 넣고도 원금보다 적게 끝난 시작 달이 있었습니다.`}
            </p>
            {roll.count < 24 && <p className="acc-warn">시작 달이 {roll.count}개뿐이라 범위를 믿기 어렵습니다. 기간을 줄이면 시작 달이 늘어납니다.</p>}
          </div>
        )
      })}
    </div>
  )
}
