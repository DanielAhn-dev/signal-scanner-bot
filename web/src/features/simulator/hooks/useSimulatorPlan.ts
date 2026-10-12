import { useEffect, useMemo, useState } from 'react'
import { useSeedCapital } from '../../../lib/useSeedCapital'
import { defaultPlanItem, readSimulationPlan, type HighlightPlanItem } from '../planStore'
import { calcPositionStatus, calcWeeklyCyclePlan } from '../telegramFormat'
import { calcItemMeta, calcScenarioRows, calcSummary } from '../lib/summary'

/** 작업 중인 계획(투자금·종목·비용 가정·메모)과 거기서 파생되는 계산 값 */
export function useSimulatorPlan(input: { fromSeedBuilder: boolean; proposedCapital: number }) {
  const { fromSeedBuilder, proposedCapital } = input
  const initialPlan = useMemo(() => readSimulationPlan(), [])
  const [totalCapital, setTotalCapital] = useState(fromSeedBuilder ? proposedCapital : initialPlan?.totalCapital || 10_000_000)
  // 집행우선·백테스트가 넘긴 종목으로 시작한다. 예전엔 "항상 빈 배열"이라 투자금만 넘어오고 종목은 버려져
  // 시뮬레이터가 비어 있었다(계획에 종목이 있으면 서버 불러오기도 건너뛰어 아무것도 안 보였다).
  const [items, setItems] = useState<HighlightPlanItem[]>(() => (Array.isArray(initialPlan?.items) ? initialPlan!.items : []))
  // 넘겨받은 계획에 투자금이 없으면 내 시드로 (1천만원 고정 대신)
  const seedCapital = useSeedCapital()
  useEffect(() => {
    if (!fromSeedBuilder && !(initialPlan?.totalCapital) && seedCapital) setTotalCapital(seedCapital)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedCapital])
  const [monthlyProfitTarget, setMonthlyProfitTarget] = useState(500_000) // 월 50만원 기본값
  const [fillRatePct, setFillRatePct] = useState(100)
  const [feePct, setFeePct] = useState(0.15)
  const [taxPct, setTaxPct] = useState(0.2)
  const [memo, setMemo] = useState(initialPlan?.notes || '')
  const [expandedIdx, setExpandedIdx] = useState<number | null>(0)

  const summary = useMemo(
    () => calcSummary({ items, fillRatePct, feePct, taxPct, totalCapital }),
    [items, fillRatePct, feePct, taxPct, totalCapital],
  )

  const scenarioRows = useMemo(
    () => calcScenarioRows(items, fillRatePct, feePct, taxPct),
    [items, fillRatePct, feePct, taxPct],
  )

  const itemMeta = useMemo(() => calcItemMeta(items, fillRatePct), [items, fillRatePct])

  const statusMeta = useMemo(() =>
    items.map((item) => calcPositionStatus(item)),
  [items])

  const weeklyPlan = useMemo(() =>
    calcWeeklyCyclePlan(items, monthlyProfitTarget, feePct, taxPct),
  [items, monthlyProfitTarget, feePct, taxPct])

  const updateItem = (idx: number, patch: Partial<HighlightPlanItem>) =>
    setItems((prev) => prev.map((row, i) => i === idx ? { ...row, ...patch } : row))

  /** 행을 추가하고 펼친다. 검색창 비우기는 호출한 쪽에서 한다. */
  const appendRow = (stock?: { code: string; name: string }) => {
    const newItem = defaultPlanItem(stock ?? { code: '', name: '' })
    setItems((prev) => [...prev, newItem])
    setExpandedIdx(items.length)
  }

  const removeRow = (idx: number) => {
    setItems((prev) => prev.filter((_, i) => i !== idx))
    if (expandedIdx === idx) setExpandedIdx(null)
    else if (expandedIdx !== null && expandedIdx > idx) setExpandedIdx(expandedIdx - 1)
  }

  return {
    initialPlan, totalCapital, setTotalCapital, items, setItems, monthlyProfitTarget, setMonthlyProfitTarget,
    fillRatePct, setFillRatePct, feePct, setFeePct, taxPct, setTaxPct, memo, setMemo, expandedIdx, setExpandedIdx,
    summary, scenarioRows, itemMeta, statusMeta, weeklyPlan, updateItem, appendRow, removeRow,
  }
}
