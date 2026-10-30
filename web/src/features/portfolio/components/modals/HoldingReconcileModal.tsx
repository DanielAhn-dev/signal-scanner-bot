import { useMemo, useRef, useState } from 'react'
import Modal from '../../../../components/Modal'
import Button from '../../../../components/ui/Button'
import { useToast } from '../../../../components/ToastProvider'
import { apiFetch, invalidateCache } from '../../../../lib/api'
import { BULK_ESTIMATE_MEMO, reconcileHolding, type ReconcileResult } from '../../../../lib/holdingReconcile'
import { displayAccountName, type AccountAliases } from '../../lib/accountAliases'
import { holdingAccountKey } from '../../lib/accountKey'
import { getTodayLocalYmd, shiftYmd } from '../../lib/dates'
import type { AccountFolder, HoldingRow } from '../../types'

type Props = {
  isOpen: boolean
  onClose: () => void
  accountFolders: AccountFolder[]
  aliases: AccountAliases
  holdingAll: HoldingRow[]
  /** 모달을 열 때 미리 고를 계좌(보고 있던 계좌 탭) */
  defaultAccountKey: string
  load: (opts?: { soft?: boolean; force?: boolean }) => Promise<void>
}

type Draft = { qty: string; avg: string }

const won = (n: number) => `${Math.round(n).toLocaleString('ko-KR')}원`
const signed = (n: number) => `${n >= 0 ? '+' : '-'}${Math.round(Math.abs(n)).toLocaleString('ko-KR')}원`
const toNum = (s: string | undefined) => (s == null || s.trim() === '' ? null : Number(s.replace(/,/g, '')))

/**
 * 증권사 앱의 새 수량·평단만 적으면, 기록된 보유와의 차이를 추가 매수 한 건(추정)으로 채운다.
 * 건별로 기록한 거래는 그대로 두고 빠진 부분만 역산한다. 기록은 매수 API를 종목마다 한 건씩 호출한다.
 */
