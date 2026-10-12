import type { AutoPickItem, AutoPickTier } from '../types'
import { defaultPlanItem, readSimulationPlan, saveSimulationPlan } from '../../simulator/planStore'
import { ANALYZE_PENDING_CODE_KEY, EXECUTION_GUIDE_PENDING_KEY } from '../constants'

export function navigateTo(route: string) {
  try {
    window.history.pushState({}, '', `/${route}`)
    window.dispatchEvent(new PopStateEvent('popstate'))
  } catch { /* ignore */ }
}

export const goAnalyze = (code: string) => {
  try { sessionStorage.setItem(ANALYZE_PENDING_CODE_KEY, code) } catch { /* ignore */ }
  navigateTo('analyze')
}

export const goExecutionGuide = (code: string) => {
  try {
    sessionStorage.setItem(
      EXECUTION_GUIDE_PENDING_KEY,
      JSON.stringify({ codes: [code], source: 'backtest' }),
    )
  } catch {
    // ignore
  }
  navigateTo('execution-guide')
}

export const goSimulator = (stock: { code: string; name: string }) => {
  const existing = readSimulationPlan()
  const newItem = defaultPlanItem(stock)
  const items = [...(existing?.items ?? []), newItem]
  saveSimulationPlan({
    ...(existing ?? { totalCapital: 0, notes: '' }), // 0이면 시뮬레이터가 내 시드로 채운다
    createdAt: Date.now(),
    items,
  })
  navigateTo('simulator')
}

export const addAutoPicksToSimulator = (autoPicks: AutoPickItem[], tiers: AutoPickTier[]) => {
  const targets = autoPicks.filter((row) => tiers.includes(row.tier))
  if (targets.length === 0) return

  const existing = readSimulationPlan()
  const prevItems = existing?.items ?? []
  const codeSet = new Set(prevItems.map((item) => String(item.code || '')))

  const newItems = targets
    .filter((row) => !codeSet.has(row.code))
    .map((row) => defaultPlanItem({ code: row.code, name: row.name }))

  if (newItems.length === 0) {
    navigateTo('simulator')
    return
  }

  saveSimulationPlan({
    ...(existing ?? { totalCapital: 0, notes: '' }), // 0이면 시뮬레이터가 내 시드로 채운다
    createdAt: Date.now(),
    items: [...prevItems, ...newItems],
  })
  navigateTo('simulator')
}
