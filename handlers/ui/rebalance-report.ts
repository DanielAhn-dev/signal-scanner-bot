import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { denyIfUnauthorizedRead } from './_accessControl'
import { resolveUiUserContext } from './_userContext'
import { kstDateKey } from '../../src/services/virtualAutoTradeTiming'
import { loadGoalFile } from '../../src/services/goalTracker'
import { fetchGuidePrices, fetchYieldPctByCode, loadAccountPositionRows, loadGuideFile, loadGuidePlan, toGuideHoldings, withPlanOverseas } from '../../src/services/incomeGuideStore'
import { planMixLines } from '../../src/lib/planMixGuide'
import { fetchEtfKeyIndicators } from '../../src/services/etfKeyIndicator'
import { loadIndexAlternatives, toEtfYield } from '../../src/services/indexAlternatives'
import { fetchDropDayContext } from '../../src/services/dropDayContext'
import { isExchangeTradedProduct } from '../../src/lib/securitiesTax'
import { DEFAULT_INCOME_GUIDE_SETTINGS, buildIncomeGuideView } from '../../src/lib/incomeGuide'
import { buildRebalancePlan } from '../../src/lib/rebalancePlan'
import { buildRebalanceReport, type EtfYield } from '../../src/lib/rebalanceReport'
import { renderRebalanceReportHtml } from '../../src/services/rebalanceReportRender'

// 실계좌 리밸런싱 가이드 리포트 (계산 src/lib/rebalanceReport.ts, 렌더 src/services/rebalanceReportRender.ts)
//   GET            → { ok, data: { accounts: [{ key, label, total, holdingCount }] } }  리포트 화면의 계좌 선택용
//   GET ?account=키 → text/html 리포트 (주문하지 않는다, 기록도 남기지 않는다)
// 목표·인컴 하한은 리밸런싱 가이드(income-guide) 설정을 그대로 쓴다. 이 경로는 설정을 저장하지 않는다.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || process.env.UI_CORS_ORIGIN || '*'
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key,x-user-chat-id,Authorization')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (denyIfUnauthorizedRead(req, res)) return

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return res.status(500).json({ error: 'Server not configured' })
  const supabase = createClient(url, key, { auth: { persistSession: false } })

  const user = await resolveUiUserContext(req)
  const chatId = user.chatId
  if (!chatId) return res.status(400).json({ error: 'chat_id required' })

  try {
    const rows = await loadAccountPositionRows(supabase, chatId)
    const accountKey = String(req.query.account ?? '').trim()

    if (!accountKey) {
      // 계좌 목록은 시세 없이 매수가 기준 규모만 — 고르는 데만 쓴다
      const map = new Map<string, { key: string; label: string; total: number; holdingCount: number }>()
      for (const h of toGuideHoldings(rows, new Map()).holdings) {
        const a = map.get(h.accountKey) ?? { key: h.accountKey, label: h.accountLabel, total: 0, holdingCount: 0 }
        a.total += h.quantity * h.price
        a.holdingCount += 1
        map.set(h.accountKey, a)
      }
      const accounts = [...map.values()].sort((a, b) => b.total - a.total).map((a) => ({ ...a, total: Math.round(a.total) }))
      return res.status(200).json({ ok: true, data: { accounts } })
    }

    let file = await loadGuideFile(supabase, chatId)
    if (!file) {
      const goal = await loadGoalFile(supabase, chatId).catch(() => null)
      file = {
        settings: { ...DEFAULT_INCOME_GUIDE_SETTINGS, ...(goal?.settings.targetMonthlyProfit ? { monthlyNeed: goal.settings.targetMonthlyProfit } : {}) },
        history: [],
      }
    }
    const { prices, realtimeHits } = await fetchGuidePrices(supabase, rows.map((r) => r.code))
    const { holdings } = toGuideHoldings(rows, prices, realtimeHits)
    const today = kstDateKey()
    const pastCashPcts = (file.history ?? []).map((h) => h.groups?.find((g) => g.group === 'cash')?.actualPct ?? 0)
    // 가이드 화면과 같은 분배율(최근 12개월 실제값 → 없으면 가정)로 계산해야 월 인컴이 화면마다 갈리지 않는다
    const yieldPctByCode = await fetchYieldPctByCode(holdings)
    // 가이드 화면과 같은 해외 비중 목표(내 계획 구성이 있으면 그 값)
    const guidePlan = await loadGuidePlan(supabase, chatId).catch(() => null)
    file = { ...file, settings: withPlanOverseas(file.settings, guidePlan?.overseasPct ?? null) }
    const view = buildIncomeGuideView({ holdings, settings: file.settings, today, pastCashPcts, yieldPctByCode })
    // 같은 지수 상품 비교 — 가이드 화면과 같은 자료·같은 함수(indexProductChoice)라 살 곳이 화면마다 갈리지 않는다
    const indexAlt = await loadIndexAlternatives(supabase, view.holdings.filter((h) => h.group === 'growth').map((h) => ({ code: h.code, name: h.name })))
    const plan = buildRebalancePlan({ holdings: view.holdings, total: view.total, groups: view.groups, settings: file.settings, cashPlan: view.cashPlan, yieldPctByCode, today, etf: indexAlt.etf, feeAlternatives: indexAlt.alternatives })

    const etfCodes = holdings.filter((h) => h.accountKey === accountKey).filter((h) => isExchangeTradedProduct(h.code, h.name)).map((h) => h.code)
    const [etfMap, drop] = await Promise.all([
      fetchEtfKeyIndicators(etfCodes).catch(() => new Map()),
      fetchDropDayContext(null, null).catch(() => null),
    ])
    const etf = new Map<string, EtfYield>([...indexAlt.etf, ...[...etfMap.entries()].map(([code, k]) => [code, toEtfYield(k)] as const)])
    const baseInput = {
      view,
      plan,
      accountKey,
      etf,
      market: drop ? { asOf: drop.asOf, changePct: drop.changePct, fromHighPct: drop.fromHighPct } : null,
      // 매달 넣는 돈은 계좌별로 나뉘어 있지 않아, 가장 큰 계좌에만 붙인다
      monthlyContribution: view.accounts[0]?.key === accountKey ? file.settings.monthlyContribution : 0,
      // 내 계획 구성 — 이 계좌가 맡은 지수 몫을 한 줄로 (가이드 ①·홈 할 일과 같은 나누기)
      planMixLines: planMixLines({ mix: guidePlan?.mix, monthly: guidePlan?.monthly ?? 0, held: view.holdings.filter((h) => h.group === 'growth').map((h) => ({ code: h.code, name: h.name, accountKey: h.accountKey })) }),
    }
    const report = buildRebalanceReport({ ...baseInput, feeAlternatives: indexAlt.alternatives })
    if (!report) return res.status(404).json({ error: '이 계좌에 입력된 보유가 없습니다.' })

    const generatedAt = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false })
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Cache-Control', 'private, no-store')
    return res.status(200).send(renderRebalanceReportHtml(report, generatedAt))
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
