import React, { useMemo, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { formatKrw, formatNumber } from '../../lib/format'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import Skeleton from '../../components/Skeleton'
import { EmptyState, ErrorState } from '../../components/StateViews'
import { useToast } from '../../components/ToastProvider'
import ShareModal from '../../components/ShareModal'
import { useShareManager } from '../../hooks/useShareManager'
import { defaultPlanItem, saveSimulationPlan, type HighlightPlanItem } from '../simulator/planStore'

type HighlightItem = {
  code: string
  name: string
  sector_id: string | null
  entry_grade: string | null
  trend_grade: string | null
  dist_grade: string | null
  warn_grade: string | null
  entry_score: number | null
  total_score?: number | null
  adaptive_adjustment?: number | null
  adaptive_reasons?: string[] | null
  // forecast fields
  entry_price: number | null
  strategy_label: string
  expected_base_pct: number
  expected_upside_pct: number
  expected_drawdown_pct: number
  confidence_pct: number
  score_momentum: number
  score_value: number
  score_safety: number
}

function WarnBadge({ grade }: { grade: string | null | undefined }) {
  if (!grade) return null
  const g = String(grade).toUpperCase().trim()
  const cls = g === 'SAFE' ? 'scan-warn-safe' : g === 'WATCH' ? 'scan-warn-watch' : g === 'WARN' ? 'scan-warn-warn' : 'scan-warn-default'
  return <span className={`scan-warn-badge ${cls}`}>{g}</span>
}

function StrategyBadge({ label }: { label: string }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 4,
      fontSize: 11,
      fontWeight: 600,
      background: 'var(--color-brand-subtle)',
      color: 'var(--color-brand)',
      border: '1px solid var(--color-brand)',
    }}>{label}</span>
  )
}

function ConfidenceLabel({ pct }: { pct: number }) {
  const level = pct >= 75 ? '높음' : pct >= 60 ? '보통' : '주의'
  const color = pct >= 75 ? 'var(--color-stock-up)' : pct >= 60 ? 'var(--color-text-secondary)' : 'var(--color-stock-down)'
  return (
    <div style={{ textAlign: 'right', flexShrink: 0 }}>
      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>종합 신뢰도</div>
      <div style={{ fontSize: 20, fontWeight: 700, color, lineHeight: 1.2 }}>
        {formatNumber(pct, 1)}<span style={{ fontSize: 13 }}>%</span>
      </div>
      <div style={{ fontSize: 11, color }}>{level}</div>
    </div>
  )
}

function SelectCircle({ selected }: { selected: boolean }) {
  return (
    <div style={{
      width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
      border: selected ? '2px solid var(--color-brand)' : '2px solid var(--color-border-default)',
      background: selected ? 'var(--color-brand)' : 'transparent',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'all 0.15s',
      cursor: 'pointer',
    }}>
      {selected && (
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2.5 6L5 8.5L9.5 3.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  )
}

function ScoreBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
      <span style={{ width: 38, fontSize: 12, color: 'var(--color-text-secondary)', flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--color-border-default)' }}>
        <div style={{ width: `${Math.min(100, Math.max(0, value))}%`, height: '100%', borderRadius: 3, background: color, transition: 'width 0.4s ease' }} />
      </div>
      <span style={{ width: 26, fontSize: 12, textAlign: 'right', color: 'var(--color-text-primary)' }}>{Math.round(value)}</span>
    </div>
  )
}

function PriceCell({ label, value, pct, color }: { label: string; value?: string | null; pct?: string | null; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginBottom: 2 }}>{label}</div>
      {value && <div style={{ fontSize: 13, fontWeight: 600 }}>{value}</div>}
      {pct && <div style={{ fontSize: 13, fontWeight: 600, color: color || 'inherit' }}>{pct}</div>}
    </div>
  )
}

function calcPrices(item: HighlightItem) {
  const p = item.entry_price
  if (!p || p <= 0) return null
  const stop = Math.round(p * (1 - item.expected_drawdown_pct / 100))
  const t1 = Math.round(p * (1 + item.expected_base_pct / 100))
  const t2 = Math.round(p * (1 + item.expected_upside_pct / 100))
  const entryLow = Math.round(p * 0.995)
  const entryHigh = Math.round(p * 1.005)
  return { stop, t1, t2, entryLow, entryHigh }
}

const ANALYZE_PENDING_CODE_KEY = 'analyze_pending_code'

