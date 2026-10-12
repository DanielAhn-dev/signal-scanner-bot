import { Building2, PlusCircle } from 'lucide-react'
import Button from '../../../components/ui/Button'
import Detail from '../../../components/ui/Detail'
import { formatKrw, formatNumber } from '../../../lib/format'
import { resolveHoldingAction, summarizeAccounts } from '../../../lib/holdingAction'
import { rowTradeCost, type TradeCostOptions } from '../lib/summary'
import { accountLabel, holdingAccountKey, holdingValue } from '../lib/accountKey'
import { BADGE_TOOLTIPS, toSignalLabel, toWarnLabel } from '../lib/labels'
import { getScoreValue, type HoldingStateKind } from '../lib/holdingState'
import { buildReasonBadges } from '../lib/reasonBadges'
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
}: HoldingCardProps) {
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
    isBotAccount: rowAccountKey === '|||',
  })
  const reasonBadges = buildReasonBadges(r, holdingState, score, addEntryMinScore)

  return (
    <div className="card card-lg portfolio-position-card">

      {/* ── 헤더: 종목명 + 손익 ── */}
      <div className="portfolio-card-header">
        <div className="portfolio-card-title-group">
          <span className="title-lg">{r.stock_name ?? r.ticker ?? r.symbol}</span>
          <span className="caption muted portfolio-stock-code">{r.code}</span>
        </div>
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
                  className={`portfolio-pnl-amount${displayPnl != null ? (displayPnl < 0 ? ' negative' : ' positive') : ''}`}
                >
                  {displayPnl != null ? formatKrw(displayPnl) : '—'}
                </div>
                <div className="caption muted">
                  {displayPct != null ? `${formatNumber(displayPct, 2)}%` : '—'}
                  {r.hold_days != null ? ` · ${r.hold_days}일` : ''}
                </div>
              </>
            )
          })()}
        </div>
      </div>

      {/* ── 보유 정보: 수량 · 평균매수가 · 매수일 · 계좌 ── */}
      <div className="caption muted portfolio-position-meta">
        {r.quantity}주 · 평균가 {formatKrw(r.avg_price)}{r.buy_date ? ` · ${r.buy_date}` : ''}
        {rowAccountKey !== '|||' && (
          <span className="portfolio-meta-account">
            <Building2 size={11} />
            {accountLabel(r?.broker_name, r?.account_name)}
          </span>
        )}
      </div>

      {/* ── 이 종목 대응: 결론·할 일만 먼저, 상태·조건은 접어 둔다 (주의·조치 단계면 펼친 채로) ── */}
      <div className={`portfolio-action portfolio-action--${action.tone}`} role="note" aria-label="이 종목 대응">
        <div className="portfolio-action-head">
          <span className="portfolio-action-verdict">{action.verdict}</span>
          <span className="caption muted">{action.role}</span>
        </div>
        <div className="portfolio-action-todo">{action.todo}</div>
        <details className="portfolio-action-more" open={action.tone !== 'keep'}>
          <summary>{action.facts.length ? '이 종목 숫자 · 언제 움직이나' : '언제 움직이나'}</summary>
          {action.facts.length > 0 && (
            <ul className="portfolio-action-facts">
              {action.facts.map((f) => <li key={f}>{f}</li>)}
            </ul>
          )}
          <dl className="portfolio-action-lines">
            <div><dt>지금 상태</dt><dd>{action.now}</dd></div>
            <div><dt>언제 움직이나</dt><dd>{action.when}</dd></div>
          </dl>
          {action.source && <div className="caption muted portfolio-action-source">{action.source}</div>}
        </details>
      </div>

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
          로트: {r.lots.map((l) => `${l.acquired_quantity}주 @${formatKrw(l.acquired_price)}`).join(' · ')}
        </div>
      )}

      </Detail>
      {/* ── 액션 버튼: 자주 쓰는 기록(사기·팔기)은 버튼, 고치기·지우기는 작은 글자 버튼 ── */}
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
    </div>
  )
}
