import React, { useEffect, useMemo, useState } from 'react'
import Input from '../../components/ui/Input'
import Button from '../../components/ui/Button'
import { EmptyState } from '../../components/StateViews'
import { formatKrw, formatNumber } from '../../lib/format'
import { apiFetch } from '../../lib/api'
import { useToast } from '../../components/ToastProvider'
import { defaultPlanItem, readSimulationPlan, saveSimulationPlan, type HighlightPlanItem } from './planStore'

const RISE_SCENARIOS = [3, 5, 8]

function clampPercent(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min
  if (value < min) return min
  if (value > max) return max
  return value
}

function calcExpectedValue(item: HighlightPlanItem) {
  const invested = item.amount
  const targetProfit = invested * (item.targetPct / 100)
  const stopLoss = invested * (item.stopPct / 100)
  return invested > 0
    ? targetProfit * (item.winProb / 100) - stopLoss * (1 - item.winProb / 100)
    : 0
}

function calcSplitInvested(item: HighlightPlanItem, fillRatePct: number) {
  const splitRatio = (item.split1 + item.split2 + item.split3) / 100
  const fillRatio = clampPercent(fillRatePct, 0, 100) / 100
  return item.amount * splitRatio * fillRatio
}

type TelegramFormat = 'simple' | 'detailed'

function buildTelegramMessage(params: {
  totalCapital: number
  fillRatePct: number
  feePct: number
  taxPct: number
  expectedAfterCost: number
  remaining: number
  items: HighlightPlanItem[]
  format: TelegramFormat
}) {
  if (params.format === 'simple') {
    const lines = [
      '[시뮬레이터 간단 요약]',
      `총 ${formatKrw(params.totalCapital)} · 기대손익 ${params.expectedAfterCost >= 0 ? '+' : ''}${formatKrw(params.expectedAfterCost)}`,
      '',
    ]
    for (const row of params.items.slice(0, 10)) {
      const ev = calcExpectedValue(row)
      lines.push(`- ${row.name || row.code} ${formatKrw(row.amount)} (${ev >= 0 ? '+' : ''}${formatKrw(ev)})`)
    }
    return lines.join('\n')
  }

  // detailed
  const lines = [
    '[웹 시뮬레이터 상세 계획]',
    `총 투자금: ${formatKrw(params.totalCapital)}`,
    `체결률: ${formatNumber(params.fillRatePct, 0)}% · 비용 ${formatNumber(params.feePct, 2)}% · 세금 ${formatNumber(params.taxPct, 2)}%`,
    `기대손익(비용차감): ${params.expectedAfterCost >= 0 ? '+' : ''}${formatKrw(params.expectedAfterCost)}`,
    `잔여/초과: ${params.remaining >= 0 ? '+' : ''}${formatKrw(params.remaining)}`,
    '',
    '종목별 집행안',
  ]
  for (const row of params.items.slice(0, 10)) {
    const ev = calcExpectedValue(row)
    lines.push(
      `- ${row.name || row.code}(${row.code}) ${formatKrw(row.amount)} | 목표 ${formatNumber(row.targetPct, 1)}% / 손절 ${formatNumber(row.stopPct, 1)}% / 승률 ${formatNumber(row.winProb, 0)}%`,
    )
    lines.push(
      `  분할 ${formatNumber(row.split1, 0)}/${formatNumber(row.split2, 0)}/${formatNumber(row.split3, 0)}% · 기대손익 ${ev >= 0 ? '+' : ''}${formatKrw(ev)}`,
    )
  }
  return lines.join('\n')
}

