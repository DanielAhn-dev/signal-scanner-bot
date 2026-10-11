import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch, invalidateCache } from '../../../lib/api'
import { useToast } from '../../../components/ToastProvider'
import { getTodayLocalYmd } from '../lib/dates'

export function useTradeModal({ load }: { load: (opts?: { soft?: boolean; force?: boolean }) => Promise<void> }) {
  const toast = useToast()
  const [modalOpen, setModalOpen] = useState(false)
  const [modalRow, setModalRow] = useState<any | null>(null)
  const [modalSide, setModalSide] = useState<'buy' | 'sell'>('buy')
  const [tradeQty, setTradeQty] = useState(1)
  const [tradePrice, setTradePrice] = useState<number | ''>('')
  const [tradeDate, setTradeDate] = useState<string>(getTodayLocalYmd())
  const [tradeLoading, setTradeLoading] = useState(false)
  const [tradeError, setTradeError] = useState<string | null>(null)

  const openTradeModal = (row: any, side: 'buy' | 'sell') => {
    setModalRow(row)
    setModalSide(side)
    setTradeQty(side === 'buy' ? (row.recommended_buy_qty || 1) : (row.quantity || 1))
    setTradePrice(row.stock?.close ?? row.avg_price ?? '')
    setTradeDate(getTodayLocalYmd())
    setTradeError(null)
    setModalOpen(true)
  }

  // 지난 날짜 기록은 실계좌(계좌 이름이 있는 보유)의 매수만 — 봇 가상 계좌는 전향 기록을 지키려고 막는다
  const canBackdateTrade = modalSide === 'buy'
    && !!(String(modalRow?.broker_name || '').trim() || String(modalRow?.account_name || '').trim())

  const submitTrade = async () => {
    if (!modalRow) return
    if (!tradeQty || tradeQty <= 0) { setTradeError('수량은 1 이상이어야 합니다'); return }
    if (tradePrice !== '' && Number(tradePrice) <= 0) { setTradeError('가격은 0보다 커야 합니다'); return }
    const backdated = canBackdateTrade && tradeDate && tradeDate < getTodayLocalYmd()
    if (backdated && tradePrice === '') { setTradeError('지난 날짜로 기록할 때는 그날 체결가를 입력해 주세요'); return }

    setTradeLoading(true)
    setTradeError(null)
    try {
      const payload = {
        code: modalRow.code,
        side: modalSide === 'buy' ? 'BUY' : 'SELL',
        quantity: Number(tradeQty),
        price: tradePrice !== '' ? Number(tradePrice) : (modalRow.stock?.close ?? modalRow.avg_price ?? 0),
        broker_name: String(modalRow?.broker_name || '').trim() || null,
        account_name: String(modalRow?.account_name || '').trim() || null,
        ...(backdated ? { trade_date: tradeDate } : {}),
      }
      const json = await apiFetch('/api/ui/virtual-trade', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 12_000,
        body: JSON.stringify(payload),
      })
      if (json?.error) {
        setTradeError(String(json?.error || '거래 실행 실패'))
      } else {
        toast.show(`${modalSide === 'buy' ? '매수' : '매도'} 등록 완료`)
        invalidateCache('/api/ui/positions')
        setModalOpen(false)
        await load({ soft: true, force: true })
      }
    } catch (e: any) {
      setTradeError(String(e?.message || e))
    } finally {
      setTradeLoading(false)
    }
  }

  return {
    modalOpen,
    setModalOpen,
    modalRow,
    modalSide,
    tradeQty,
    setTradeQty,
    tradePrice,
    setTradePrice,
    tradeDate,
    setTradeDate,
    tradeLoading,
    tradeError,
    canBackdateTrade,
    openTradeModal,
    submitTrade,
  }
}

export type TradeModalState = ReturnType<typeof useTradeModal>
