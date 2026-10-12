import { formatKrw, formatNumber } from '../../../../lib/format'
import Button from '../../../../components/ui/Button'
import Input from '../../../../components/ui/Input'
import Modal from '../../../../components/Modal'
import { getTodayLocalYmd, shiftYmd, toKstYmd } from '../../lib/dates'
import type { TradeModalState } from '../../hooks/useTradeModal'

export default function TradeModal({ trade }: { trade: TradeModalState }) {
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
