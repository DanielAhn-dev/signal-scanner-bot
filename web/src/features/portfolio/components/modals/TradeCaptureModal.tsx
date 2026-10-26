import { useMemo, useRef, useState } from 'react'
import Modal from '../../../../components/Modal'
import Button from '../../../../components/ui/Button'
import { useToast } from '../../../../components/ToastProvider'
import { apiFetch, invalidateCache } from '../../../../lib/api'
import { getStocks } from '../../../../lib/stockCache'
import { assembleCaptureText, parseTradeCapture, validateCapturedTrade, type CapturedTrade } from '../../../../lib/tradeCapture'
import { displayAccountName, type AccountAliases } from '../../lib/accountAliases'
import { holdingAccountKey } from '../../lib/accountKey'
import { getTodayLocalYmd, toKstYmd } from '../../lib/dates'
import { ocrCapture } from '../../lib/ocrImage'
import type { AccountFolder, HoldingRow } from '../../types'

type Row = CapturedTrade & {
  key: string
  selected: boolean
  /** 같은 계좌에 같은 날·수량·가격의 매수 로트가 이미 있음 */
  recorded: boolean
  result?: { ok: boolean; error?: string }
}

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

/**
 * 증권사 주문내역 캡처 → 매수·매도 기록. OCR은 브라우저 안에서(무료), 읽은 결과는 반드시 확인 표를 거쳐 기록한다.
 * 기록은 "보유 복원"이 아니라 매수·매도 API를 오래된 체결부터 한 건씩 호출한다(평단·로트·예수금이 정상 경로로 갱신).
 */
