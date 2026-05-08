import React, { useMemo, useState } from 'react'
import { apiFetch } from '../../lib/api'
import { formatKrw, formatNumber } from '../../lib/format'
import Button from '../../components/ui/Button'
import Input from '../../components/ui/Input'
import Skeleton from '../../components/Skeleton'
import { EmptyState, ErrorState } from '../../components/StateViews'
import { useToast } from '../../components/ToastProvider'
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
}

function GradeBadge({ grade }: { grade: string | null | undefined }) {
  if (!grade) return <span className="scan-grade-label">-</span>
  const g = String(grade).toUpperCase().trim()
  const cls = g === 'A' ? 'scan-grade-a' : g === 'B' ? 'scan-grade-b' : g === 'C' ? 'scan-grade-c' : 'scan-grade-other'
  return <span className={`scan-grade-badge ${cls}`}>{g}</span>
}

function WarnBadge({ grade }: { grade: string | null | undefined }) {
  if (!grade) return <span className="scan-grade-label">-</span>
  const g = String(grade).toUpperCase().trim()
  const cls = g === 'SAFE' ? 'scan-warn-safe' : g === 'WATCH' ? 'scan-warn-watch' : g === 'WARN' ? 'scan-warn-warn' : 'scan-warn-default'
  return <span className={`scan-warn-badge ${cls}`}>{g}</span>
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

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const json = await apiFetch('/api/ui/scan-highlights', { cacheMs: 30_000, timeoutMs: 15_000, retries: 1 })
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
      setError(e?.message || String(e))
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

  return (
    <div className="container-app">
      <div className="title-xl">하이라이트 허브</div>
      <div className="muted mb-4">오늘의 최종 진입 후보를 고르고 바로 배분/수익 시뮬레이션으로 넘길 수 있습니다.</div>

      <div className="card mb-4">
        <div className="flex-between" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <div>
            <div className="title-md">오늘의 집행 초안</div>
            <div className="caption mt-1">최대 1~3종목 권장. 단일 확신 종목이면 1종목만 선택 후 분할진입 시뮬레이션을 사용하세요.</div>
          </div>
          <Button variant="secondary" onClick={load} disabled={loading}>하이라이트 새로고침</Button>
        </div>
        <div className="grid-two mt-3">
          <Input
            label="총 투자금 (원)"
            type="number"
            min={0}
            value={totalCapital}
            onChange={(e) => setTotalCapital(e.target.value)}
          />
          <div className="card" style={{ padding: 'var(--space-3)' }}>
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
        <div className="cards-grid cols-2">
          {items.map((row, index) => {
            const selected = selectedCodes.includes(row.code)
            const amount = amountByCode[row.code] || '0'
            return (
              <div
                key={row.code}
                className="card"
                style={{
                  borderColor: selected ? 'var(--color-border-primary)' : undefined,
                  boxShadow: selected ? 'var(--shadow-sm)' : undefined,
                }}
              >
                <div className="flex-between" style={{ alignItems: 'flex-start' }}>
                  <div>
                    <div className="caption">TOP {index + 1}</div>
                    <div className="title-md" style={{ marginTop: 'var(--space-1)' }}>{row.name}</div>
                    <div className="caption">{row.code} {row.sector_id ? `· ${row.sector_id}` : ''}</div>
                  </div>
                  <WarnBadge grade={row.warn_grade} />
                </div>

                <div className="mt-3 flex-gap-sm" style={{ flexWrap: 'wrap' }}>
                  <GradeBadge grade={row.entry_grade} />
                  <GradeBadge grade={row.trend_grade} />
                  <GradeBadge grade={row.dist_grade} />
                  <span className="caption">진입 {formatNumber(row.entry_score, 1)}</span>
                  {typeof row.total_score === 'number' && <span className="caption">종합 {formatNumber(row.total_score, 0)}</span>}
                </div>

                <div className="mt-3">
                  <Input
                    label="투입 금액 (원)"
                    type="number"
                    min={0}
                    value={amount}
                    onChange={(e) => setAmountByCode((prev) => ({ ...prev, [row.code]: e.target.value }))}
                  />
                </div>

                <div className="mt-3 flex-gap-sm" style={{ justifyContent: 'space-between' }}>
                  <Button variant={selected ? 'primary' : 'secondary'} onClick={() => toggleCode(row.code)}>
                    {selected ? '선택됨' : '후보 선택'}
                  </Button>
                  <Button variant="ghost" onClick={() => goAnalyze(row.code)}>상세분석</Button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
