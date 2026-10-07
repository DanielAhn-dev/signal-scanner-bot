import Detail from '../../components/ui/Detail'
import React, { useState } from 'react'
import Button from '../../components/ui/Button'
import Modal from '../../components/Modal'
import { apiFetch } from '../../lib/api'
import SheetHeaderBar from '../../components/SheetHeaderBar'
import { man, signed, useGoalTracker } from './useGoalTracker'
import { judgeRealism, requiredAnnualPct } from '../../lib/startPlan'
import { monthsUntil } from '../../../../src/services/goalTracker'
import LifePlanCard from './LifePlanCard'
import './goal-tracker.css'

const UP = 'var(--color-stock-up)'
const DOWN = 'var(--color-stock-down)'
const colorOf = (v: number) => (v >= 0 ? UP : DOWN)

/**
 * 목표 트래커 — 시드로 스윙 월 평균 수익을 내고, 수익은 재투자해 필요 시드까지 키운다.
 * 계산은 src/services/goalTracker.ts (금요일 텔레그램 보고와 같은 값). 매매 로직과는 무관하다.
 */
export default function GoalTrackerPage() {
  const { view, reason, load } = useGoalTracker()
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ targetMan: '', planPct: '', withdrawPct: '', contribMan: '', targetDate: '' })
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [depositOpen, setDepositOpen] = useState(false)
  const [depositMan, setDepositMan] = useState('')
  const [depositBusy, setDepositBusy] = useState(false)
  const [depositError, setDepositError] = useState<string | null>(null)
  const [depositDone, setDepositDone] = useState<string | null>(null)
  const [autoMan, setAutoMan] = useState('')
  const [autoBusy, setAutoBusy] = useState(false)
  const [autoMsg, setAutoMsg] = useState<string | null>(null)

  if (!view) {
    return (
      <main className="goal-page">
        <SheetHeaderBar title="목표 트래커" />
        <div className="goal-card">{reason ? `불러오지 못했습니다: ${reason}` : '불러오는 중…'}</div>
      </main>
    )
  }

  const startEdit = () => {
    setForm({
      targetMan: String(Math.round(view.settings.targetMonthlyProfit / 10_000)),
      planPct: String(view.settings.planAnnualPct),
      withdrawPct: String(view.settings.withdrawalPct ?? 4),
      contribMan: String(Math.round(view.settings.monthlyContribution / 10_000)),
      targetDate: view.settings.targetDate ?? '',
    })
    setSaveError(null)
    setEditing(true)
  }

  const save = async () => {
    setBusy(true)
    setSaveError(null)
    const ok = await load({
      method: 'POST',
      body: JSON.stringify({
        targetMonthlyProfit: Number(form.targetMan) * 10_000,
        planAnnualPct: Number(form.planPct),
        withdrawalPct: Number(form.withdrawPct),
        monthlyContribution: Number(form.contribMan) * 10_000,
        targetDate: form.targetDate,
      }),
    })
    setBusy(false)
    // 실패하면 편집을 닫지 않는다 — 닫으면 옛 값이 그대로 보여 저장된 것처럼 착각한다
    if (ok) setEditing(false)
    else setSaveError('저장하지 못했습니다. 잠시 뒤 다시 시도하세요.')
  }

  /** 표의 필요 금액이나 직접 적은 금액을 실제 "월 자동 입금"으로 저장한다 (입금일은 지금 설정 유지) */
  const applyAutoDeposit = async (amountWon: number) => {
    if (!Number.isFinite(amountWon) || amountWon < 0 || (amountWon > 0 && amountWon < 10_000)) {
      setAutoMsg('0(적립 안 함) 또는 1만원 이상으로 입력하세요')
      return
    }
    setAutoBusy(true)
    setAutoMsg(null)
    try {
      const prefs = await apiFetch('/api/ui/investment-prefs', { cacheMs: 0, retries: 0 })
      const day = Number(prefs?.data?.deposit_day) || 1
      await apiFetch('/api/ui/investment-prefs', { method: 'POST', body: JSON.stringify({ monthly_deposit: Math.round(amountWon), deposit_day: day }), cacheMs: 0, timeoutMs: 15_000 })
      await load()
      setAutoMsg(`월 자동 입금을 ${man(amountWon)}으로 저장했습니다`)
    } catch (e) {
      setAutoMsg(`저장하지 못했습니다: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setAutoBusy(false)
    }
  }

  const openDeposit = () => {
    setDepositMan('')
    setDepositError(null)
    setDepositOpen(true)
  }

  const submitDeposit = async () => {
    const amountMan = Number(depositMan.replace(/,/g, '').trim())
    if (!Number.isFinite(amountMan) || amountMan < 1) {
      setDepositError('1만원 이상으로 입력하세요')
      return
    }
    setDepositBusy(true)
    setDepositError(null)
    try {
      await apiFetch('/api/ui/investment-prefs', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 10_000,
        body: JSON.stringify({ manual_deposit: Math.round(amountMan * 10_000) }),
      })
      await load()
      setDepositDone(`${amountMan.toLocaleString('ko-KR')}만원을 입금했습니다. 가상 현금과 시드에 더해졌고, 수익률에는 섞이지 않습니다.`)
      setDepositOpen(false)
    } catch (e: unknown) {
      setDepositError(e instanceof Error ? e.message : String(e))
    } finally {
      setDepositBusy(false)
    }
  }

  const field = (key: keyof typeof form, label: string, hint: string, type = 'text') => (
    <div className="goal-field">
      <label htmlFor={`goal-${key}`}>{label}</label>
      <input
        id={`goal-${key}`}
        type={type}
        inputMode={type === 'text' ? 'decimal' : undefined}
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
      <span className="goal-field__hint">{hint}</span>
    </div>
  )

  const s = view.settings
  const t = view.thisMonth
  const p = view.progress
  const cross = p?.crossover ?? null
  const pct = Math.min(100, Math.max(0, view.target.progressPct))
  const withdrawPct = s.withdrawalPct ?? 4
  const life = view.life ?? null
  // 아직 필요 시드에 못 닿았을 때만: 목표 시점(없으면 은퇴 시점, 그것도 없으면 10년) 안에 닿으려면 연 몇 %가 필요한지
  const realism = (() => {
    if (view.equity >= view.target.requiredSeed) return null
    const months = s.targetDate
      ? monthsUntil(view.today, s.targetDate)
      : life && life.monthsToRetire > 0
        ? life.monthsToRetire
        : 120
    const years = Math.max(1, Math.round(months / 12))
    const need = requiredAnnualPct({ seed: view.equity, monthly: s.monthlyContribution, years, target: view.target.requiredSeed })
    const basis = s.targetDate ? `${years}년 기준` : life && life.monthsToRetire > 0 ? `${life.retireAge}세 은퇴까지 ${years}년` : `${years}년 기준`
    return { years, basis, ...judgeRealism(need) }
  })()
  const assessColor =
    t.assessment?.level === 'good' ? UP : t.assessment?.level === 'rare' ? 'var(--color-error)' : 'var(--color-text-secondary)'

  return (
    <main className="goal-page">
      <SheetHeaderBar
        title="목표 트래커"
        subtitle="모으는 중인 시드가 계획대로 가고 있는지 봅니다"
        action={
          !editing && (
            <div style={{ display: 'flex', gap: 8 }}>
              <Button size="sm" onClick={openDeposit}>
                입금 추가
              </Button>
              <Button size="sm" variant="secondary" onClick={startEdit}>
                목표 설정
              </Button>
            </div>
          )
        }
      />

      {depositDone && (
        <div className="goal-card" role="status">
          {depositDone}
        </div>
      )}

      <Modal isOpen={depositOpen} title="입금 추가" onClose={() => setDepositOpen(false)} size="sm">
        <p className="goal-card__lead">
          매달 같은 금액이 아니어도 됩니다. 넣은 금액만큼 가상 현금과 시드가 늘고, 넣은 원금에 기록됩니다. 월 자동 입금은 그대로 유지됩니다.
        </p>
        <div className="goal-field">
          <label htmlFor="goal-deposit">입금액 (만원)</label>
          <input
            id="goal-deposit"
            inputMode="decimal"
            autoFocus
            value={depositMan}
            onChange={(e) => setDepositMan(e.target.value)}
          />
        </div>
        <div className="goal-actions">
          {[10, 30, 50, 100].map((v) => (
            <Button key={v} size="sm" variant="secondary" onClick={() => setDepositMan(String(v))}>
              {v}만원
            </Button>
          ))}
        </div>
        {depositError && <div className="goal-error" style={{ marginTop: 8 }}>{depositError}</div>}
        <div className="goal-actions">
          <Button disabled={depositBusy} onClick={() => void submitDeposit()}>
            {depositBusy ? '입금 중...' : '입금'}
          </Button>
          <Button variant="ghost" onClick={() => setDepositOpen(false)}>
            취소
          </Button>
        </div>
      </Modal>

      {editing && (
        <section className="goal-card" aria-label="목표 설정">
          <h2>목표 설정</h2>
          <div className="goal-form">
            {field('targetMan', '목표 월 인출 (만원)', '나중에 매달 꺼내 쓰고 싶은 금액')}
            {field('withdrawPct', '인출률 (%)', `원금을 지키며 매년 꺼낼 비율. 기본 4% (2~8%)`)}
            {field('planPct', '계획 연 수익률 (%)', '시드를 모으는 동안의 성장 가정. 기본 8% (1~15%)')}
            {view.contributionLinked ? (
              <div className="goal-field">
                <span style={{ fontSize: 12, fontWeight: 600 }}>월 추가 입금</span>
                <span>{man(s.monthlyContribution ?? 0)}</span>
                <span className="goal-field__hint">아래 "필요 시드에 닿으려면" 표에서 바로 바꿀 수 있습니다</span>
              </div>
            ) : (
              field('contribMan', '월 추가 입금 (만원)', '매달 새로 넣는 돈')
            )}
            {field('targetDate', '필요 시드 도달 목표 시점', life ? `비워 두면 은퇴 시점(${life.retireMonth}, ${life.retireAge}세)이 목표입니다` : '이 시점에 맞추려면 매달 얼마를 넣어야 하는지 아래 표에 표시', 'month')}
          </div>
          {saveError && <div className="goal-error" style={{ marginTop: 8 }}>{saveError}</div>}
          <div className="goal-actions">
            <Button size="sm" disabled={busy} onClick={() => void save()}>
              저장
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              취소
            </Button>
          </div>
          <details className="goal-details">
            <summary>이 값들은 어떻게 정하나요?</summary>
            <p>
              계획 수익률은 검증된 규칙의 과거 수익이 연 10~13%였기 때문에 그보다 낮춘 8%를 기본으로 둡니다. 인출률은 코스피 30년 데이터에서
              물가를 반영해 20년 동안 꺼내 쓸 때 원금이 유지된 비율이 4% 87% · 5% 68% · 6% 50%라 기본 4%입니다. 고배당 ETF 배당률도 4~5%대입니다.
            </p>
          </details>
        </section>
      )}

      <section className="goal-card" aria-label="목표 달성도">
        <h2>
          목표: 월 {man(s.targetMonthlyProfit)} 인출 (연 {withdrawPct}%)
        </h2>
        <div className="goal-tiles">
          <div className="goal-tile">
            <div className="goal-tile__label">현재 자산</div>
            <div className="goal-tile__value">{man(view.equity)}</div>
          </div>
          <div className="goal-tile">
            <div className="goal-tile__label">필요 시드</div>
            <div className="goal-tile__value">{man(view.target.requiredSeed)}</div>
          </div>
          <div className="goal-tile">
            <div className="goal-tile__label">달성률</div>
            <div className="goal-tile__value">{view.target.progressPct.toFixed(0)}%</div>
          </div>
          <div className="goal-tile">
            <div className="goal-tile__label">예상 도달</div>
            <div className="goal-tile__value">{view.target.etaMonth ?? '50년 이상'}</div>
            <div className="goal-tile__sub">
              {life?.etaAge != null && (
                <span style={{ color: life.etaAge > life.retireAge ? DOWN : undefined }}>
                  {life.etaAge}세{life.etaAge > life.retireAge ? ` (은퇴 ${life.retireAge}세보다 늦음)` : ''} ·{' '}
                </span>
              )}
              연 {s.planAnnualPct}% 재투자{s.monthlyContribution > 0 ? ` + 월 ${man(s.monthlyContribution)} 입금` : ''}
            </div>
          </div>
        </div>
        <div
          className="goal-progress"
          role="progressbar"
          aria-valuenow={Math.round(pct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="필요 시드 달성률"
        >
          <div style={{ width: `${pct}%` }} />
        </div>
        <div className="goal-note">
          <strong>{view.phase.title}</strong>: {view.phase.text}
        </div>
        {realism && (
          <div className="goal-note" role="status">
            <strong>목표 현실성 ({realism.basis})</strong>: {realism.text}
          </div>
        )}
      </section>

      <LifePlanCard view={view} reload={() => void load()} />

      <section className="goal-card" aria-label="계획 대비">
        <h2>계획대로 가고 있나요?</h2>
        <div className="goal-tiles">
          <div className="goal-tile">
            <div className="goal-tile__label">오늘 계획선</div>
            <div className="goal-tile__value">{man(view.plan.planValue)}</div>
            <div className="goal-tile__sub">
              {s.startDate} 시작 {man(s.startEquity)}
            </div>
          </div>
          <div className="goal-tile">
            <div className="goal-tile__label">계획 대비</div>
            <div className="goal-tile__value" style={{ color: colorOf(view.plan.gapPct) }}>
              {view.plan.gapPct >= 0 ? '+' : ''}
              {view.plan.gapPct.toFixed(1)}%
            </div>
          </div>
          {p && (
            <>
              <div className="goal-tile">
                <div className="goal-tile__label">넣은 원금</div>
                <div className="goal-tile__value">{man(p.principal)}</div>
              </div>
              <div className="goal-tile">
                <div className="goal-tile__label">불어난 돈</div>
                <div className="goal-tile__value" style={{ color: colorOf(p.growth) }}>
                  {signed(p.growth)}
                </div>
                <div className="goal-tile__sub">
                  {p.growthPct >= 0 ? '+' : ''}
                  {p.growthPct.toFixed(1)}%
                </div>
              </div>
            </>
          )}
        </div>
        <Detail><div className="goal-note">누적으로 계획선을 따라가는지를 보세요. 매달 고르게 나오지 않습니다.</div></Detail>
      </section>

      <Detail>
      <section className="goal-card" aria-label="이번 달">
        <h2>이번 달</h2>
        <div className="goal-tiles">
          <div className="goal-tile">
            <div className="goal-tile__label">수익률</div>
            <div className="goal-tile__value" style={{ color: t.returnPct == null ? undefined : colorOf(t.returnPct) }}>
              {t.returnPct == null ? '기록 쌓는 중' : `${t.returnPct >= 0 ? '+' : ''}${t.returnPct.toFixed(1)}%`}
            </div>
          </div>
          <div className="goal-tile">
            <div className="goal-tile__label">계획 월 평균</div>
            <div className="goal-tile__value">{man(t.expectedProfit)}</div>
          </div>
          <div className="goal-tile">
            <div className="goal-tile__label">스윙 확정</div>
            <div className="goal-tile__value" style={{ color: colorOf(t.realizedSwing) }}>
              {signed(t.realizedSwing)}
            </div>
            <div className="goal-tile__sub">
              {t.sells}건 중 익절 {t.wins}
            </div>
          </div>
          <div className="goal-tile">
            <div className="goal-tile__label">지수·현금 스윕</div>
            <div className="goal-tile__value" style={{ color: colorOf(t.realizedSweep) }}>
              {signed(t.realizedSweep)}
            </div>
          </div>
        </div>
        {t.assessment && <div className="goal-note" style={{ color: assessColor }}>{t.assessment.text}</div>}
      </section>
      </Detail>

      {cross && (
        <section className="goal-card" aria-label="복리와 입금">
          <h2>복리가 입금을 넘는 시점</h2>
          <p className="goal-card__lead">
            계획상 월 수익 {man(cross.monthlyExpected)} / 월 입금 {man(cross.contribution)} ({Math.min(999, cross.ratioPct).toFixed(0)}%)
          </p>
          <div
            className="goal-progress goal-progress--thin"
            role="progressbar"
            aria-valuenow={Math.round(Math.min(100, cross.ratioPct))}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="월 수익 대비 월 입금"
          >
            <div style={{ width: `${Math.min(100, cross.ratioPct)}%` }} />
          </div>
          <div className="goal-note">
            {cross.months === 0
              ? '복리가 월 입금을 넘었습니다 — 이제 불어나는 돈이 넣는 돈보다 큽니다.'
              : cross.months != null
                ? `계획대로면 ${cross.month}(약 ${(cross.months / 12).toFixed(1)}년 뒤) 복리가 월 입금을 넘습니다. 그 전까지는 수익률보다 매달 넣는 것이 결과를 정합니다.`
                : '계획 수익률로는 50년 안에 복리가 월 입금을 넘지 않습니다.'}
          </div>
        </section>
      )}

      {view.schedule.length > 0 && (
        <section className="goal-card" aria-label="필요 입금액">
          <h2>필요 시드에 닿으려면 매달 얼마를 넣어야 하나요?</h2>
          <p className="goal-card__lead">
            지금 시드로는 계획상 월 평균 {man(view.currentMonthlyProfit)} 수익(재투자)이고, 원금을 지키며 꺼내 쓰면 월{' '}
            {man(view.currentMonthlyWithdrawal)}입니다. 연 {s.planAnnualPct}% 재투자 가정입니다.
          </p>
          <table className="goal-table">
            <thead>
              <tr>
                <th scope="col">도달 시점</th>
                <th scope="col">기간</th>
                <th scope="col">매달 넣을 금액</th>
                {view.contributionLinked && <th scope="col">적용</th>}
              </tr>
            </thead>
            <tbody>
              {view.schedule.map((r) => (
                <tr key={r.months} className={r.isTarget ? 'is-target' : undefined}>
                  <td>
                    {r.month}
                    {r.isTarget && <span className="goal-badge">목표</span>}
                    {r.isRetire && <span className="goal-badge">은퇴</span>}
                  </td>
                  <td>{r.months % 12 === 0 ? `${r.months / 12}년` : `${r.months}개월`}</td>
                  {/* "적용"이 만원 단위로 올려 저장하므로, 표도 같은 올림 금액을 보여 준다 */}
                  <td>{man(view.contributionLinked ? Math.ceil(r.contribution / 10_000) * 10_000 : r.contribution)}</td>
                  {view.contributionLinked && (
                    <td>
                      <Button size="sm" disabled={autoBusy} onClick={() => void applyAutoDeposit(Math.ceil(r.contribution / 10_000) * 10_000)}>적용</Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {view.contributionLinked && (
            <div style={{ marginTop: 12 }}>
              <p className="goal-card__lead" style={{ marginBottom: 6 }}>
                이 표는 계산 결과라 직접 고칠 수 없습니다. 지금 월 자동 입금은 {man(s.monthlyContribution ?? 0)}입니다.
                행의 "적용"을 누르면 그 금액이 월 자동 입금이 되고, 아래에 원하는 금액을 직접 넣어도 됩니다.
              </p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="number" inputMode="numeric" min="0" value={autoMan} placeholder="예: 60"
                  onChange={(e) => setAutoMan(e.target.value)}
                  aria-label="월 자동 입금 (만원)" style={{ width: 100, padding: '8px 10px', fontSize: 16 }}
                />
                <span>만원</span>
                <Button size="sm" disabled={autoBusy || autoMan.trim() === ''} onClick={() => void applyAutoDeposit(Number(autoMan) * 10_000)}>월 자동 입금으로 저장</Button>
              </div>
              {autoMsg && <div className="goal-note" role="status" style={{ marginTop: 8 }}>{autoMsg}</div>}
            </div>
          )}
        </section>
      )}

      <section className="goal-card" aria-label="알아둘 점">
        <h2>알아둘 점</h2>
        <div className="goal-note" style={{ marginTop: 0 }}>
          {view.normalRange.source} 기준으로 플러스 달은 {view.normalRange.plusMonthsPct}%, 10달 중 1달은 {view.normalRange.p10}% 이하이고,
          마이너스 달이 최장 {view.normalRange.maxLosingStreak}개월 연속 이어졌습니다.
        </div>
      </section>
    </main>
  )
}
