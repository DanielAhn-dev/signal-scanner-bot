import { useEffect, useState } from 'react'
import { apiFetch } from '../../../lib/api'
import { formatKstDateTime } from '../../../lib/format'
import { saveSimulationPlan, type HighlightPlanItem, type HighlightSimulationPlan } from '../planStore'
import { buildTelegramMessage, type TelegramFormat } from '../telegramFormat'
import type { PlanHistoryEntry } from '../types'

/** 계획 저장·불러오기(로컬/서버), 히스토리, 텔레그램 전송 */
export function usePlanSync(input: {
  chatId: string
  toast: { show: (message: string) => void }
  fromSeedBuilder: boolean
  initialPlan: HighlightSimulationPlan | null
  totalCapital: number
  setTotalCapital: React.Dispatch<React.SetStateAction<number>>
  memo: string
  setMemo: React.Dispatch<React.SetStateAction<string>>
  items: HighlightPlanItem[]
  setItems: React.Dispatch<React.SetStateAction<HighlightPlanItem[]>>
  setExpandedIdx: React.Dispatch<React.SetStateAction<number | null>>
  fillRatePct: number
  feePct: number
  taxPct: number
  summary: { evAfterCost: number; remaining: number }
}) {
  const {
    chatId, toast, fromSeedBuilder, initialPlan, totalCapital, setTotalCapital, memo, setMemo, items, setItems,
    setExpandedIdx, fillRatePct, feePct, taxPct, summary,
  } = input
  const [syncing, setSyncing] = useState(false)
  const [lastServerSavedAt, setLastServerSavedAt] = useState<string>('')
  const [telegramFormat, setTelegramFormat] = useState<TelegramFormat>('detailed')
  const [history, setHistory] = useState<PlanHistoryEntry[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)

  const buildPlan = () => ({
    createdAt: Date.now(),
    totalCapital: Math.max(0, totalCapital),
    notes: memo,
    items,
  })

  const applyPlan = (plan: any) => {
    if (!plan || !Array.isArray(plan.items)) return
    setTotalCapital(Math.max(0, Number(plan.totalCapital || 0)))
    setMemo(String(plan.notes || ''))
    setItems(plan.items)
    setExpandedIdx(null)
  }

  const saveLocal = () => {
    saveSimulationPlan(buildPlan())
    toast.show('로컬에 저장했습니다.')
  }

  const saveServer = async () => {
    if (!chatId) {
      toast.show('서버 저장은 텔레그램 연동 후 이용 가능합니다.')
      return
    }
    setSyncing(true)
    try {
      await apiFetch(`/api/ui/simulation-plan?chat_id=${encodeURIComponent(chatId)}`, {
        method: 'POST',
        body: JSON.stringify({ plan: buildPlan() }),
        cacheMs: 0, timeoutMs: 15_000,
      })
      setLastServerSavedAt(new Date().toISOString())
      toast.show('서버에 저장했습니다.')
    } catch (e: any) {
      toast.show(`저장 실패: ${e?.message || String(e)}`)
    } finally {
      setSyncing(false)
    }
  }

  const loadServer = async () => {
    if (!chatId) {
      toast.show('서버 불러오기는 텔레그램 연동 후 이용 가능합니다.')
      return
    }
    setSyncing(true)
    try {
      const res = await apiFetch(`/api/ui/simulation-plan?mode=latest&chat_id=${encodeURIComponent(chatId)}`, { cacheMs: 0, timeoutMs: 12_000 })
      const plan = res?.data?.plan
      if (!plan) { toast.show('저장된 계획이 없습니다.'); return }
      applyPlan(plan)
      saveSimulationPlan(plan)
      setLastServerSavedAt(String(res?.data?.updatedAt || ''))
      toast.show('서버 계획을 불러왔습니다.')
    } catch (e: any) {
      toast.show(`불러오기 실패: ${e?.message || String(e)}`)
    } finally {
      setSyncing(false)
    }
  }

  const sendTelegram = async () => {
    setSyncing(true)
    try {
      const message = buildTelegramMessage({
        totalCapital: Math.max(0, totalCapital),
        fillRatePct, feePct, taxPct,
        expectedAfterCost: summary.evAfterCost,
        remaining: summary.remaining,
        items,
        format: telegramFormat,
      })
      await apiFetch('/api/ui/notify', {
        method: 'POST',
        body: JSON.stringify({ message }),
        cacheMs: 0, timeoutMs: 12_000,
      })
      toast.show(`텔레그램 전송 완료`)
    } catch (e: any) {
      toast.show(`전송 실패: ${e?.message || String(e)}`)
    } finally {
      setSyncing(false)
    }
  }

  const loadHistory = async () => {
    if (!chatId) {
      toast.show('히스토리는 텔레그램 연동 후 이용 가능합니다.')
      return
    }
    setHistoryLoading(true)
    try {
      const res = await apiFetch(`/api/ui/simulation-plan?mode=history&limit=10&chat_id=${encodeURIComponent(chatId)}`, { cacheMs: 0, timeoutMs: 12_000 })
      setHistory(res?.data || [])
      setHistoryOpen(true)
    } catch (e: any) {
      toast.show(`히스토리 실패: ${e?.message || String(e)}`)
    } finally {
      setHistoryLoading(false)
    }
  }

  const loadFromHistory = (entry: PlanHistoryEntry) => {
    applyPlan(entry.plan)
    saveSimulationPlan(entry.plan)
    setLastServerSavedAt(entry.updatedAt)
    setHistoryOpen(false)
    toast.show(`${formatKstDateTime(entry.updatedAt)} 계획을 불러왔습니다.`)
  }

  useEffect(() => {
    if (fromSeedBuilder || initialPlan?.items?.length) return
    void loadServer()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    syncing, lastServerSavedAt, telegramFormat, setTelegramFormat, history, historyOpen, setHistoryOpen, historyLoading,
    saveLocal, saveServer, loadServer, sendTelegram, loadHistory, loadFromHistory,
  }
}