function navigateTo(route: string) {
  try {
    window.history.pushState({}, '', `/${route}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  } catch {
    // ignore
  }
}

export default function HighlightsPage() {
  const [items, setItems] = React.useState<HighlightItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [selectedCodes, setSelectedCodes] = useState<string[]>([])
  const [amountByCode, setAmountByCode] = useState<Record<string, string>>({})
  const [totalCapital, setTotalCapital] = useState('10000000')
  const [isSaving, setIsSaving] = useState(false)
  const toast = useToast()
  const shareManager = useShareManager({
    endpoint: '/api/ui/route-share',
    scopeKey: 'kind',
    requiresCode: false,
  })

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const json = await apiFetch('/api/ui/scan-highlights', { cacheMs: 30_000, timeoutMs: 30_000, retries: 2 })
      const nextItems: HighlightItem[] = Array.isArray(json?.data) ? json.data : []
      setItems(nextItems)
      setSelectedCodes((prev) => {
        if (prev.length > 0) return prev.filter(code => nextItems.some((row) => row.code === code))
        return nextItems.slice(0, Math.min(3, nextItems.length)).map((row) => row.code)
      })
      setAmountByCode((prev) => {
        const clone = { ...prev }
        for (const row of nextItems) {
          if (!clone[row.code]) clone[row.code] = '1000000'
        }
        return clone
      })
    } catch (e: any) {
      const msg = e?.message || String(e)
      // 타임아웃 오류 시 더 명확한 메시지 제공
      if (msg.includes('timed out') || msg.includes('timeout')) {
        setError('서버 응답이 느립니다. 잠시 후 다시 시도해주세요.')
      } else if (msg.includes('404') || msg.includes('Unknown') || msg.includes('route')) {
        setError('데이터를 불러오는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.')
      } else {
        setError(msg)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const selectedItems = useMemo(() => items.filter((row) => selectedCodes.includes(row.code)), [items, selectedCodes])
  const totalPlannedAmount = useMemo(
    () => selectedItems.reduce((acc, row) => acc + Number(amountByCode[row.code] || 0), 0),
    [selectedItems, amountByCode],
  )
  const remaining = Number(totalCapital || 0) - totalPlannedAmount

  const toggleCode = (code: string) => {
    setSelectedCodes((prev) => prev.includes(code) ? prev.filter((v) => v !== code) : [...prev, code])
  }

  const goAnalyze = (code: string) => {
    try {
      sessionStorage.setItem(ANALYZE_PENDING_CODE_KEY, code)
    } catch {
      // ignore
    }
    navigateTo('analyze')
  }

  const saveAndGoSimulation = () => {
    if (selectedItems.length === 0) {
      toast.show('최소 1개 종목을 선택해 주세요.')
      return
    }
    setIsSaving(true)
    try {
      const rows: HighlightPlanItem[] = selectedItems.map((row) => {
        const amount = Math.max(0, Number(amountByCode[row.code] || 0))
        return defaultPlanItem({
          code: row.code,
          name: row.name,
          sector_id: row.sector_id,
          amount: Number.isFinite(amount) ? amount : 0,
        })
      })
      saveSimulationPlan({
        createdAt: Date.now(),
        totalCapital: Math.max(0, Number(totalCapital || 0)),
        notes: '하이라이트 허브에서 생성',
        items: rows,
      })
      toast.show('시뮬레이터로 계획을 전송했습니다.')
      navigateTo('simulator')
    } finally {
      setIsSaving(false)
    }
  }

  const onShareHighlights = async () => {
    if (selectedItems.length === 0) {
      toast.show('최소 1개 종목을 선택해 주세요.')
      return
    }

    await shareManager.createShare('highlights', {
      kind: 'highlights',
      payload: {
        items: selectedItems.map((row) => ({
          code: row.code,
          name: row.name,
          sector_id: row.sector_id,
          entry_grade: row.entry_grade,
          trend_grade: row.trend_grade,
          dist_grade: row.dist_grade,
          warn_grade: row.warn_grade,
          entry_price: row.entry_price,
          strategy_label: row.strategy_label,
          expected_base_pct: row.expected_base_pct,
          expected_upside_pct: row.expected_upside_pct,
          expected_drawdown_pct: row.expected_drawdown_pct,
          confidence_pct: row.confidence_pct,
          score_momentum: row.score_momentum,
          score_value: row.score_value,
          score_safety: row.score_safety,
        })),
        totalCapital: Number(totalCapital || 0),
        selectedCount: selectedItems.length,
        totalCount: items.length,
      },
    })
  }

  return (
    <div className="container-app">
      <div className="title-xl">하이라이트</div>
      <div className="muted mb-4">오늘의 최종 진입 후보를 고르고 바로 배분/수익 시뮬레이션으로 넘길 수 있습니다.</div>

      <div className="card mb-4">
        <div className="flex-between" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <div>
            <div className="title-md">오늘의 집행 초안</div>
            <div className="caption mt-1">최대 1~3종목 권장. 단일 확신 종목이면 1종목만 선택 후 분할진입 시뮬레이션을 사용하세요.</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="secondary" onClick={onShareHighlights} disabled={selectedItems.length === 0}>링크 공유</Button>
            <Button variant="secondary" onClick={load} disabled={loading}>하이라이트 새로고침</Button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'stretch', marginTop: 'var(--space-3)', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 200px', minWidth: '200px' }}>
            <Input
              label="총 투자금 (원)"
              type="number"
              min={0}
              value={totalCapital}
              onChange={(e) => setTotalCapital(e.target.value)}
            />
          </div>
          <div style={{
            flex: '1 1 200px',
            padding: 'var(--space-3)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--color-bg-muted)',
            border: '1px solid var(--color-border-default)',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
          }}>
            <div className="caption">선택 종목 합계</div>
            <div className="title-md mt-1">{formatKrw(totalPlannedAmount)}</div>
            <div className={`caption mt-1 ${remaining < 0 ? 'negative' : 'muted'}`}>
              잔여/초과: {remaining >= 0 ? '+' : ''}{formatKrw(remaining)}
            </div>
          </div>
        </div>
        <div className="mt-3 flex-gap-sm" style={{ justifyContent: 'flex-end' }}>
          <Button onClick={saveAndGoSimulation} disabled={isSaving || loading}>선택 종목으로 시뮬레이션 시작</Button>
        </div>
      </div>

      {loading ? (
        <div className="card"><Skeleton lines={8} height={14} /></div>
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : items.length === 0 ? (
        <div className="card"><EmptyState title="하이라이트 후보가 없습니다" description="스캔 실행 이후 다시 시도해 주세요." /></div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {/* TOP 3: 풀 카드 */}
          {items.slice(0, 3).map((row, index) => {
            const selected = selectedCodes.includes(row.code)
            const amount = amountByCode[row.code] || '0'
            const prices = calcPrices(row)
            const reasons = Array.isArray(row.adaptive_reasons) && row.adaptive_reasons.length > 0 ? row.adaptive_reasons : null
            return (
              <div
                key={row.code}
                className="card"
                style={{
                  padding: 'var(--space-5)',
                  borderColor: selected ? 'var(--color-brand)' : undefined,
                  transition: 'border-color 0.15s',
                }}
              >
                {/* 헤더 */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-4)' }}>
                  <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                      background: index === 0 ? 'var(--color-brand)' : 'var(--color-bg-muted)',
                      color: index === 0 ? '#fff' : 'var(--color-text-secondary)',
                      border: index === 0 ? 'none' : '1px solid var(--color-border-default)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 700, fontSize: 13,
                    }}>{index + 1}</div>
                    <div>
                      <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.2 }}>{row.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 4, display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span>{row.code}</span>
                        <StrategyBadge label={row.strategy_label} />
                        <WarnBadge grade={row.warn_grade} />
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)' }}>
                    <ConfidenceLabel pct={row.confidence_pct} />
                    <div onClick={() => toggleCode(row.code)} style={{ marginTop: 2 }}>
                      <SelectCircle selected={selected} />
                    </div>
                  </div>
                </div>

                {/* 가격 4칸 — divider 구분 */}
                <div style={{
                  display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: 'var(--space-3)',
                  borderTop: '1px solid var(--color-border-default)',
                  borderBottom: '1px solid var(--color-border-default)',
                  padding: 'var(--space-3) 0',
                  marginBottom: 'var(--space-4)',
                }}>
                  <PriceCell label="기준 진입가" value={row.entry_price ? `${formatKrw(row.entry_price)}` : '-'} />
                  <PriceCell label="기대 수익" pct={`+${formatNumber(row.expected_base_pct, 1)}%`} color="var(--color-stock-up)" />
                  <PriceCell label="상단 목표" pct={`+${formatNumber(row.expected_upside_pct, 1)}%`} color="var(--color-stock-up)" />
                  <PriceCell label="예상 손실" pct={`-${formatNumber(row.expected_drawdown_pct, 1)}%`} color="var(--color-stock-down)" />
                </div>

                {/* 점수 지표 + 매수 근거 */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginBottom: 8, fontWeight: 500, letterSpacing: '0.02em' }}>점수 지표</div>
                    <ScoreBar label="모멘텀" value={row.score_momentum} color="#ef4444" />
                    <ScoreBar label="밸류" value={row.score_value} color="#f97316" />
                    <ScoreBar label="안전성" value={row.score_safety} color="#22c55e" />
                    <div style={{
                      marginTop: 8, fontSize: 12, color: 'var(--color-stock-up)', fontWeight: 600,
                    }}>
                      기대 여지 +{formatNumber(row.expected_base_pct, 1)}%
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)', marginBottom: 8, fontWeight: 500, letterSpacing: '0.02em' }}>매수 확신 근거</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {(reasons ?? [
                        `모멘텀 ${Math.round(row.score_momentum)}점 — 진입 강도 기반 추세 분석.`,
                        `안전성 ${Math.round(row.score_safety)}점 — 하방 리스크 제한적입니다.`,
                        `기대 여지 +${formatNumber(row.expected_base_pct, 1)}% — 예상 손실 대비 기대 수익 비율이 우수합니다.`,
                      ]).slice(0, 4).map((r, i) => (
                        <div key={i} style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>{r}</div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* 진입구간/목표가 */}
                {prices && (
                  <div style={{
                    display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: 'var(--space-2)',
                    borderTop: '1px solid var(--color-border-default)',
                    paddingTop: 'var(--space-3)',
                    marginBottom: 'var(--space-4)',
                  }}>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>진입 구간</div>
                      <div style={{ fontSize: 12, fontWeight: 600, marginTop: 2 }}>{formatKrw(prices.entryLow)} ~ {formatKrw(prices.entryHigh)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>손절 기준</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-stock-down)', marginTop: 2 }}>
                        {formatKrw(prices.stop)} (-{formatNumber(row.expected_drawdown_pct, 1)}%)
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>1차 목표</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-stock-up)', marginTop: 2 }}>
                        {formatKrw(prices.t1)} (+{formatNumber(row.expected_base_pct, 1)}%)
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>2차 목표</div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-stock-up)', marginTop: 2 }}>
                        {formatKrw(prices.t2)} (+{formatNumber(row.expected_upside_pct, 1)}%)
                      </div>
                    </div>
                  </div>
                )}

                {/* 투입금액 + 상세분석 */}
                <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end' }}>
                  <div style={{ flex: 1 }}>
                    <Input
                      label="투입 금액 (원)"
                      type="number"
                      min={0}
                      value={amount}
                      onChange={(e) => setAmountByCode((prev) => ({ ...prev, [row.code]: e.target.value }))}
                    />
                  </div>
                  <Button variant="ghost" onClick={() => goAnalyze(row.code)}>상세분석</Button>
                </div>
              </div>
            )
          })}

          {/* TOP 4-5: 컴팩트 카드 */}
          {items.slice(3).length > 0 && (
            <div>
              <div style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-2)', padding: '0 2px' }}>추가 후보</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {items.slice(3).map((row, i) => {
                  const selected = selectedCodes.includes(row.code)
                  const amount = amountByCode[row.code] || '0'
                  return (
                    <div
                      key={row.code}
                      className="card"
                      style={{
                        padding: 'var(--space-3) var(--space-4)',
                        borderColor: selected ? 'var(--color-brand)' : undefined,
                        borderLeftWidth: selected ? 3 : undefined,
                        transition: 'border-color 0.15s, border-left-width 0.15s',
                      }}
                    >
                      <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
                        <div style={{
                          width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                          background: 'var(--color-bg-muted)', color: 'var(--color-text-secondary)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontWeight: 700, fontSize: 12, border: '1px solid var(--color-border-default)',
                        }}>{i + 4}</div>
                        <div style={{ flex: 1, minWidth: 120 }}>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{row.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>{row.code}</div>
                        </div>
                        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flexWrap: 'wrap' }}>
                          {row.entry_price && (
                            <div style={{ textAlign: 'center' }}>
                              <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>기준가</div>
                              <div style={{ fontSize: 12, fontWeight: 600 }}>{formatKrw(row.entry_price)}</div>
                            </div>
                          )}
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>기대수익</div>
                            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-stock-up)' }}>+{formatNumber(row.expected_base_pct, 1)}%</div>
                          </div>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)' }}>신뢰도</div>
                            <div style={{ fontSize: 12, fontWeight: 600 }}>{formatNumber(row.confidence_pct, 1)}%</div>
                          </div>
                          <WarnBadge grade={row.warn_grade} />
                        </div>
                        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                          <div style={{ width: 90 }}>
                            <Input
                              type="number"
                              min={0}
                              value={amount}
                              onChange={(e) => setAmountByCode((prev) => ({ ...prev, [row.code]: e.target.value }))}
                            />
                          </div>
                          <Button variant="ghost" onClick={() => goAnalyze(row.code)}>분석</Button>
                          <div onClick={() => toggleCode(row.code)}>
                            <SelectCircle selected={selected} />
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <ShareModal
        open={shareManager.open}
        onClose={shareManager.close}
        url={shareManager.info?.url}
        code={shareManager.info?.code}
        requiresCode={shareManager.requiresCode}
        expiresAt={shareManager.info?.expiresAt}
        shares={shareManager.list}
        loading={shareManager.loading}
        onRefresh={() => { void shareManager.loadList('highlights') }}
        includeAll={shareManager.includeAll}
        onChangeIncludeAll={shareManager.setIncludeAll}
        onRevoke={shareManager.revokeShare}
        revokingId={shareManager.revokingId}
      />
    </div>
  )
}
