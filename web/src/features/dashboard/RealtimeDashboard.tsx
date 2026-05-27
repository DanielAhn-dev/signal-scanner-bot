import React, { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../../lib/api'
import { formatKrw, formatPercent } from '../../lib/format'
import Button from '../../components/ui/Button'
import { useToast } from '../../components/ToastProvider'
import { getCurrentChatIdFromStore } from '../../stores/profileStore'

interface PositionWithPrice {
  id: number
  code: string
  quantity: number
  buy_price: number
  invested_amount: number
  current_price?: number
  current_value?: number
  pnl_amount?: number
  pnl_percent?: number
  stop_loss_percent?: number
  take_profit_targets?: Array<{ target: number; percentage: number }>
  auto_trading_enabled?: boolean
  target_horizon?: 'scalp' | 'swing' | 'position' | null
  horizon_reason?: string | null
  planned_review_at?: string | null
  status: string
}

interface PortfolioSummary {
  total_invested: number
  total_current_value: number
  total_pnl: number
  total_pnl_percent: number
  horizon_distribution?: {
    scalp: number
    swing: number
    position: number
    unknown: number
  }
  review_schedule?: {
    due_now: number
    due_soon: number
    due_later: number
  }
  positions: PositionWithPrice[]
  last_updated: string
}

export default function RealtimeDashboard() {
  const toast = useToast()
  const [portfolio, setPortfolio] = useState<PortfolioSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)

  // 포트폴리오 조회
  const loadPortfolio = useCallback(async () => {
    try {
      setLoading(true)
      const chatId = getCurrentChatIdFromStore()
      const data = await apiFetch('/api/ui/portfolio-realtime', {
        method: 'GET',
        headers: chatId ? { 'x-user-chat-id': chatId } : {},
        cacheMs: 0,
      })

      if (data.ok) {
        setPortfolio(data.data)
        setLastUpdate(new Date())
      } else {
        toast.show(`❌ ${data.error || '데이터 조회 실패'}`)
      }
    } catch (e) {
      toast.show(`오류: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setLoading(false)
    }
  }, [toast])

  // 초기 로드
  useEffect(() => {
    loadPortfolio()
  }, [loadPortfolio])

  // 자동 갱신 (1분 주기)
  useEffect(() => {
    if (!autoRefresh) return

    const interval = setInterval(() => {
      loadPortfolio()
    }, 60000) // 60초

    return () => clearInterval(interval)
  }, [autoRefresh, loadPortfolio])

  if (!portfolio) {
    return (
      <div style={{ maxWidth: 1000, margin: '0 auto', padding: 'var(--space-6) var(--space-4)' }}>
        <p style={{ textAlign: 'center', color: 'var(--color-text-secondary)' }}>
          {loading ? '로딩 중...' : '보유 중인 포지션이 없습니다'}
        </p>
      </div>
    )
  }

  const positions = portfolio.positions || []
  const horizon = portfolio.horizon_distribution || {
    scalp: 0,
    swing: 0,
    position: 0,
    unknown: 0,
  }
  const reviewSchedule = portfolio.review_schedule || {
    due_now: 0,
    due_soon: 0,
    due_later: 0,
  }
  const horizonTotal = Math.max(1, positions.length)
  const riskLevel =
    portfolio.total_pnl_percent < -5 ? 'RED' : portfolio.total_pnl_percent < -3 ? 'YELLOW' : 'GREEN'
  const riskEmoji = riskLevel === 'RED' ? '🔴' : riskLevel === 'YELLOW' ? '🟡' : '🟢'

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: 'var(--space-6) var(--space-4)' }}>
      {/* 헤더 */}
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <h1 className="title-xl" style={{ marginBottom: 'var(--space-2)' }}>
          📊 실시간 포트폴리오
        </h1>
        <p style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>
          마지막 업데이트: {lastUpdate?.toLocaleTimeString('ko-KR')}
        </p>
      </div>

      <div
        className="card"
        style={{
          padding: 'var(--space-5)',
          marginBottom: 'var(--space-6)',
          display: 'grid',
          gap: 'var(--space-4)',
        }}
      >
        <h2 className="title-md" style={{ margin: 0 }}>
          보유수평선 분포 / 리뷰 일정
        </h2>

        <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
          {[
            { key: 'scalp', label: '단타', color: 'var(--color-warning)', count: horizon.scalp },
            { key: 'swing', label: '스윙', color: 'var(--color-primary)', count: horizon.swing },
            { key: 'position', label: '중장기', color: 'var(--color-success)', count: horizon.position },
            { key: 'unknown', label: '미분류', color: 'var(--color-text-secondary)', count: horizon.unknown },
          ].map((item) => {
            const pct = (item.count / horizonTotal) * 100
            return (
              <div key={item.key}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                  <span>{item.label}</span>
                  <span>{item.count}개 ({pct.toFixed(1)}%)</span>
                </div>
                <div style={{ height: 8, background: 'var(--color-bg-sunken)', borderRadius: 999 }}>
                  <div
                    style={{
                      width: `${Math.max(2, pct)}%`,
                      height: '100%',
                      borderRadius: 999,
                      background: item.color,
                    }}
                  />
                </div>
              </div>
            )
          })}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--space-3)' }}>
          <div style={{ padding: 'var(--space-3)', border: '1px solid var(--color-border-default)', borderRadius: 8 }}>
            <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>리뷰 필요</p>
            <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-error)' }}>{reviewSchedule.due_now}개</p>
          </div>
          <div style={{ padding: 'var(--space-3)', border: '1px solid var(--color-border-default)', borderRadius: 8 }}>
            <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>2일 이내</p>
            <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-warning)' }}>{reviewSchedule.due_soon}개</p>
          </div>
          <div style={{ padding: 'var(--space-3)', border: '1px solid var(--color-border-default)', borderRadius: 8 }}>
            <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>향후 예정</p>
            <p style={{ fontSize: 18, fontWeight: 700, color: 'var(--color-success)' }}>{reviewSchedule.due_later}개</p>
          </div>
        </div>
      </div>

      {/* 포트폴리오 요약 */}
      <div
        className="card"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 'var(--space-4)',
          padding: 'var(--space-6)',
          marginBottom: 'var(--space-6)',
          borderLeft: `6px solid ${riskLevel === 'RED' ? 'var(--color-error)' : riskLevel === 'YELLOW' ? 'var(--color-warning)' : 'var(--color-success)'}`,
        }}
      >
        <div>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>총 투자액</p>
          <p style={{ fontSize: 18, fontWeight: 'bold', marginTop: 4 }}>
            {formatKrw(portfolio.total_invested)}
          </p>
        </div>

        <div>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>현재가</p>
          <p style={{ fontSize: 18, fontWeight: 'bold', marginTop: 4 }}>
            {formatKrw(portfolio.total_current_value)}
          </p>
        </div>

        <div>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>총 손익</p>
          <p
            style={{
              fontSize: 18,
              fontWeight: 'bold',
              marginTop: 4,
              color:
                portfolio.total_pnl >= 0 ? 'var(--color-success)' : 'var(--color-error)',
            }}
          >
            {formatKrw(portfolio.total_pnl)}{' '}
            {portfolio.total_pnl >= 0 ? '📈' : '📉'}
          </p>
        </div>

        <div>
          <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>수익률</p>
          <p
            style={{
              fontSize: 18,
              fontWeight: 'bold',
              marginTop: 4,
              color:
                portfolio.total_pnl_percent >= 0
                  ? 'var(--color-success)'
                  : 'var(--color-error)',
            }}
          >
            {formatPercent(portfolio.total_pnl_percent)} {riskEmoji}
          </p>
        </div>

        <div style={{ gridColumn: 'auto' }}>
          <Button
            variant={autoRefresh ? 'primary' : 'secondary'}
            onClick={() => setAutoRefresh(!autoRefresh)}
            disabled={loading}
            style={{ width: '100%' }}
          >
            {autoRefresh ? '⏱️ 자동' : '⏸️ 수동'}
          </Button>
        </div>

        <div>
          <Button
            variant="secondary"
            onClick={loadPortfolio}
            loading={loading}
            disabled={loading}
            style={{ width: '100%' }}
          >
            새로고침
          </Button>
        </div>
      </div>

      {/* 종목별 상세 */}
      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <h2 className="title-md" style={{ marginBottom: 'var(--space-2)' }}>
          종목별 현황
        </h2>

        {positions.length === 0 ? (
          <div className="state-empty">
            <div className="state-empty-title">보유 중인 종목이 없습니다</div>
          </div>
        ) : (
          positions.map((pos) => {
            const pnlPercent = pos.pnl_percent ?? 0
            const pnlColor =
              pnlPercent >= 0 ? 'var(--color-success)' : 'var(--color-error)'
            const pnlEmoji = pnlPercent >= 0 ? '📈' : '📉'

            // 손절 상태 판단
            const stopLoss = pos.stop_loss_percent
            let stopLossStatus = '안전'
            let stopLossColor = 'var(--color-success)'
            if (stopLoss && pnlPercent <= stopLoss) {
              stopLossStatus = '손절!'
              stopLossColor = 'var(--color-error)'
            } else if (stopLoss && pnlPercent > stopLoss && pnlPercent < stopLoss + 1) {
              stopLossStatus = '주의'
              stopLossColor = 'var(--color-warning)'
            }

            // 익절 목표 확인
            let takeProfit = '설정 안 됨'
            let tpColor = 'var(--color-text-secondary)'
            if (pos.take_profit_targets && Array.isArray(pos.take_profit_targets)) {
              for (const t of pos.take_profit_targets) {
                if (pnlPercent >= t.target) {
                  takeProfit = `✅ +${t.target}% 달성 (${t.percentage}% 매도)`
                  tpColor = 'var(--color-success)'
                  break
                } else if (pnlPercent > t.target - 1) {
                  takeProfit = `⏳ +${t.target}% 근처`
                  tpColor = 'var(--color-warning)'
                  break
                }
              }
            }

            return (
              <div
                key={pos.id}
                className="card"
                style={{
                  padding: 'var(--space-4)',
                  borderLeft: `4px solid ${pnlColor}`,
                }}
              >
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
                  {/* 좌측: 기본 정보 */}
                  <div>
                    <h3 className="title-md" style={{ marginBottom: 'var(--space-3)' }}>
                      {pos.code}
                    </h3>

                    <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
                      <div>
                        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>수량</p>
                        <p style={{ fontSize: 14, fontWeight: 'bold' }}>{pos.quantity}주</p>
                      </div>

                      <div>
                        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>매수가</p>
                        <p style={{ fontSize: 14, fontWeight: 'bold' }}>
                          {formatKrw(pos.buy_price)}
                        </p>
                      </div>

                      <div>
                        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>현재가</p>
                        <p style={{ fontSize: 14, fontWeight: 'bold', color: pnlColor }}>
                          {pos.current_price ? formatKrw(pos.current_price) : '조회 중...'}
                        </p>
                      </div>

                      <div>
                        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>보유수평선</p>
                        <p style={{ fontSize: 14, fontWeight: 'bold' }}>
                          {pos.target_horizon === 'scalp'
                            ? '단타'
                            : pos.target_horizon === 'swing'
                              ? '스윙'
                              : pos.target_horizon === 'position'
                                ? '중장기'
                                : '미분류'}
                        </p>
                        <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                          리뷰: {pos.planned_review_at ? new Date(pos.planned_review_at).toLocaleDateString('ko-KR') : '-'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* 우측: 손익 & 조건 */}
                  <div>
                    <div style={{ marginBottom: 'var(--space-4)' }}>
                      <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>손익</p>
                      <p
                        style={{
                          fontSize: 20,
                          fontWeight: 'bold',
                          marginTop: 4,
                          color: pnlColor,
                        }}
                      >
                        {formatKrw(pos.pnl_amount || 0)} {pnlEmoji}
                      </p>
                      <p style={{ fontSize: 14, color: pnlColor, marginTop: 2 }}>
                        {formatPercent(pnlPercent)}
                      </p>
                    </div>

                    {/* 손절 상태 */}
                    {stopLoss !== undefined && stopLoss !== null && (
                      <div
                        style={{
                          padding: 'var(--space-2)',
                          background: `${stopLossColor}20`,
                          borderRadius: 4,
                          marginBottom: 'var(--space-2)',
                        }}
                      >
                        <p style={{ fontSize: 11, color: stopLossColor, fontWeight: 'bold' }}>
                          손절: {stopLossStatus} ({stopLoss}%)
                        </p>
                      </div>
                    )}

                    {/* 익절 상태 */}
                    <div
                      style={{
                        padding: 'var(--space-2)',
                        background: `${tpColor}20`,
                        borderRadius: 4,
                      }}
                    >
                      <p style={{ fontSize: 11, color: tpColor }}>
                        익절: {takeProfit}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

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
          💡 자동 갱신
        </h3>
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', margin: 0 }}>
          "자동" 모드에서는 매 1분마다 현재가를 자동으로 갱신하여 손익률과 손절/익절 조건을 실시간으로 확인할 수 있습니다.
        </p>
      </div>
    </div>
  )
}