export default function HoldingReconcileModal({ isOpen, onClose, accountFolders, aliases, holdingAll, defaultAccountKey, load }: Props) {
  const toast = useToast()
  const today = getTodayLocalYmd()
  const minDate = shiftYmd(today, -7)
  const [accountKey, setAccountKey] = useState('')
  const [drafts, setDrafts] = useState<Record<string, Draft>>({})
  const [tradeDate, setTradeDate] = useState(today)
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState<Record<string, { ok: boolean; error?: string }>>({})
  const [notice, setNotice] = useState<string | null>(null)
  const busyRef = useRef(false)

  const folder = accountFolders.find((f) => f.key === (accountKey || (accountFolders.some((x) => x.key === defaultAccountKey) ? defaultAccountKey : ''))) ?? null
  const label = (f: AccountFolder) => displayAccountName(aliases, f.key, f.brokerName, f.accountName)

  const holdings = useMemo(
    () => (folder ? holdingAll.filter((r) => holdingAccountKey(r) === folder.key && r.code && Number(r.quantity) > 0) : []),
    [holdingAll, folder],
  )

  const results = useMemo(() => {
    const map: Record<string, ReconcileResult> = {}
    for (const r of holdings) {
      const d = drafts[String(r.code)]
      map[String(r.code)] = reconcileHolding(
        { quantity: Number(r.quantity), investedAmount: r.invested_amount ?? null, avgPrice: Number(r.avg_price ?? r.buy_price ?? 0) },
        toNum(d?.qty),
        toNum(d?.avg),
        r.stock?.close ?? null,
      )
    }
    return map
  }, [holdings, drafts])

  const ready = holdings.filter((r) => {
    const res = results[String(r.code)]
    return res.kind === 'buy' && !done[String(r.code)]?.ok && !res.warnings.some((w) => w.includes('거절'))
  })
  const totalCash = ready.reduce((s, r) => {
    const res = results[String(r.code)]
    return s + (res.kind === 'buy' ? res.addAmount : 0)
  }, 0)

  const setDraft = (code: string, p: Partial<Draft>) => setDrafts((m) => ({ ...m, [code]: { ...(m[code] ?? { qty: '', avg: '' }), ...p } }))

  const save = async () => {
    if (busyRef.current || !folder || ready.length === 0) return
    busyRef.current = true
    setSaving(true)
    setNotice(null)
    let okCount = 0
    let firstCash: number | null = null
    let lastCash: number | null = null
    try {
      for (const r of ready) {
        const code = String(r.code)
        const res = results[code]
        if (res.kind !== 'buy') continue
        try {
          const json = await apiFetch('/api/ui/virtual-trade', {
            method: 'POST',
            cacheMs: 0,
            timeoutMs: 12_000,
            body: JSON.stringify({
              code,
              side: 'BUY',
              quantity: res.addQty,
              price: res.unitPrice,
              memo: BULK_ESTIMATE_MEMO,
              broker_name: folder.brokerName.trim() || null,
              account_name: folder.accountName.trim() || null,
              ...(tradeDate < today ? { trade_date: tradeDate } : {}),
            }),
          })
          if (json?.error) throw new Error(String(json.error))
          const adj = json?.cashAdjust as { before: number; after: number } | null | undefined
          if (adj) { if (firstCash == null) firstCash = adj.before; lastCash = adj.after }
          okCount++
          setDone((m) => ({ ...m, [code]: { ok: true } }))
        } catch (e: any) {
          setDone((m) => ({ ...m, [code]: { ok: false, error: String(e?.message || e).slice(0, 160) } }))
        }
      }
    } finally {
      invalidateCache('/api/ui/positions')
      busyRef.current = false
      setSaving(false)
    }
    const failCount = ready.length - okCount
    setNotice(failCount === 0 ? `${okCount}건 기록했습니다.` : `${okCount}건 기록, ${failCount}건은 기록하지 못했습니다. 줄마다 사유를 확인하세요.`)
    toast.show(
      `${okCount}건 기록(모아서 기록·추정)`
        + (firstCash != null && lastCash != null ? ` · 계좌 예수금 ${firstCash.toLocaleString('ko-KR')}원 → ${lastCash.toLocaleString('ko-KR')}원` : ''),
      firstCash != null ? 6000 : 3500,
    )
    await load({ soft: true, force: true })
  }

  const close = () => {
    if (busyRef.current) return
    setDrafts({}); setDone({}); setNotice(null); setAccountKey(''); setTradeDate(today)
    onClose()
  }

  const resultCell = (code: string) => {
    const fin = done[code]
    if (fin?.ok) return <span style={{ color: 'var(--color-success)' }}>기록함</span>
    if (fin?.error) return <span style={{ color: 'var(--color-danger)' }}>{fin.error}</span>
    const res = results[code]
    switch (res.kind) {
      case 'empty': return <span className="muted">-</span>
      case 'same': return <span className="muted">변화 없음</span>
      case 'invalid': return <span style={{ color: 'var(--color-danger)' }}>{res.reason}</span>
      case 'sell': return <span style={{ color: 'var(--color-danger)' }}>수량 {res.lessQty}주 감소 → 매도로 기록해 주세요(매도는 평단이 안 바뀌어 역산할 수 없습니다)</span>
      case 'avgOnly': return <span className="muted">수량은 같고 평단만 {signed(res.gap)} 다릅니다. 수수료 포함 방식 차이일 수 있어 기록하지 않습니다.</span>
      case 'buy': return (
        <div>
          <div>+{res.addQty}주 · 추가분 약 {won(res.unitPrice)} <span className="muted">(±{Math.ceil(res.tolerance).toLocaleString('ko-KR')}원)</span></div>
          <div className="caption muted">이전 평단보다 주당 {signed(res.gapPerShare)} · 합계 약 {won(res.addAmount)}</div>
          {res.warnings.map((w) => <div key={w} className="caption" style={{ color: 'var(--color-danger)' }}>{w}</div>)}
        </div>
      )
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={close} title="수량·평단 맞추기" size="lg" closeOnBackdrop={false}>
      <div style={{ wordBreak: 'keep-all' }}>
        <div className="caption muted" style={{ marginBottom: 'var(--space-3)' }}>
          증권사 앱 보유 화면의 새 수량과 평단만 적으세요. 기록과 다른 종목만 추가 매수 한 건(추정)으로 채웁니다.
          건별로 이미 기록한 거래는 그대로 두고 빠진 부분만 계산합니다.
        </div>

        <div className="ui-field" style={{ marginBottom: 'var(--space-3)' }}>
          <label className="ui-label" htmlFor="reconcile-account">계좌</label>
          <select
            id="reconcile-account"
            className="input"
            value={folder?.key ?? ''}
            onChange={(e) => { setAccountKey(e.target.value); setDrafts({}); setDone({}); setNotice(null) }}
            style={{ width: '100%' }}
          >
            <option value="">계좌 고르기</option>
            {accountFolders.map((f) => <option key={f.key} value={f.key}>{label(f)}</option>)}
          </select>
        </div>

        {notice && <div className="caption" role="status" style={{ marginBottom: 'var(--space-2)' }}>{notice}</div>}

        {folder && holdings.length === 0 && <div className="caption muted">이 계좌에 기록된 보유가 없습니다. 새로 산 종목은 매수 기록이나 캡처로 넣어 주세요.</div>}

        {holdings.length > 0 && (
          <div style={{ overflowX: 'auto', marginBottom: 'var(--space-3)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--color-text-secondary)' }}>
                  <th style={{ padding: '4px 6px' }}>종목</th>
                  <th style={{ padding: '4px 6px' }}>지금 기록</th>
                  <th style={{ padding: '4px 6px', textAlign: 'right' }}>새 수량</th>
                  <th style={{ padding: '4px 6px', textAlign: 'right' }}>새 평단</th>
                  <th style={{ padding: '4px 6px' }}>결과</th>
                </tr>
              </thead>
              <tbody>
                {holdings.map((r) => {
                  const code = String(r.code)
                  const d = drafts[code]
                  const locked = !!done[code]?.ok || saving
                  const prevAvg = r.invested_amount && r.quantity ? Number(r.invested_amount) / Number(r.quantity) : Number(r.avg_price ?? r.buy_price ?? 0)
                  return (
                    <tr key={code} style={{ borderTop: '1px solid var(--color-border)', verticalAlign: 'top' }}>
                      <td style={{ padding: '6px' }}><strong>{r.stock_name ?? code}</strong> <span className="muted">{code}</span></td>
                      <td style={{ padding: '6px', whiteSpace: 'nowrap' }}>{Number(r.quantity).toLocaleString('ko-KR')}주 · {won(prevAvg)}</td>
                      <td style={{ padding: '6px', textAlign: 'right' }}>
                        <input
                          type="number" inputMode="numeric" className="input" aria-label={`${r.stock_name ?? code} 새 수량`}
                          value={d?.qty ?? ''} disabled={locked}
                          onChange={(e) => setDraft(code, { qty: e.target.value })}
                          style={{ width: 72, textAlign: 'right' }}
                        />
                      </td>
                      <td style={{ padding: '6px', textAlign: 'right' }}>
                        <input
                          type="number" inputMode="decimal" className="input" aria-label={`${r.stock_name ?? code} 새 평단`}
                          value={d?.avg ?? ''} disabled={locked}
                          onChange={(e) => setDraft(code, { avg: e.target.value })}
                          style={{ width: 96, textAlign: 'right' }}
                        />
                      </td>
                      <td style={{ padding: '6px' }}>{resultCell(code)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {holdings.length > 0 && (
          <>
            <div className="ui-field" style={{ marginBottom: 'var(--space-2)' }}>
              <label className="ui-label" htmlFor="reconcile-date">체결일 (기본 오늘 · 최근 7일까지)</label>
              <input
                id="reconcile-date" type="date" className="input" value={tradeDate} min={minDate} max={today}
                onChange={(e) => setTradeDate(e.target.value && e.target.value >= minDate && e.target.value <= today ? e.target.value : today)}
                disabled={saving}
              />
            </div>
            <div className="caption muted" style={{ marginBottom: 'var(--space-2)' }}>
              모아서 기록한 추정 매수로 표시됩니다. 증권사 평단에 수수료가 들어 있으면 추가분 단가에 약 0.015%가 섞일 수 있습니다.
              {ready.length > 0 && <> 선택 {ready.length}건 합계 약 {won(totalCash)} — 예수금을 적어 둔 계좌는 그만큼 줄어듭니다.</>}
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <Button variant="primary" onClick={save} disabled={saving || ready.length === 0 || !folder}>
                {saving ? '기록 중…' : `${ready.length}건 기록`}
              </Button>
              <Button variant="ghost" onClick={close} disabled={saving}>닫기</Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
