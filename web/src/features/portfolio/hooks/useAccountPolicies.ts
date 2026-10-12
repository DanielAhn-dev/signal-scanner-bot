import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiFetch, invalidateCache } from '../../../lib/api'
import { useToast } from '../../../components/ToastProvider'
import type { AccountPolicy } from '../types'
import { buildAccountKey } from '../lib/accountKey'

export function useAccountPolicies({ selectedAccountKey, load }: { selectedAccountKey: string; load: (opts?: { soft?: boolean; force?: boolean }) => Promise<void> }) {
  const toast = useToast()
  const [accountPolicies, setAccountPolicies] = useState<AccountPolicy[]>([])
  const [policyLoading, setPolicyLoading] = useState(false)
  const [policySaving, setPolicySaving] = useState(false)
  const [policyDraft, setPolicyDraft] = useState<AccountPolicy | null>(null)
  const [policyAccordionOpen, setPolicyAccordionOpen] = useState(false)

  const policyByKey = useMemo(() => {
    const map = new Map<string, AccountPolicy>()
    for (const p of accountPolicies) {
      map.set(buildAccountKey(p.broker_name, p.account_name), p)
    }
    return map
  }, [accountPolicies])

  const loadAccountPolicies = useCallback(async () => {
    setPolicyLoading(true)
    try {
      const json = await apiFetch('/api/ui/account-policies', {
        cacheMs: 30_000,
        timeoutMs: 10_000,
        retries: 1,
      })
      setAccountPolicies(Array.isArray(json?.data) ? json.data : [])
    } catch {
      setAccountPolicies([])
    } finally {
      setPolicyLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadAccountPolicies()
  }, [loadAccountPolicies])

  useEffect(() => {
    if (selectedAccountKey === 'real' || selectedAccountKey === 'virtual') {
      setPolicyDraft(null)
      return
    }

    const [brokerName, accountName] = selectedAccountKey.split('|||')
    const existing = policyByKey.get(selectedAccountKey)
    setPolicyDraft(existing ?? {
      broker_name: brokerName || '',
      account_name: accountName || '',
      risk_profile: 'balanced',
      max_positions: null,
      daily_loss_limit_pct: null,
      min_cash_reserve_pct: null,
      add_entry_score_adjust: 0,
      partial_take_profit_adjust_pct: 0,
      stop_loss_pct: null,
      take_profit_pct: null,
    })
  }, [selectedAccountKey, policyByKey])

  const savePolicyDraft = useCallback(async () => {
    if (!policyDraft) return
    if (!String(policyDraft.broker_name || '').trim() || !String(policyDraft.account_name || '').trim()) {
      toast.show('정책 저장 대상 계좌가 없습니다')
      return
    }
    setPolicySaving(true)
    try {
      const json = await apiFetch('/api/ui/account-policies', {
        method: 'POST',
        cacheMs: 0,
        timeoutMs: 12_000,
        body: JSON.stringify(policyDraft),
      })
      if (json?.error) throw new Error(String(json.error))
      toast.show('계좌 정책 저장 완료')
      await loadAccountPolicies()
      await load({ soft: true, force: true })
    } catch (e: any) {
      toast.show(String(e?.message || e || '계좌 정책 저장 실패'))
    } finally {
      setPolicySaving(false)
    }
  }, [policyDraft, toast, loadAccountPolicies, load])

  return {
    policyLoading,
    policySaving,
    policyDraft,
    setPolicyDraft,
    policyByKey,
    savePolicyDraft,
    policyAccordionOpen,
    setPolicyAccordionOpen,
  }
}
