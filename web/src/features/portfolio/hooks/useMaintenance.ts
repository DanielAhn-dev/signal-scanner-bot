import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch, invalidateCache } from '../../../lib/api'
import { useToast } from '../../../components/ToastProvider'
import type { AccountFolder } from '../types'
import { getTodayLocalYmd } from '../lib/dates'
import type { HoldingRow } from '../types'

export function useMaintenance({ load, accountFolders }: { load: (opts?: { soft?: boolean; force?: boolean }) => Promise<void>; accountFolders: AccountFolder[] }) {
  const toast = useToast()
  const [maintModalOpen, setMaintModalOpen] = useState(false)
  const [maintMode, setMaintMode] = useState<'liquidateall' | 'holdingedit' | 'holdingrestore' | 'holdingdelete'>('holdingrestore')
  const [maintRow, setMaintRow] = useState<any | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteConfirmCode, setDeleteConfirmCode] = useState('')
  const [maintCode, setMaintCode] = useState('')
  const [maintBuyPrice, setMaintBuyPrice] = useState<number | ''>('')
  const [maintBuyDate, setMaintBuyDate] = useState<string>(getTodayLocalYmd())
  const [maintQty, setMaintQty] = useState<number>(1)
  const [maintBrokerName, setMaintBrokerName] = useState('')
  const [maintAccountName, setMaintAccountName] = useState('')
  const [maintLoading, setMaintLoading] = useState(false)
  const [maintError, setMaintError] = useState<string | null>(null)
  const [maintStep, setMaintStep] = useState<1 | 2>(1)
  const [maintAccountMode, setMaintAccountMode] = useState<'select' | 'manual'>('select')

  const openMaintenanceModal = (mode: 'liquidateall' | 'holdingedit' | 'holdingrestore' | 'holdingdelete', row?: HoldingRow) => {
    setMaintMode(mode)
    setMaintRow(row ?? null)
    setMaintError(null)
    if (mode === 'holdingedit') {
      const code = String(row?.code || '')
      setMaintCode(code)
      setMaintBuyPrice(Number(row?.avg_price || row?.buy_price || row?.stock?.close || 0) || '')
      setMaintBuyDate(String(row?.buy_date || getTodayLocalYmd()))
      setMaintQty(Math.max(1, Number(row?.quantity || 1)))
      setMaintBrokerName(String(row?.broker_name || ''))
      setMaintAccountName(String(row?.account_name || ''))
    }
    if (mode === 'holdingrestore') {
      setMaintCode('')
      setMaintBuyPrice('')
      setMaintBuyDate(getTodayLocalYmd())
      setMaintQty(1)
      setMaintBrokerName('')
      setMaintAccountName('')
      setMaintStep(1)
      setMaintAccountMode(accountFolders.length > 0 ? 'select' : 'manual')
    }
    if (mode === 'holdingdelete') {
      const code = String(row?.code || '')
      setMaintCode(code)
      setDeleteConfirmOpen(true)
      setDeleteConfirmCode(code)
      return
    }
    setMaintModalOpen(true)
  }

  const runMaintenance = async () => {
    setMaintLoading(true)
    setMaintError(null)
    try {
      const body: any = { mode: maintMode }
      if (maintMode === 'holdingedit' || maintMode === 'holdingrestore') {
        body.code = maintCode
        body.buy_price = maintBuyPrice
        body.buy_date = maintBuyDate
        body.quantity = maintQty
        body.broker_name = String(maintBrokerName || '').trim()
        body.account_name = String(maintAccountName || '').trim()
      }
      if (maintMode === 'holdingdelete') {
        body.code = maintCode
      }

      const json = await apiFetch('/api/ui/positions-maintenance', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 20_000,
        body: JSON.stringify(body),
      })
      if (json?.error) throw new Error(String(json.error))

      if (maintMode === 'liquidateall') {
        toast.show(`보유 종목 ${Number(json?.soldCount || 0)}건 전체매도 처리 완료`)
      } else if (maintMode === 'holdingrestore') {
        const label = json?.data?.stock_name || json?.data?.code || maintCode
        const action = json?.created ? '신규 추가' : '기존 포지션 수정'
        toast.show(`${label} 계좌/보유 저장(${action}) 완료`)
      } else if (maintMode === 'holdingdelete') {
        toast.show(`${maintCode} 종목이 완전 삭제되었습니다 (기록 포함)`)
      } else {
        toast.show('보유수정 완료')
      }

      invalidateCache('/api/ui/positions')
      setMaintModalOpen(false)
      setDeleteConfirmOpen(false)
      await load({ soft: true, force: true })
    } catch (e: any) {
      setMaintError(String(e?.message || e))
    } finally {
      setMaintLoading(false)
    }
  }

  return {
    maintModalOpen,
    setMaintModalOpen,
    maintMode,
    setMaintMode,
    maintRow,
    deleteConfirmOpen,
    setDeleteConfirmOpen,
    deleteConfirmCode,
    maintCode,
    setMaintCode,
    maintBuyPrice,
    setMaintBuyPrice,
    maintBuyDate,
    setMaintBuyDate,
    maintQty,
    setMaintQty,
    maintBrokerName,
    setMaintBrokerName,
    maintAccountName,
    setMaintAccountName,
    maintLoading,
    maintError,
    setMaintError,
    maintStep,
    setMaintStep,
    maintAccountMode,
    setMaintAccountMode,
    openMaintenanceModal,
    runMaintenance,
  }
}

export type MaintenanceState = ReturnType<typeof useMaintenance>
