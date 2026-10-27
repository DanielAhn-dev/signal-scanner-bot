import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Building2, ChevronDown, ChevronRight, PlusCircle } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import Button from '../../../components/ui/Button'
import Detail from '../../../components/ui/Detail'
import { formatNumber } from '../../../lib/format'
import { useAmountMask } from '../../../stores/amountMaskStore'
import { evaluatePeakGiveback, PEAK_GIVEBACK_ALERT_PCT, PEAK_GIVEBACK_EVIDENCE } from '../../../../../src/lib/peakGiveback'
import { resolveHoldingAction, summarizeAccounts } from '../../../lib/holdingAction'
import { rowTradeCost, type TradeCostOptions } from '../lib/summary'
import { accountLabel, holdingAccountKey, holdingValue } from '../lib/accountKey'
import { BADGE_TOOLTIPS, toSignalLabel, toWarnLabel } from '../lib/labels'
import { getScoreValue, type HoldingStateKind } from '../lib/holdingState'
import { buildReasonBadges } from '../lib/reasonBadges'
import { holdingSizing, type RealHoldingTotals } from '../lib/stockSizing'
import type { HoldingRow } from '../types'

type HoldingCardProps = {
  r: HoldingRow
  stateEvaluation: { state: HoldingStateKind; reasons: string[] }
  grade: 'A' | 'B' | 'C'
  accountSummary: ReturnType<typeof summarizeAccounts>
  addEntryMinScore: number
  includeCost: boolean
  tradeCostOpts: TradeCostOptions
  openTradeModal: (row: HoldingRow, side: 'buy' | 'sell') => void
  openMaintenanceModal: (mode: 'liquidateall' | 'holdingedit' | 'holdingrestore' | 'holdingdelete', row?: HoldingRow) => void
  /** 실계좌 보유 평가액 합 — 담을 크기(C66) 계산용 */
  realTotals: RealHoldingTotals
  /** 계좌 표시 이름(별칭). 없으면 '증권사 / 계좌명' */
  accountDisplay?: string | null
  /** 계좌별 묶음 안에서는 묶음 머리에 계좌가 있으니 카드에서 뺀다 */
  hideAccount?: boolean
}

