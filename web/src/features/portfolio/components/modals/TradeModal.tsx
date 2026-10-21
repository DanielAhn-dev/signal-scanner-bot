import { AlertTriangle } from 'lucide-react'
import { formatKrw, formatNumber } from '../../../../lib/format'
import Button from '../../../../components/ui/Button'
import Input from '../../../../components/ui/Input'
import Modal from '../../../../components/Modal'
import { getTodayLocalYmd, shiftYmd, toKstYmd } from '../../lib/dates'
import type { TradeModalState } from '../../hooks/useTradeModal'
import { SIZING_EVIDENCE, SIZING_MAX_MULTIPLE } from '../../../../../../src/lib/positionSizing'
import { holdingSizing, SIZING_LEVEL_LABEL, type RealHoldingTotals } from '../../lib/stockSizing'
import { dropPlanLines, sanitizeDropPlan, shouldRemindOnSell, type DropPlan } from '../../../../lib/dropPlan'
import { useUserState } from '../../../../lib/userState'

/** realTotals: 실계좌 보유 평가액 합(개별주 한도와 같은 분모)·종목별 합계 — 담을 크기 계산용 */
export default function TradeModal({ trade, realTotals }: { trade: TradeModalState; realTotals: RealHoldingTotals }) {
  const {
    modalOpen,
    modalSide,
    modalRow,
    setModalOpen,
    tradeQty,
    setTradeQty,
    tradePrice,
    setTradePrice,
    tradeDate,
    setTradeDate,
    canBackdateTrade,
    tradeError,
    tradeLoading,
    submitTrade,
  } = trade
  const { value: dropPlanRaw } = useUserState<DropPlan>('dropPlan')
  const dropPlan = sanitizeDropPlan(dropPlanRaw)
  return (
    <Modal
      isOpen={modalOpen}
      title={modalSide === 'buy' ? '추가매수' : '매도 · 수익기록'}
      onClose={() => setModalOpen(false)}
      size="sm"
    >
      {modalRow && (
        <>
          <div className="muted" style={{ marginBottom: 'var(--space-3)' }}>
            <strong style={{ color: 'var(--color-text-primary)' }}>
              {modalRow.stock_name ?? modalRow.code}
            </strong>
            <span className="caption"> ({modalRow.code})</span>
          </div>

          {/* 손실 난 매도에만, 하락 전에 내가 정해 둔 계획을 다시 보여준다 — 막지 않는다(이미 증권사에서 팔고 기록만 하는 경우가 많다) */}
          {modalSide === 'sell' && dropPlan && shouldRemindOnSell(
            tradePrice !== '' ? Number(tradePrice) : Number(modalRow.stock?.close ?? 0),
            Number(modalRow.avg_price ?? 0),
          ) && (
            <div className="portfolio-modal-lots" style={{ marginBottom: 'var(--space-4)' }}>
              <div className="portfolio-modal-lots-title">팔기 전에, {dropPlan.savedAt}에 정해 둔 계획</div>
              {dropPlanLines(dropPlan).map((l) => (
                <div key={l} className="portfolio-modal-lots-row" style={{ wordBreak: 'keep-all' }}>· {l}</div>
              ))}
              <div className="caption muted" style={{ marginTop: 'var(--space-1)', wordBreak: 'keep-all' }}>
                이미 증권사에서 팔았다면 그대로 기록하세요.
              </div>
            </div>
          )}

          {modalSide === 'buy' && modalRow.lots && modalRow.lots.length > 0 && (
            <div className="portfolio-modal-lots">
              <div className="portfolio-modal-lots-title">기존 매수 내역</div>
              {modalRow.lots.map((l, i) => (
                <div key={i} className="portfolio-modal-lots-row">
                  {l.acquired_quantity}주 @ {formatKrw(l.acquired_price)}
                  {toKstYmd(l.acquired_at) ? <span className="muted"> · {toKstYmd(l.acquired_at)}</span> : null}
                </div>
              ))}
            </div>
          )}

          {modalSide === 'buy' && (!modalRow?.lots || modalRow.lots.length === 0) && (
            <div className="portfolio-modal-lots">
              <div className="caption muted">현재 매수 내역: {modalRow.quantity}주 · 평균 {formatKrw(modalRow.avg_price)}</div>
            </div>
          )}

          <div className="grid-two" style={{ marginBottom: 'var(--space-4)' }}>
            <Input
              label="수량"
              type="number"
              value={String(tradeQty)}
              onChange={(e: any) => setTradeQty(Number(e.target.value))}
            />
            <Input
              label="가격 (미입력 시 현재가)"
              type="number"
              value={tradePrice === '' ? '' : String(tradePrice)}
              onChange={(e: any) => setTradePrice(e.target.value === '' ? '' : Number(e.target.value))}
            />
          </div>

          {/* 기록 뒤 보유를 미리 보여 증권사 앱과 맞춰 보게 한다 — 2026-10-08 1주씩 나눠 체결된 걸 옮기다 1주가 빠져
              보유를 직접 고쳐야 했다. 저장 전에 수량이 다르면 바로 알 수 있게. */}
          {modalSide === 'buy' && Number(tradeQty) > 0 && (() => {
            const curQty = Number(modalRow.quantity || 0)
            const curAvg = Number(modalRow.avg_price || 0)
            const addQty = Number(tradeQty)
            const addPrice = tradePrice !== '' ? Number(tradePrice) : Number(modalRow.stock?.close ?? modalRow.avg_price ?? 0)
            const nextQty = curQty + addQty
            const nextAvg = nextQty > 0 ? (curQty * curAvg + addQty * addPrice) / nextQty : 0
            const isRealAccount = !!(String(modalRow?.broker_name || '').trim() || String(modalRow?.account_name || '').trim())
            return (
              <div className="portfolio-modal-lots" style={{ marginBottom: 'var(--space-4)' }}>
                <div>
                  기록하면 <strong>{formatNumber(nextQty, 0)}주</strong> · 평균 {formatKrw(Math.round(nextAvg))}
                </div>
                {isRealAccount && (
                  <div className="caption muted" style={{ marginTop: 'var(--space-1)' }}>
                    증권사 앱의 보유 수량과 같은지 확인하세요. 여러 번 나눠 체결됐으면 합친 수량과 평균 체결가로 한 번에 적어도 돼요.
                  </div>
                )}
              </div>
            )
          })()}

          {/* 담을 크기(C66): 실계좌 개별주만. 흔들림이 큰 종목일수록 적게 — 막지 않는 참고 안내 */}
          {modalSide === 'buy' && (() => {
            const addPrice = tradePrice !== '' ? Number(tradePrice) : Number(modalRow.stock?.close ?? modalRow.avg_price ?? 0)
            const addValue = Math.max(0, Number(tradeQty) || 0) * addPrice
            const s = holdingSizing(modalRow, realTotals, addValue)
            if (!s) return null
            const ev = SIZING_EVIDENCE
            return (
              <div className="portfolio-modal-lots" style={{ marginBottom: 'var(--space-4)' }}>
                <div className="portfolio-modal-lots-title">이 종목 담을 크기 (참고)</div>
                <div className="portfolio-modal-lots-row">
                  최근 60일 흔들림: 지수의 {formatNumber(s.volRatio, 1)}배 ({SIZING_LEVEL_LABEL[s.level]})
                </div>
                <div className="portfolio-modal-lots-row">
                  이 종목에 담을 최대: 약 {formatKrw(s.maxAmount)} · 입력대로면 {formatKrw(s.maxAmount + s.overAmount)}{s.accounts > 1 ? ` (${s.accounts}개 계좌 합계)` : ''}
                </div>
                {s.overAmount > 0 && (
                  <div className="portfolio-peak-giveback portfolio-peak-giveback--alert">
                    <AlertTriangle size={12} aria-hidden />
                    <span>최대보다 {formatKrw(s.overAmount)} 많아요. 기록은 그대로 할 수 있어요.</span>
                  </div>
                )}
                <details style={{ marginTop: 'var(--space-1)' }}>
                  <summary className="caption muted">왜 이 금액인가요?</summary>
                  <div className="caption muted" style={{ marginTop: 'var(--space-1)', wordBreak: 'keep-all', lineHeight: 1.6 }}>
                    개별주 한도(실계좌의 10%)를 5종목으로 나눈 {formatKrw(s.baseAmount)}을 기준으로, 흔들림이 큰 종목은 덜 담고
                    잔잔한 종목은 더 담아요(기준의 {SIZING_MAX_MULTIPLE}배까지). {ev.period}년 시총 상위 200개 중 무작위 5종목 바구니
                    {' '}{formatNumber(ev.baskets, 0)}개로 시험했더니, 이렇게 담으면 나쁜 해(하위 5%)의 1년 손실이 {ev.tail5Equal}%에서
                    {' '}{ev.tail5Sized}%로 줄었어요. 지수를 이기는 방법은 아니에요(같은 시점 지수 1년 평균 +{ev.indexAvg1y}%,
                    바구니 +{ev.basketAvg1y}%). 근거 {ev.code} · 생성 {ev.generatedAt}
                  </div>
                </details>
              </div>
            )
          })()}

          {canBackdateTrade && (
            <div style={{ marginBottom: 'var(--space-4)' }}>
              <Input
                label="체결일 (늦게 기록할 때만 변경)"
                type="date"
                value={tradeDate}
                min={shiftYmd(getTodayLocalYmd(), -7)}
                max={getTodayLocalYmd()}
                onChange={(e: any) => setTradeDate(String(e.target.value || getTodayLocalYmd()))}
              />
              <div className="caption muted" style={{ marginTop: 'var(--space-1)' }}>
                실계좌 매수만 최근 7일까지 지난 날짜로 기록할 수 있어요.
              </div>
            </div>
          )}

          {tradeError && (
            <div className="state-error" style={{ marginBottom: 'var(--space-3)' }}>
              <div className="state-error-title">{tradeError}</div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <Button variant="primary" onClick={submitTrade} disabled={tradeLoading}>
              {tradeLoading ? '처리 중…' : '실행'}
            </Button>
            <Button variant="ghost" onClick={() => setModalOpen(false)}>취소</Button>
          </div>
        </>
      )}
    </Modal>
  )
}