export default function SimulatorPage() {
  const initialPlan = useMemo(() => readSimulationPlan(), [])
  const [totalCapital, setTotalCapital] = useState(String(initialPlan?.totalCapital ?? 10_000_000))
  const [items, setItems] = useState<HighlightPlanItem[]>(
    initialPlan?.items?.length ? initialPlan.items : [defaultPlanItem({ code: '000000', name: '예시 종목' })],
  )
  const [fillRatePct, setFillRatePct] = useState(100)
  const [feePct, setFeePct] = useState(0.15)
  const [taxPct, setTaxPct] = useState(0.2)
  const [memo, setMemo] = useState(initialPlan?.notes || '')
  const [syncing, setSyncing] = useState(false)
  const [lastServerSavedAt, setLastServerSavedAt] = useState<string>('')
  const [telegramFormat, setTelegramFormat] = useState<TelegramFormat>('detailed')
  const [history, setHistory] = useState<Array<{ updatedAt: string; plan: any }>>([]) 
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const toast = useToast()

  const summary = useMemo(() => {
    const total = items.reduce((acc, row) => acc + Number(row.amount || 0), 0)
    const splitInvested = items.reduce((acc, row) => acc + calcSplitInvested(row, fillRatePct), 0)
    const expected = items.reduce((acc, row) => acc + calcExpectedValue(row), 0)
    const feeTax = splitInvested * ((feePct + taxPct) / 100)
    return {
      total,
      splitInvested,
      expectedAfterCost: expected - feeTax,
      feeTax,
      remaining: Number(totalCapital || 0) - total,
    }
  }, [items, fillRatePct, feePct, taxPct, totalCapital])

  const scenarioRows = useMemo(() => {
    return RISE_SCENARIOS.map((pct) => {
      const gross = items.reduce((acc, row) => {
        const invested = calcSplitInvested(row, fillRatePct)
        return acc + invested * (pct / 100)
      }, 0)
      const cost = summary.splitInvested * ((feePct + taxPct) / 100)
      return { pct, gross, net: gross - cost }
    })
  }, [items, fillRatePct, summary.splitInvested, feePct, taxPct])

  const updateItem = (idx: number, patch: Partial<HighlightPlanItem>) => {
    setItems((prev) => prev.map((row, i) => i === idx ? { ...row, ...patch } : row))
  }

  const addRow = () => {
    setItems((prev) => [...prev, defaultPlanItem({ code: '', name: '' })])
  }

  const removeRow = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx))
  }

  const buildPlan = () => ({
    createdAt: Date.now(),
    totalCapital: Math.max(0, Number(totalCapital || 0)),
    notes: memo,
    items,
  })

  const applyPlan = (plan: any) => {
    if (!plan || !Array.isArray(plan.items)) return
    setTotalCapital(String(Math.max(0, Number(plan.totalCapital || 0))))
    setMemo(String(plan.notes || ''))
    setItems(plan.items)
  }

  const saveLocal = () => {
    saveSimulationPlan(buildPlan())
    toast.show('로컬에 계획을 저장했습니다.')
  }

  const saveServer = async () => {
    setSyncing(true)
    try {
      await apiFetch('/api/ui/simulation-plan', {
        method: 'POST',
        body: JSON.stringify({ plan: buildPlan() }),
        cacheMs: 0,
        timeoutMs: 15_000,
      })
      setLastServerSavedAt(new Date().toISOString())
      toast.show('서버에 계획을 저장했습니다.')
    } catch (e: any) {
      toast.show(`서버 저장 실패: ${e?.message || String(e)}`)
    } finally {
      setSyncing(false)
    }
  }

  const loadServer = async () => {
    setSyncing(true)
    try {
      const res = await apiFetch('/api/ui/simulation-plan?mode=latest', {
        cacheMs: 0,
        timeoutMs: 12_000,
      })
      const plan = res?.data?.plan
      if (!plan) {
        toast.show('서버에 저장된 계획이 없습니다.')
        return
      }
      applyPlan(plan)
      saveSimulationPlan(plan)
      setLastServerSavedAt(String(res?.data?.updatedAt || ''))
      toast.show('서버 계획을 불러왔습니다.')
    } catch (e: any) {
      toast.show(`서버 불러오기 실패: ${e?.message || String(e)}`)
    } finally {
      setSyncing(false)
    }
  }

  const sendTelegram = async (fmt: TelegramFormat) => {
    setSyncing(true)
    try {
      const message = buildTelegramMessage({
        totalCapital: Math.max(0, Number(totalCapital || 0)),
        fillRatePct,
        feePct,
        taxPct,
        expectedAfterCost: summary.expectedAfterCost,
        remaining: summary.remaining,
        items,
        format: fmt,
      })
      await apiFetch('/api/ui/notify', {
        method: 'POST',
        body: JSON.stringify({ message }),
        cacheMs: 0,
        timeoutMs: 12_000,
      })
      toast.show(`텔레그램 ${fmt === 'simple' ? '간단' : '상세'} 요약을 전송했습니다.`)
    } catch (e: any) {
      toast.show(`텔레그램 전송 실패: ${e?.message || String(e)}`)
    } finally {
      setSyncing(false)
    }
  }

  const loadHistory = async () => {
    setHistoryLoading(true)
    try {
      const res = await apiFetch('/api/ui/simulation-plan?mode=history&limit=10', {
        cacheMs: 0,
        timeoutMs: 12_000,
      })
      setHistory(res?.data || [])
      setHistoryOpen(true)
    } catch (e: any) {
      toast.show(`히스토리 불러오기 실패: ${e?.message || String(e)}`)
    } finally {
      setHistoryLoading(false)
    }
  }

  const loadFromHistory = (entry: { updatedAt: string; plan: any }) => {
    applyPlan(entry.plan)
    saveSimulationPlan(entry.plan)
    setLastServerSavedAt(entry.updatedAt)
    setHistoryOpen(false)
    toast.show(`${new Date(entry.updatedAt).toLocaleString('ko-KR')} 계획을 불러왔습니다.`)
  }

  useEffect(() => {
    if (initialPlan?.items?.length) return
    void loadServer()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="container-app">
      <div className="title-xl">고도화 시뮬레이터</div>
      <div className="muted mb-4">후보별 배분, 단일 종목 분할진입, 목표/손절/승률 가정으로 기대수익을 계산합니다.</div>

      <div className="cards-grid cols-2 mb-4">
        <div className="card">
          <div className="title-md">공통 가정</div>
          <div className="grid-two mt-3">
            <Input label="총 투자금 (원)" type="number" min={0} value={totalCapital} onChange={(e) => setTotalCapital(e.target.value)} />
            <Input label="실제 체결률 (%)" type="number" min={0} max={100} value={String(fillRatePct)} onChange={(e) => setFillRatePct(clampPercent(Number(e.target.value || 0), 0, 100))} />
            <Input label="매매 비용률 (%)" type="number" min={0} step="0.01" value={String(feePct)} onChange={(e) => setFeePct(Math.max(0, Number(e.target.value || 0)))} />
            <Input label="세금/기타 (%)" type="number" min={0} step="0.01" value={String(taxPct)} onChange={(e) => setTaxPct(Math.max(0, Number(e.target.value || 0)))} />
          </div>
          <Input className="mt-3" label="메모" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="예: 장 초반 변동성 높음, 2차까지만 체결 예상" />
          {!!lastServerSavedAt && (
            <div className="caption mt-2">서버 마지막 저장: {new Date(lastServerSavedAt).toLocaleString('ko-KR')}</div>
          )}
          <div className="mt-3 flex-gap-sm" style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <Button variant="secondary" onClick={saveLocal} disabled={syncing}>로컬 저장</Button>
            <Button variant="secondary" onClick={loadServer} disabled={syncing}>서버 불러오기</Button>
            <Button variant="secondary" onClick={loadHistory} disabled={syncing || historyLoading}>히스토리</Button>
            <Button onClick={saveServer} disabled={syncing}>서버 저장</Button>
            <div style={{ display: 'flex', gap: 'var(--space-1)', alignItems: 'center' }}>
              <select
                value={telegramFormat}
                onChange={(e) => setTelegramFormat(e.target.value as TelegramFormat)}
                style={{
                  fontSize: 'var(--font-size-sm)',
                  padding: '0 var(--space-2)',
                  height: '2rem',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg-surface)',
                  color: 'var(--color-text-base)',
                  cursor: 'pointer',
                }}
              >
                <option value="simple">간단</option>
                <option value="detailed">상세</option>
              </select>
              <Button variant="ghost" onClick={() => sendTelegram(telegramFormat)} disabled={syncing}>텔레그램 전송</Button>
            </div>
          </div>

          {historyOpen && (
            <div className="card mt-3" style={{ padding: 'var(--space-3)', border: '1px solid var(--color-border)' }}>
              <div className="flex-between mb-2">
                <div className="title-sm">저장 히스토리</div>
                <Button variant="ghost" onClick={() => setHistoryOpen(false)}>닫기</Button>
              </div>
              {history.length === 0 ? (
                <div className="caption">저장된 히스토리가 없습니다.</div>
              ) : (
                <div className="cards-list" style={{ gap: 'var(--space-2)' }}>
                  {history.map((entry, i) => {
                    const p = entry.plan
                    const cap = p?.totalCapital ? formatKrw(Number(p.totalCapital)) : '-'
                    const cnt = Array.isArray(p?.items) ? p.items.length : 0
                    return (
                      <div
                        key={i}
                        className="card"
                        style={{ padding: 'var(--space-2) var(--space-3)', cursor: 'pointer' }}
                        onClick={() => loadFromHistory(entry)}
                      >
                        <div className="flex-between">
                          <div>
                            <div className="caption">{new Date(entry.updatedAt).toLocaleString('ko-KR')}</div>
                            <div className="title-sm mt-1">{cap} · 종목 {cnt}개</div>
                            {p?.notes && <div className="caption mt-1 muted">{String(p.notes).slice(0, 50)}</div>}
                          </div>
                          <Button variant="secondary" onClick={(e) => { e.stopPropagation(); loadFromHistory(entry) }}>불러오기</Button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="card">
          <div className="title-md">요약</div>
          <div className="cards-list mt-3" style={{ gap: 'var(--space-2)' }}>
            <div className="flex-between"><span className="caption">배분 합계</span><strong>{formatKrw(summary.total)}</strong></div>
            <div className="flex-between"><span className="caption">분할/체결 반영 투자금</span><strong>{formatKrw(summary.splitInvested)}</strong></div>
            <div className="flex-between"><span className="caption">비용 합계</span><strong>{formatKrw(summary.feeTax)}</strong></div>
            <div className="flex-between"><span className="caption">기대손익(비용차감)</span><strong className={summary.expectedAfterCost >= 0 ? 'positive' : 'negative'}>{summary.expectedAfterCost >= 0 ? '+' : ''}{formatKrw(summary.expectedAfterCost)}</strong></div>
            <div className="flex-between"><span className="caption">잔여/초과 자금</span><strong className={summary.remaining >= 0 ? 'positive' : 'negative'}>{summary.remaining >= 0 ? '+' : ''}{formatKrw(summary.remaining)}</strong></div>
          </div>
        </div>
      </div>

      <div className="card mb-4">
        <div className="flex-between" style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <div className="title-md">종목별 집행안</div>
          <Button variant="secondary" onClick={addRow}>행 추가</Button>
        </div>

        {items.length === 0 ? (
          <EmptyState title="집행안이 비어 있습니다" description="하이라이트 허브에서 후보를 선택하거나 수동으로 행을 추가하세요." />
        ) : (
          <div className="cards-list mt-3">
            {items.map((row, idx) => {
              const splitTotal = row.split1 + row.split2 + row.split3
              const expected = calcExpectedValue(row)
              return (
                <div key={`${row.code || 'row'}-${idx}`} className="card" style={{ padding: 'var(--space-3)' }}>
                  <div className="grid-two">
                    <Input label="코드" value={row.code} onChange={(e) => updateItem(idx, { code: e.target.value })} />
                    <Input label="종목명" value={row.name} onChange={(e) => updateItem(idx, { name: e.target.value })} />
                    <Input label="투입 금액 (원)" type="number" min={0} value={String(row.amount)} onChange={(e) => updateItem(idx, { amount: Math.max(0, Number(e.target.value || 0)) })} />
                    <Input label="승률 가정 (%)" type="number" min={0} max={100} value={String(row.winProb)} onChange={(e) => updateItem(idx, { winProb: clampPercent(Number(e.target.value || 0), 0, 100) })} />
                    <Input label="목표 상승률 (%)" type="number" value={String(row.targetPct)} onChange={(e) => updateItem(idx, { targetPct: Number(e.target.value || 0) })} />
                    <Input label="손절률 (%)" type="number" value={String(row.stopPct)} onChange={(e) => updateItem(idx, { stopPct: Number(e.target.value || 0) })} />
                  </div>

                  <div className="grid-two mt-3">
                    <Input label="1차 분할 (%)" type="number" min={0} max={100} value={String(row.split1)} onChange={(e) => updateItem(idx, { split1: clampPercent(Number(e.target.value || 0), 0, 100) })} />
                    <Input label="2차 분할 (%)" type="number" min={0} max={100} value={String(row.split2)} onChange={(e) => updateItem(idx, { split2: clampPercent(Number(e.target.value || 0), 0, 100) })} />
                    <Input label="3차 분할 (%)" type="number" min={0} max={100} value={String(row.split3)} onChange={(e) => updateItem(idx, { split3: clampPercent(Number(e.target.value || 0), 0, 100) })} />
                    <div className="card" style={{ padding: 'var(--space-3)' }}>
                      <div className="caption">분할 합계</div>
                      <div className={`title-md mt-1 ${splitTotal > 100 ? 'negative' : ''}`}>{formatNumber(splitTotal, 0)}%</div>
                      <div className="caption mt-1">기대손익 {expected >= 0 ? '+' : ''}{formatKrw(expected)}</div>
                    </div>
                  </div>

                  <div className="mt-3 flex-gap-sm" style={{ justifyContent: 'flex-end' }}>
                    <Button variant="ghost" onClick={() => removeRow(idx)}>삭제</Button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="card">
        <div className="title-md">상승 시나리오별 예상 수익</div>
        <div className="caption mt-1">각 시나리오는 분할/체결 반영 투자금 기준으로 계산되며, 비용을 차감한 순수익을 함께 보여줍니다.</div>
        <div className="cards-grid cols-3 mt-3">
          {scenarioRows.map((row) => (
            <div key={row.pct} className="card" style={{ padding: 'var(--space-3)' }}>
              <div className="caption">시나리오</div>
              <div className="title-md mt-1">+{row.pct}%</div>
              <div className="caption mt-2">총 수익: {formatKrw(row.gross)}</div>
              <div className={`title-md mt-1 ${row.net >= 0 ? 'positive' : 'negative'}`}>순수익 {row.net >= 0 ? '+' : ''}{formatKrw(row.net)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