export default function HoldingCard({
  r,
  stateEvaluation,
  grade,
  accountSummary,
  addEntryMinScore,
  includeCost,
  tradeCostOpts,
  openTradeModal,
  openMaintenanceModal,
  realTotals,
  accountDisplay,
  hideAccount = false,
}: HoldingCardProps) {
  const navigate = useNavigate()
  const m = useAmountMask()
  const [open, setOpen] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)
  // 위쪽 비중 목록에서 이 종목을 눌러 이동해 오면 펼친다
  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    const expand = () => setOpen(true)
    el.addEventListener('holding-expand', expand)
    return () => el.removeEventListener('holding-expand', expand)
  }, [])
  const pnl = r.unrealized_pnl
  const holdingState = stateEvaluation.state
  const score = getScoreValue(r)
  const scoreSignal = String(r?.score_signal || '').trim().toUpperCase()
  const entryGrade = String(r?.entry_grade || '').trim().toUpperCase()
  const trendGrade = String(r?.trend_grade || '').trim().toUpperCase()
  const warnGrade = String(r?.warn_grade || '').trim().toUpperCase()
  const rowAccountKey = holdingAccountKey(r)
  const action = resolveHoldingAction({
    code: String(r.code ?? ''),
    name: r.stock_name ?? null,
    pnlPct: r.unrealized_pct != null ? Number(r.unrealized_pct) : null,
    accountWeightPct: accountSummary.weightPct(rowAccountKey, holdingValue(r)),
    coveredCallShareOfIncomePct: accountSummary.coveredCallShareOfIncomePct(rowAccountKey),
    incomePeers: accountSummary.incomePeers(rowAccountKey),
    etf: r?.etf_key ?? null,
    weightCaution: r?.weight_caution ?? null,
    trimmedSinceBuy: r?.trimmed_since_buy ?? null,
    isBotAccount: rowAccountKey === '|||',
  })
  const reasonBadges = buildReasonBadges(r, holdingState, score, addEntryMinScore)
  const actionButtons = (
    <div className="portfolio-actions-row">
      <Button className="portfolio-action-btn" variant="secondary" onClick={() => openTradeModal(r, 'buy')}>
        <PlusCircle size={14} />추가매수
      </Button>
      <Button className="portfolio-action-btn" variant="secondary" onClick={() => openTradeModal(r, 'sell')}>
        매도 · 수익기록
      </Button>
      <div className="portfolio-actions-minor">
        <Button variant="ghost" size="sm" onClick={() => openMaintenanceModal('holdingedit', r)}>
          보유 수정
        </Button>
        <Button variant="ghost" size="sm" onClick={() => openMaintenanceModal('holdingdelete', r)} style={{ color: 'var(--color-error)' }}>
          삭제
        </Button>
      </div>
    </div>
  )

  return (
    <div className="card card-lg portfolio-position-card" data-holding-code={r.code ?? undefined} ref={cardRef}>

      {/* ── 헤더: 종목명 + 손익 ── */}
      <div
        className="portfolio-card-toggle"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen((v) => !v) } }}
      >
      <div className="portfolio-card-header">
        <div className="portfolio-card-title-group">
          <span className="title-lg">{r.stock_name ?? r.ticker ?? r.symbol}</span>
          <span className="caption muted portfolio-stock-code">{r.code}</span>
          {action.tone !== 'keep' && rowAccountKey !== '|||' && (
            <span className={`portfolio-action-chip portfolio-action-chip--${action.tone}`}>{action.verdict}</span>
          )}
        </div>
        <div className="portfolio-card-right">
        <div className="text-right portfolio-position-pnl">
          {(() => {
            const rawPnl = pnl != null ? Number(pnl) : null
            let displayPnl = rawPnl
            let displayPct = r.unrealized_pct != null ? Number(r.unrealized_pct) : null
            if (includeCost && rawPnl != null) {
              const inv = Number(r.quantity || 0) * Number(r.avg_price || 0)
              displayPnl = rawPnl - rowTradeCost(r, tradeCostOpts)
              displayPct = inv > 0 ? (displayPnl / inv) * 100 : null
            }
            return (
              <>
                <div
                  className={`portfolio-pnl-amount${displayPnl != null ? m.tone(displayPnl < 0 ? ' negative' : ' positive') : ''}`}
                >
                  {displayPnl != null ? m.krw(displayPnl) : '—'}
                </div>
                <div className="caption muted">
                  {displayPct != null ? m.text(`${formatNumber(displayPct, 2)}%`) : '—'}
                  {/* 나눠 산 종목(lot 2건 이상)은 산 날마다 기간이 달라 보유 일수 하나가 의미 없다 */}
                  {r.hold_days != null && (r.lots?.length ?? 0) < 2 ? ` · ${r.hold_days}일` : ''}
                </div>
              </>
            )
          })()}
        </div>
        <ChevronDown size={16} aria-hidden className={`portfolio-card-chevron${open ? ' open' : ''}`} />
        </div>
      </div>

      {/* ── 보유 정보: 수량 · 평균매수가 · 매수일 · 계좌 ── */}
      <div className="caption muted portfolio-position-meta">
        {r.quantity}주 · 평균가 {m.krw(r.avg_price)}{open && r.buy_date ? ` · ${r.buy_date}` : ''}
        {rowAccountKey !== '|||' && !hideAccount && (
          <span className="portfolio-meta-account">
            <Building2 size={11} />
            {accountDisplay || accountLabel(r?.broker_name, r?.account_name)}
          </span>
        )}
      </div>
      {(() => {
        // 담을 크기(C66): 최대를 넘은 실계좌 개별주만 한 줄. 팔라는 안내는 위성 20% 선·C54가 맡는다
        const sz = holdingSizing(r, realTotals)
        if (!sz || sz.overAmount <= 0) return null
        return (
          <div className="portfolio-peak-giveback portfolio-peak-giveback--alert">
            <AlertTriangle size={12} aria-hidden />
            <span>담을 크기{sz.accounts > 1 ? `(${sz.accounts}개 계좌 합계)` : ''}: 최대({m.krw(sz.maxAmount)})보다 {m.krw(sz.overAmount)} 많음 · 추가매수 멈춤</span>
          </div>
        )
      })()}
      </div>

      {open && (
      <>
      {/* ── 이 종목 대응: 결론·할 일 두 줄 요약 + 리밸런싱 링크. 봇 가상 계좌는 할 일이 없어 숨긴다 ── */}
      {rowAccountKey !== '|||' && (
        <div className={`portfolio-action portfolio-action--${action.tone}`} role="note" aria-label="이 종목 대응">
          <div className="portfolio-action-head">
            <span className="portfolio-action-verdict">{action.verdict}</span>
            <span className="caption muted">{action.role}</span>
          </div>
          <div className="portfolio-action-todo">{action.todo}</div>
          {(() => {
            // 실계좌 개별주: 기록 뒤 고점에서 얼마나 내줬는지 (−5%부터 보이고, −15% 넘으면 경고)
            const g = evaluatePeakGiveback({ avgPrice: r.avg_price, currentPrice: r.current_price, peakPrice: r.peak_since_buy?.price })
            if (!g || g.fromPeakPct > -5) return null
            const ev = PEAK_GIVEBACK_EVIDENCE
            return (
              <div className={`portfolio-peak-giveback${g.alert ? ' portfolio-peak-giveback--alert' : ''}`}>
                {g.alert && <AlertTriangle size={12} aria-hidden />}
                <span>
                  기록 뒤 최고 {g.peakGainPct >= 0 ? '+' : ''}{formatNumber(g.peakGainPct, 1)}% → 지금 {g.nowGainPct >= 0 ? '+' : ''}{formatNumber(g.nowGainPct, 1)}%
                  {' '}(고점 대비 {formatNumber(g.fromPeakPct, 1)}%)
                  {g.alert && ` — 정한 선(${PEAK_GIVEBACK_ALERT_PCT}%)을 넘었어요. 과거엔 이 선에서 판 쪽이 큰 손실을 ${ev.tailImprovementPp[0]}~${ev.tailImprovementPp[1]}%p 줄였어요(평균 수익은 비슷, ${ev.period}).`}
                </span>
              </div>
            )
          })()}
          <button type="button" className="portfolio-action-link" onClick={() => navigate('/income-guide')}>
            자세히 · 리밸런싱 <ChevronRight size={12} aria-hidden />
          </button>
        </div>
      )}

      <Detail>
      {/* ── 봇 판정값 (검증용): 한 줄 요약만 보이고 칩·배지·근거는 펼쳐서 본다 ── */}
      <details className="portfolio-bot-detail">
        <summary>
          <span>봇 판정(검증용)</span>
          <span className={`portfolio-state-chip portfolio-state-chip--${holdingState}`}>
            {holdingState === 'partial' ? '부분청산 후보' : holdingState === 'add' ? '추가매수' : '보통 보유'}
          </span>
          {reasonBadges.filter((b) => b.type === 'warn').map((b, i) => (
            <span key={i} className="portfolio-reason-badge portfolio-reason-badge--warn" title={b.title || BADGE_TOOLTIPS[b.label] || b.label}>
              {b.label}
            </span>
          ))}
        </summary>
        <div className="portfolio-card-chips">
          <span className="portfolio-grade-chip">
            등급 {grade} · 점수 {score != null ? formatNumber(score, 1) : '—'}
            {scoreSignal ? ` · ${toSignalLabel(scoreSignal)}` : ''}
          </span>
          {(entryGrade || trendGrade || warnGrade) && (
            <span className="portfolio-grade-chip">
              진입 {entryGrade || '-'} / 추세 {trendGrade || '-'} / 경고 {toWarnLabel(warnGrade)}
            </span>
          )}
          {reasonBadges.filter((b) => b.type !== 'warn').map((b, i) => (
            <span
              key={i}
              className={`portfolio-reason-badge portfolio-reason-badge--${b.type}`}
              title={b.title || BADGE_TOOLTIPS[b.label] || b.label}
            >
              {b.label}
            </span>
          ))}
        </div>
        {stateEvaluation.reasons.length > 0 && (
          <div className="portfolio-reason-panel" role="note" aria-label="판정 근거 상세">
            {stateEvaluation.reasons.map((reason, idx) => (
              <div key={idx} className="portfolio-reason-line">• {reason}</div>
            ))}
          </div>
        )}
      </details>

      {/* ── 로트 이력 ── */}
      {r.lots && r.lots.length > 0 && (
        <div className="caption portfolio-lots">
          로트: {r.lots.map((l) => `${l.acquired_quantity}주 @${m.krw(l.acquired_price)}`).join(' · ')}
        </div>
      )}

      </Detail>
      {/* ── 액션 버튼: 자주 쓰는 기록(사기·팔기)은 버튼, 고치기·지우기는 작은 글자 버튼.
           실험 계좌(봇이 관리)는 손대면 실험이 바뀌므로 접어 두고, 개입이 기록에 남는다고 알린다 ── */}
      {rowAccountKey === '|||' ? (
        <details className="portfolio-intervene">
          <summary className="caption muted">직접 개입 (실험 기록에 남음)</summary>
          {actionButtons}
        </details>
      ) : actionButtons}
      </>
      )}
    </div>
  )
}
