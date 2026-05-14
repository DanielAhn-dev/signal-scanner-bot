import React, { useCallback, useState, useEffect } from 'react'
import { apiFetch } from '../../lib/api'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import { useToast } from '../../components/ToastProvider'
import type { VirtualPosition } from '../../lib/types'
import { formatKrw, formatPercent } from '../../lib/format'
import { getCurrentChatIdFromStore } from '../../stores/profileStore'

interface PositionWithRules extends VirtualPosition {
  stop_loss_percent?: number
  take_profit_targets?: Array<{ target: number; percentage: number }>
  auto_trading_enabled?: boolean
}

export default function StopLossTakeProfitPage() {
  const toast = useToast()
  const [positions, setPositions] = useState<PositionWithRules[]>([])
  const [loading, setLoading] = useState(false)
  const [editingCode, setEditingCode] = useState<string | null>(null)

  const [stopLoss, setStopLoss] = useState<string>('-5')
  const [takeProfitTargets, setTakeProfitTargets] = useState<string>('5:50|10:100')

  // 포지션 로드
  const loadPositions = useCallback(async () => {
    setLoading(true)
    try {
      const chatId = getCurrentChatIdFromStore()
      const data = await apiFetch('/api/ui/positions', {
        method: 'GET',
        headers: chatId ? { 'x-user-chat-id': chatId } : {},
      })
      setPositions(Array.isArray(data?.positions) ? data.positions : [])
    } catch (e) {
      toast.show(`오류: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    loadPositions()
  }, [loadPositions])

  // 손절/익절 저장
  const handleSaveRules = useCallback(
    async (code: string) => {
      const slPercent = Number(stopLoss)
      const targets = takeProfitTargets
        .split('|')
        .map((t) => {
          const [target, pct] = t.trim().split(':').map(Number)
          return { target, percentage: pct }
        })
        .filter((t) => !isNaN(t.target) && !isNaN(t.percentage))

      if (isNaN(slPercent)) {
        return toast.show('손절율을 올바르게 입력하세요')
      }

      setLoading(true)
      try {
        const chatId = getCurrentChatIdFromStore()
        const response = await apiFetch('/api/ui/stop-loss-take-profit', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(chatId ? { 'x-user-chat-id': chatId } : {}),
          },
          body: JSON.stringify({
            code,
            stop_loss_percent: slPercent,
            take_profit_targets: targets,
            auto_trading_enabled: true,
          }),
          cacheMs: 0,
        })

        if (response.ok) {
          toast.show(`✅ ${code} 손절/익절 설정 완료`)
          setEditingCode(null)
          await loadPositions()
        } else {
          toast.show(`❌ ${response.error || '설정 실패'}`)
        }
      } catch (e) {
        toast.show(`오류: ${e instanceof Error ? e.message : String(e)}`)
      } finally {
        setLoading(false)
      }
    },
    [stopLoss, takeProfitTargets, toast, loadPositions]
  )

  // 자동 매매 토글
  const handleToggleAutoTrading = useCallback(
    async (code: string, enabled: boolean) => {
      setLoading(true)
      try {
        const chatId = getCurrentChatIdFromStore()
        const response = await apiFetch('/api/ui/stop-loss-take-profit', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(chatId ? { 'x-user-chat-id': chatId } : {}),
          },
          body: JSON.stringify({
            code,
            auto_trading_enabled: !enabled,
          }),
          cacheMs: 0,
        })

        if (response.ok) {
          await loadPositions()
        } else {
          toast.show(`❌ 설정 실패`)
        }
      } catch (e) {
        toast.show(`오류: ${e instanceof Error ? e.message : String(e)}`)
      } finally {
        setLoading(false)
      }
    },
    [toast, loadPositions]
  )

  const activePositions = positions.filter(
    (p) => Number(p.quantity || 0) > 0 && p.status !== 'interest'
  )

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 'var(--space-6) var(--space-4)' }}>
      <h1 className="title-xl" style={{ marginBottom: 'var(--space-2)' }}>
        손절/익절 자동화
      </h1>
      <p style={{ fontSize: 14, color: 'var(--color-text-secondary)', marginBottom: 'var(--space-6)' }}>
        각 종목의 손절선과 익절 목표를 설정하여 자동으로 청산합니다.
      </p>

      {activePositions.length === 0 ? (
        <div className="state-empty">
          <div className="state-empty-icon">📭</div>
          <div className="state-empty-title">보유 중인 종목이 없습니다</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
          {activePositions.map((pos) => (
            <section
              key={pos.id}
              className="card"
              style={{ padding: 'var(--space-4)', borderLeft: '4px solid var(--color-brand)' }}
            >
              {/* 헤더 */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
                <div>
                  <h3 className="title-md" style={{ marginBottom: 'var(--space-1)' }}>
                    {pos.code}
                  </h3>
                  <p style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                    {pos.quantity}주 @ {formatKrw(pos.buy_price || 0)}
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <Button
                    variant={pos.auto_trading_enabled ? 'primary' : 'ghost'}
                    onClick={() => handleToggleAutoTrading(pos.code, pos.auto_trading_enabled)}
                    disabled={loading}
                    style={{ minWidth: 'auto' }}
                  >
                    {pos.auto_trading_enabled ? '✅ 활성' : '⛔ 비활성'}
                  </Button>
                </div>
              </div>

              {/* 현재 설정 표시 */}
              {editingCode !== pos.code && (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 'var(--space-3)',
                    marginBottom: 'var(--space-4)',
                    padding: 'var(--space-3)',
                    background: 'var(--color-bg-sunken)',
                    borderRadius: 8,
                  }}
                >
                  <div>
                    <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>손절선</p>
                    <p style={{ fontSize: 16, fontWeight: 'bold', marginTop: 4 }}>
                      {pos.stop_loss_percent !== undefined && pos.stop_loss_percent !== null
                        ? `${pos.stop_loss_percent}%`
                        : '설정 안 됨'}
                    </p>
                  </div>
                  <div>
                    <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>익절 목표</p>
                    {pos.take_profit_targets && Array.isArray(pos.take_profit_targets) && pos.take_profit_targets.length > 0 ? (
                      <div style={{ marginTop: 4 }}>
                        {pos.take_profit_targets.map((t, i) => (
                          <p key={i} style={{ fontSize: 12, margin: '2px 0' }}>
                            +{t.target}% → {t.percentage}%
                          </p>
                        ))}
                      </div>
                    ) : (
                      <p style={{ fontSize: 16, fontWeight: 'bold', marginTop: 4 }}>설정 안 됨</p>
                    )}
                  </div>
                </div>
              )}

              {/* 편집 폼 */}
              {editingCode === pos.code ? (
                <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
                  <Input
                    label="손절 기준 (%)"
                    type="number"
                    placeholder="예) -5"
                    value={stopLoss}
                    onChange={(e) => setStopLoss(e.target.value)}
                  />

                  <div>
                    <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text-secondary)', display: 'block', marginBottom: 8 }}>
                      익절 목표 (대상:비율)
                    </label>
                    <Input
                      placeholder="예) 5:50|10:100"
                      value={takeProfitTargets}
                      onChange={(e) => setTakeProfitTargets(e.target.value)}
                    />
                    <p style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginTop: 4 }}>
                      형식: 5:50은 "+5% 도달 시 50% 매도"를 의미합니다. 파이프(|)로 여러 목표를 연결하세요.
                    </p>
                  </div>

                  <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end' }}>
                    <Button variant="ghost" onClick={() => setEditingCode(null)} disabled={loading}>
                      취소
                    </Button>
                    <Button
                      onClick={() => handleSaveRules(pos.code)}
                      loading={loading}
                      disabled={loading}
                    >
                      저장
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="secondary" onClick={() => setEditingCode(pos.code)} disabled={loading} style={{ width: '100%' }}>
                  설정 수정
                </Button>
              )}
            </section>
          ))}
        </div>
      )}

      {/* 도움말 */}
      <div
        style={{
          marginTop: 'var(--space-8)',
          padding: 'var(--space-4)',
          background: 'var(--color-info-bg)',
          border: '1px solid var(--color-border-info)',
          borderRadius: 8,
        }}
      >
        <h3 style={{ marginBottom: 'var(--space-2)', color: 'var(--color-info)', fontWeight: 'bold' }}>
          💡 사용 방법
        </h3>
        <ul style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: 0, paddingLeft: 'var(--space-4)' }}>
          <li style={{ marginBottom: 'var(--space-2)' }}>
            <strong>손절</strong>: 손실이 설정값에 도달하면 자동으로 전량 매도 (예: -5%에 도달하면 팜)
          </li>
          <li style={{ marginBottom: 'var(--space-2)' }}>
            <strong>익절</strong>: 수익이 목표에 도달하면 해당 비율만큼 자동 매도
          </li>
          <li style={{ marginBottom: 'var(--space-2)' }}>
            <strong>시간 익절</strong>: 28일 이상 보유하면 자동 전량 매도
          </li>
          <li>
            <strong>활성화</strong>: "✅ 활성" 상태에서만 자동 손절/익절이 작동합니다
          </li>
        </ul>
      </div>
    </div>
  )
}