export default function TradeCaptureModal({ isOpen, onClose, accountFolders, aliases, holdingAll, defaultAccountKey, load }: Props) {
  const toast = useToast()
  const today = getTodayLocalYmd()
  const [accountKey, setAccountKey] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [text, setText] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [skipped, setSkipped] = useState(0)
  const [status, setStatus] = useState<string | null>(null)
  const [reading, setReading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const busyRef = useRef(false)

  const folder = accountFolders.find((f) => f.key === (accountKey || (accountFolders.some((x) => x.key === defaultAccountKey) ? defaultAccountKey : ''))) ?? null
  const label = (f: AccountFolder) => displayAccountName(aliases, f.key, f.brokerName, f.accountName)

  const isRecorded = (t: CapturedTrade, f: AccountFolder | null): boolean => {
    if (!f || t.side !== 'BUY' || !t.code) return false
    const day = t.date ?? today
    return holdingAll.some((r) => holdingAccountKey(r) === f.key && r.code === t.code
      && (r.lots ?? []).some((l) => toKstYmd(l.acquired_at) === day && l.acquired_quantity === t.quantity && l.acquired_price === t.price))
  }

  const interpret = async (source: string, f: AccountFolder | null) => {
    const stocks = await getStocks()
    if (stocks.length === 0) { setNotice('종목 목록을 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.'); return }
    // 고른 계좌에 이미 있는 종목을 후보 위쪽에 — 긴 ETF 이름은 OCR이 뒤쪽을 못 읽어 이름만으로는 못 정한다
    const heldCodes = new Set(holdingAll.filter((r) => f && holdingAccountKey(r) === f.key && r.code).map((r) => String(r.code)))
    const parsed = parseTradeCapture(source, stocks, today, { heldCodes })
    setSkipped(parsed.skipped)
    setRows(parsed.trades.map((t, i) => {
      const recorded = isRecorded(t, f)
      return { ...t, key: `${Date.now()}-${i}`, recorded, selected: !t.error && !recorded && (t.date ?? today) === today }
    }))
    if (parsed.trades.length === 0) setNotice('체결 완료 내역을 찾지 못했습니다. 주문내역 화면을 글자가 선명하게 다시 캡처해 주세요.')
  }

  const read = async () => {
    if (busyRef.current || files.length === 0) return
    busyRef.current = true
    setReading(true)
    setNotice(null)
    setRows([])
    try {
      const blocks = await ocrCapture(files, setStatus)
      const stocks = await getStocks()
      const assembled = assembleCaptureText(blocks, stocks)
      setText(assembled)
      await interpret(assembled, folder)
    } catch (e: any) {
      setNotice(`캡처를 읽지 못했습니다: ${String(e?.message || e)}`)
    } finally {
      busyRef.current = false
      setReading(false)
      setStatus(null)
    }
  }

  const reinterpret = async () => {
    if (busyRef.current || !text.trim()) return
    setNotice(null)
    await interpret(text, folder)
  }

  const patch = (key: string, p: Partial<Row>) => setRows((list) => list.map((r) => {
    if (r.key !== key) return r
    const next = { ...r, ...p }
    // 종목·수량·가격을 고치면 오류 문구와 이미 기록됨 표시를 다시 계산한다
    if (next.code && ('code' in p || 'quantity' in p || 'price' in p)) {
      next.error = validateCapturedTrade(next, today)
      next.recorded = isRecorded(next, folder)
    }
    return next
  }))

  const pickCandidate = (key: string, code: string) => setRows((list) => list.map((r) => {
    if (r.key !== key) return r
    const c = r.candidates.find((x) => x.code === code)
    if (!c) return r
    const next = { ...r, code: c.code, name: c.name }
    return { ...next, error: validateCapturedTrade(next, today), recorded: isRecorded(next, folder) }
  }))

  const reverseOrder = () => setRows((list) => [...list].reverse())

  const pending = rows.filter((r) => !r.result?.ok)
  const ready = pending.filter((r) => r.selected && r.code && !r.error)
  const needAttention = pending.filter((r) => r.selected && (!r.code || r.error)).length

  const save = async () => {
    if (busyRef.current || !folder || ready.length === 0) return
    busyRef.current = true
    setSaving(true)
    setNotice(null)
    let okCount = 0
    let firstCash: number | null = null
    let lastCash: number | null = null
    try {
      // 오래된 체결부터 한 건씩 — 로트 선입선출 순서가 실제 체결 순서와 같아진다
      for (const r of ready) {
        try {
          const json = await apiFetch('/api/ui/virtual-trade', {
            method: 'POST',
            cacheMs: 0,
            timeoutMs: 12_000,
            body: JSON.stringify({
              code: r.code,
              side: r.side,
              quantity: r.quantity,
              price: r.price,
              broker_name: folder.brokerName.trim() || null,
              account_name: folder.accountName.trim() || null,
              ...(r.date && r.date < today ? { trade_date: r.date } : {}),
            }),
          })
          if (json?.error) throw new Error(String(json.error))
          const adj = json?.cashAdjust as { before: number; after: number } | null | undefined
          if (adj) { if (firstCash == null) firstCash = adj.before; lastCash = adj.after }
          okCount++
          setRows((list) => list.map((x) => (x.key === r.key ? { ...x, result: { ok: true } } : x)))
        } catch (e: any) {
          setRows((list) => list.map((x) => (x.key === r.key ? { ...x, result: { ok: false, error: String(e?.message || e).slice(0, 160) } } : x)))
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
      `${okCount}건 기록`
        + (firstCash != null && lastCash != null ? ` · 계좌 예수금 ${firstCash.toLocaleString('ko-KR')}원 → ${lastCash.toLocaleString('ko-KR')}원` : ''),
      firstCash != null ? 6000 : 3500,
    )
    await load({ soft: true, force: true })
  }

  // 닫으면 읽은 내용을 비운다 — 다시 열었을 때 이미 기록한 줄이 남아 헷갈리지 않게
  const close = () => {
    if (busyRef.current) return
    setFiles([]); setText(''); setRows([]); setSkipped(0); setNotice(null); setAccountKey('')
    onClose()
  }

  const sideLabel = (s: Row['side']) => (s === 'BUY' ? '매수' : s === 'SELL' ? '매도' : '-')
  const summary = useMemo(() => {
    const net = ready.reduce((s, r) => s + (r.side === 'BUY' ? -1 : 1) * (r.quantity ?? 0) * (r.price ?? 0), 0)
    return net
  }, [ready])

  return (
    <Modal isOpen={isOpen} onClose={close} title="캡처로 매매 기록" size="lg" closeOnBackdrop={false}>
      <div style={{ wordBreak: 'keep-all' }}>
        <div className="ui-field" style={{ marginBottom: 'var(--space-3)' }}>
          <label className="ui-label" htmlFor="capture-account">기록할 계좌 (먼저 고르세요)</label>
          <select
            id="capture-account"
            className="input"
            value={folder?.key ?? ''}
            onChange={(e) => setAccountKey(e.target.value)}
            style={{ width: '100%' }}
          >
            <option value="">계좌 고르기</option>
            {accountFolders.map((f) => <option key={f.key} value={f.key}>{label(f)}</option>)}
          </select>
        </div>

        <div className="ui-field" style={{ marginBottom: 'var(--space-2)' }}>
          <label className="ui-label" htmlFor="capture-files">증권사 주문내역 캡처 (여러 장이면 위쪽 화면부터)</label>
          <input
            id="capture-files"
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => { setFiles(Array.from(e.target.files ?? [])); setRows([]); setNotice(null) }}
          />
          <div className="caption muted" style={{ marginTop: 'var(--space-1)' }}>
            글자 인식은 이 기기 안에서 하고 이미지는 서버로 보내지 않습니다(무료). 처음 한 번은 한글 데이터를 내려받느라 조금 걸립니다.
            화면이 겹치지 않게 캡처하세요. 같은 줄이 두 번 찍히면 두 건으로 읽습니다.
          </div>
        </div>
        <div style={{ marginBottom: 'var(--space-3)' }}>
          <Button variant="secondary" onClick={read} disabled={reading || saving || files.length === 0 || !folder}>
            {reading ? (status ?? '읽는 중…') : '읽기'}
          </Button>
          {!folder && files.length > 0 && <span className="caption muted" style={{ marginLeft: 'var(--space-2)' }}>계좌를 먼저 고르세요.</span>}
        </div>

        {notice && <div className="caption" role="status" style={{ marginBottom: 'var(--space-2)' }}>{notice}</div>}

        {rows.length > 0 && (
          <div aria-label="기록 전 확인" style={{ marginBottom: 'var(--space-3)' }}>
            <div className="caption muted" style={{ marginBottom: 'var(--space-1)' }}>
              체결 {rows.length}건{skipped > 0 ? ` (취소·미체결 ${skipped}건은 뺐습니다)` : ''} · 오래된 체결부터 한 건씩 기록합니다.
              글자 인식이 틀릴 수 있으니 증권사 앱과 종목·수량·가격을 꼭 대조하세요.
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--color-text-secondary)' }}>
                    <th style={{ padding: '4px 6px' }}>기록</th>
                    <th style={{ padding: '4px 6px' }}>종목</th>
                    <th style={{ padding: '4px 6px' }}>구분</th>
                    <th style={{ padding: '4px 6px', textAlign: 'right' }}>수량</th>
                    <th style={{ padding: '4px 6px', textAlign: 'right' }}>체결가</th>
                    <th style={{ padding: '4px 6px' }}>체결일</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} style={{ borderTop: '1px solid var(--color-border)', verticalAlign: 'top' }}>
                      <td style={{ padding: '6px' }}>
                        <input
                          type="checkbox"
                          aria-label={`${r.name ?? r.input} 기록`}
                          checked={r.selected && !r.result?.ok}
                          disabled={!!r.result?.ok || saving}
                          onChange={(e) => patch(r.key, { selected: e.target.checked })}
                        />
                      </td>
                      <td style={{ padding: '6px' }}>
                        {r.code ? <><strong>{r.name}</strong> <span className="muted">{r.code}</span></> : <span className="muted">{r.input || '(이름 못 읽음)'}</span>}
                        {!r.code && r.candidates.length > 0 && (
                          <select className="input" style={{ display: 'block', marginTop: 4 }} value="" onChange={(e) => pickCandidate(r.key, e.target.value)} aria-label={`${r.input} 종목 고르기`}>
                            <option value="">종목 고르기</option>
                            {r.candidates.map((c) => <option key={c.code} value={c.code}>{c.name} ({c.code})</option>)}
                          </select>
                        )}
                        {r.result?.ok ? (
                          <div className="caption" style={{ color: 'var(--color-success)' }}>기록함</div>
                        ) : r.result?.error ? (
                          <div className="caption" style={{ color: 'var(--color-danger)' }}>{r.result.error}</div>
                        ) : r.error ? (
                          <div className="caption" style={{ color: 'var(--color-danger)' }}>{r.error}</div>
                        ) : r.recorded ? (
                          <div className="caption muted">같은 날·수량·가격의 매수가 이미 있어 빼 두었습니다. 다른 체결이면 체크하세요.</div>
                        ) : null}
                      </td>
                      <td style={{ padding: '6px', whiteSpace: 'nowrap' }}>{sideLabel(r.side)}</td>
                      <td style={{ padding: '6px', textAlign: 'right' }}>
                        <input
                          type="number"
                          className="input"
                          aria-label="수량"
                          value={r.quantity ?? ''}
                          disabled={!!r.result?.ok || saving}
                          onChange={(e) => patch(r.key, { quantity: e.target.value === '' ? null : Number(e.target.value) })}
                          style={{ width: 64, textAlign: 'right' }}
                        />
                      </td>
                      <td style={{ padding: '6px', textAlign: 'right' }}>
                        <input
                          type="number"
                          className="input"
                          aria-label="체결가"
                          value={r.price ?? ''}
                          disabled={!!r.result?.ok || saving}
                          onChange={(e) => patch(r.key, { price: e.target.value === '' ? null : Number(e.target.value) })}
                          style={{ width: 92, textAlign: 'right' }}
                        />
                      </td>
                      <td style={{ padding: '6px', whiteSpace: 'nowrap' }}>
                        {r.date ?? '오늘'}
                        {r.date && r.date !== today && <div className="caption muted">지난 날짜</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginTop: 'var(--space-2)' }}>
              <Button variant="ghost" size="sm" onClick={reverseOrder} disabled={saving}>순서 뒤집기</Button>
              <span className="caption muted">앱 목록이 최신순이라 자동으로 뒤집어 두었습니다. 반대로 읽혔으면 눌러 주세요.</span>
            </div>
          </div>
        )}

        {text && (
          <details style={{ marginBottom: 'var(--space-3)' }}>
            <summary className="caption muted">읽은 글자 보기·고치기 (건별로 읽어 합친 결과)</summary>
            <textarea
              className="input"
              rows={6}
              value={text}
              onChange={(e) => setText(e.target.value)}
              style={{ width: '100%', fontFamily: 'inherit', resize: 'vertical', marginTop: 'var(--space-1)' }}
            />
            <Button variant="secondary" size="sm" onClick={reinterpret} disabled={reading || saving}>이 글자로 다시 해석</Button>
          </details>
        )}

        {rows.length > 0 && (
          <>
            {needAttention > 0 && (
              <div className="caption muted" style={{ marginBottom: 'var(--space-2)' }}>
                확인이 필요한 {needAttention}건은 기록하지 않습니다. 종목을 고르거나 체크를 해제해 주세요.
              </div>
            )}
            {ready.length > 0 && (
              <div className="caption muted" style={{ marginBottom: 'var(--space-2)' }}>
                선택한 {ready.length}건 합계(수수료 제외): {summary >= 0 ? '+' : '-'}{Math.abs(Math.round(summary)).toLocaleString('ko-KR')}원
                {' '}· 실계좌는 예수금을 적어 둔 계좌만 자동으로 맞춥니다.
              </div>
            )}
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <Button variant="primary" onClick={save} disabled={saving || reading || ready.length === 0 || !folder}>
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
