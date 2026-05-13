import React, { useCallback, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { formatKrw } from '../../lib/format'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import Modal from '../../components/Modal'
import { useToast } from '../../components/ToastProvider'
import type { MaintenanceResult, PositionRow } from '../../lib/types'
import { getCurrentChatIdFromStore } from '../../stores/profileStore'

type OpMode = 'idle' | 'loading' | 'done' | 'error'

type HoldingEditForm = {
  code: string
  buyPrice: string
  quantity: string
}

type RestoreForm = {
  code: string
  buyPrice: string
  quantity: string
}

async function callMaintenance(body: Record<string, unknown>): Promise<MaintenanceResult> {
  const chatId = getCurrentChatIdFromStore()
  const result = await apiFetch('/api/ui/positions-maintenance', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(chatId ? { 'x-user-chat-id': chatId } : {}) },
    body: JSON.stringify(body),
    cacheMs: 0,
  })
  return result as MaintenanceResult
}

// ── 관심 목록 초기화 ───────────────────────────────────────
function WatchResetCard() {
  const toast = useToast()
  const [status, setStatus] = useState<OpMode>('idle')
  const [removed, setRemoved] = useState<number | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const handleReset = useCallback(async () => {
    setConfirmOpen(false)
    setStatus('loading')
    try {
      const res = await callMaintenance({ mode: 'watchreset' })
      if (!res.ok) throw new Error(res.error || '초기화 실패')
      setRemoved(res.removed ?? 0)
      setStatus('done')
      toast.show(`관심 목록 초기화 완료 (${res.removed ?? 0}건 제거)`)
    } catch (e: unknown) {
      setStatus('error')
      toast.show(`오류: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [toast])

  return (
    <section className="card" style={{ marginBottom: 'var(--space-4)' }}>
      <h2 className="title-md" style={{ marginBottom: 'var(--space-2)' }}>관심 목록 초기화</h2>
      <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
        수량 0 또는 interest/watch 상태인 포지션을 일괄 삭제합니다.
      </p>
      {status === 'done' && (
        <p style={{ color: 'var(--color-success)', fontSize: 13, marginBottom: 'var(--space-3)' }}>
          ✓ {removed}건 제거 완료
        </p>
      )}
      <Button
        variant="danger"
        loading={status === 'loading'}
        onClick={() => setConfirmOpen(true)}
        disabled={status === 'loading'}
      >
        관심 목록 초기화
      </Button>

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="초기화 확인">
        <p style={{ marginBottom: 'var(--space-4)' }}>
          관심/감시 상태 포지션을 모두 삭제합니다. 실보유 종목은 영향받지 않습니다.
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={() => setConfirmOpen(false)}>취소</Button>
          <Button variant="danger" onClick={handleReset}>확인, 초기화</Button>
        </div>
      </Modal>
    </section>
  )
}

// ── 보유 단가·수량 수정 ────────────────────────────────────
function HoldingEditCard() {
  const toast = useToast()
  const [form, setForm] = useState<HoldingEditForm>({ code: '', buyPrice: '', quantity: '1' })
  const [status, setStatus] = useState<OpMode>('idle')
  const [result, setResult] = useState<PositionRow | null>(null)

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    const code = form.code.trim().toUpperCase()
    const buyPrice = Number(form.buyPrice)
    const quantity = Math.trunc(Number(form.quantity))
    if (!code) return toast.show('종목코드를 입력하세요')
    if (!buyPrice || buyPrice <= 0) return toast.show('매수단가를 올바르게 입력하세요')
    if (!quantity || quantity <= 0) return toast.show('수량은 1 이상이어야 합니다')

    setStatus('loading')
    setResult(null)
    try {
      const res = await callMaintenance({ mode: 'holdingedit', code, buy_price: buyPrice, quantity })
      if (!res.ok) throw new Error(res.error || '수정 실패')
      setResult(res.data ?? null)
      setStatus('done')
      toast.show(`${code} 보유 정보 수정 완료`)
      setForm({ code: '', buyPrice: '', quantity: '1' })
    } catch (e: unknown) {
      setStatus('error')
      toast.show(`오류: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [form, toast])

  return (
    <section className="card" style={{ marginBottom: 'var(--space-4)' }}>
      <h2 className="title-md" style={{ marginBottom: 'var(--space-2)' }}>보유 단가·수량 수정</h2>
      <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
        실수로 잘못 입력한 매수단가·수량을 수정합니다. 기존 롯은 재생성됩니다.
      </p>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <Input
          label="종목코드"
          placeholder="예) 005930"
          value={form.code}
          onChange={(e) => setForm((s) => ({ ...s, code: e.target.value }))}
        />
        <Input
          label="매수단가 (원)"
          type="number"
          placeholder="예) 73000"
          value={form.buyPrice}
          onChange={(e) => setForm((s) => ({ ...s, buyPrice: e.target.value }))}
        />
        <Input
          label="수량"
          type="number"
          min={1}
          step={1}
          placeholder="예) 10"
          value={form.quantity}
          onChange={(e) => setForm((s) => ({ ...s, quantity: e.target.value }))}
        />
        <Button type="submit" loading={status === 'loading'} disabled={status === 'loading'}>
          수정 저장
        </Button>
      </form>
      {status === 'done' && result && (
        <div style={{ marginTop: 'var(--space-3)', padding: 'var(--space-3)', background: 'var(--color-success-bg)', borderRadius: 8 }}>
          <p style={{ color: 'var(--color-success)', fontSize: 13 }}>
            ✓ {result.code} — 단가 {formatKrw(result.buy_price)} × {result.quantity}주
          </p>
        </div>
      )}
    </section>
  )
}

// ── 누락 보유 복구 ─────────────────────────────────────────
function HoldingRestoreCard() {
  const toast = useToast()
  const [form, setForm] = useState<RestoreForm>({ code: '', buyPrice: '', quantity: '1' })
  const [status, setStatus] = useState<OpMode>('idle')

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    const code = form.code.trim().toUpperCase()
    const buyPrice = Number(form.buyPrice)
    const quantity = Math.trunc(Number(form.quantity))
    if (!code) return toast.show('종목코드를 입력하세요')
    if (!buyPrice || buyPrice <= 0) return toast.show('매수단가를 올바르게 입력하세요')
    if (!quantity || quantity <= 0) return toast.show('수량은 1 이상이어야 합니다')

    setStatus('loading')
    try {
      const res = await callMaintenance({ mode: 'holdingrestore', code, buy_price: buyPrice, quantity })
      if (!res.ok) throw new Error(res.error || '복구 실패')
      setStatus('done')
      toast.show(`${code} 보유 복구 완료`)
      setForm({ code: '', buyPrice: '', quantity: '1' })
    } catch (e: unknown) {
      setStatus('error')
      toast.show(`오류: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [form, toast])

  return (
    <section className="card" style={{ marginBottom: 'var(--space-4)' }}>
      <h2 className="title-md" style={{ marginBottom: 'var(--space-2)' }}>누락 보유 복구</h2>
      <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
        포트폴리오에서 누락된 종목을 수동으로 복구합니다. 종목이 없으면 신규 생성합니다.
      </p>
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <Input
          label="종목코드"
          placeholder="예) 005930"
          value={form.code}
          onChange={(e) => setForm((s) => ({ ...s, code: e.target.value }))}
        />
        <Input
          label="매수단가 (원)"
          type="number"
          placeholder="예) 73000"
          value={form.buyPrice}
          onChange={(e) => setForm((s) => ({ ...s, buyPrice: e.target.value }))}
        />
        <Input
          label="수량"
          type="number"
          min={1}
          step={1}
          placeholder="예) 10"
          value={form.quantity}
          onChange={(e) => setForm((s) => ({ ...s, quantity: e.target.value }))}
        />
        <Button type="submit" loading={status === 'loading'} disabled={status === 'loading'}>
          복구 실행
        </Button>
      </form>
      {status === 'done' && (
        <p style={{ marginTop: 'var(--space-2)', color: 'var(--color-success)', fontSize: 13 }}>✓ 복구 완료</p>
      )}
    </section>
  )
}

// ── 전체 매도 ──────────────────────────────────────────────
function LiquidateAllCard() {
  const toast = useToast()
  const [status, setStatus] = useState<OpMode>('idle')
  const [soldCount, setSoldCount] = useState<number | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const handleLiquidate = useCallback(async () => {
    setConfirmOpen(false)
    setStatus('loading')
    try {
      const res = await callMaintenance({ mode: 'liquidateall' })
      if (!res.ok) throw new Error(res.error || '전체매도 실패')
      setSoldCount(res.soldCount ?? 0)
      setStatus('done')
      toast.show(`전체 매도 완료 (${res.soldCount ?? 0}건)`)
    } catch (e: unknown) {
      setStatus('error')
      toast.show(`오류: ${e instanceof Error ? e.message : String(e)}`)
    }
  }, [toast])

  return (
    <section className="card" style={{ marginBottom: 'var(--space-4)', borderColor: 'var(--color-error)' }}>
      <h2 className="title-md" style={{ marginBottom: 'var(--space-2)', color: 'var(--color-error)' }}>전체 매도</h2>
      <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 'var(--space-4)' }}>
        보유 중인 모든 종목을 현재가(또는 매수가) 기준으로 일괄 매도 처리합니다.
        <br />
        <strong style={{ color: 'var(--color-error)' }}>이 작업은 되돌릴 수 없습니다.</strong>
      </p>
      {status === 'done' && (
        <p style={{ color: 'var(--color-success)', fontSize: 13, marginBottom: 'var(--space-3)' }}>
          ✓ {soldCount}건 전체 매도 완료
        </p>
      )}
      <Button
        variant="danger"
        loading={status === 'loading'}
        onClick={() => setConfirmOpen(true)}
        disabled={status === 'loading'}
      >
        전체 매도 실행
      </Button>

      <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title="전체 매도 확인">
        <p style={{ marginBottom: 'var(--space-2)' }}>
          보유한 <strong>모든 종목</strong>을 현재가 기준으로 매도합니다.
        </p>
        <p style={{ marginBottom: 'var(--space-4)', color: 'var(--color-error)', fontSize: 13 }}>
          이 작업은 되돌릴 수 없습니다. 정말 실행하시겠습니까?
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={() => setConfirmOpen(false)}>취소</Button>
          <Button variant="danger" onClick={handleLiquidate}>확인, 전체 매도</Button>
        </div>
      </Modal>
    </section>
  )
}

// ── 메인 페이지 ────────────────────────────────────────────
export default function PositionMaintenancePage() {
  return (
    <div style={{ maxWidth: 600, margin: '0 auto', padding: 'var(--space-6) var(--space-4)' }}>
      <h1 className="title-xl" style={{ marginBottom: 'var(--space-2)' }}>포지션 유지보수</h1>
      <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 'var(--space-6)' }}>
        텔레그램에서만 가능하던 포지션 수정·초기화·매도 기능을 웹에서 직접 실행합니다.
      </p>

      <WatchResetCard />
      <HoldingEditCard />
      <HoldingRestoreCard />
      <LiquidateAllCard />
    </div>
  )
}
