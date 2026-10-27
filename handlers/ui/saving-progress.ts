import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { denyIfUnauthorizedRead } from './_accessControl'
import { resolveUiUserContext } from './_userContext'
import { fetchYieldPctByCode, loadGuideFile } from '../../src/services/incomeGuideStore'
import { kstDateKey } from '../../src/services/virtualAutoTradeTiming'
import { fetchRealAccountValue } from '../../src/services/realAccountValue'
import { selectPaged } from '../../src/services/supabasePaging'
import { fetchDropDayContext } from '../../src/services/dropDayContext'
import { loadGoalFile, requiredSeed, DEFAULT_WITHDRAWAL_PCT } from '../../src/services/goalTracker'
import { readInvestPlan } from '../../src/services/userPlan'
import { BUCKET_GROUP, classifyHolding, isTaxAdvantagedAccount, resolveYieldPct } from '../../src/lib/incomeGuide'
import { annualDistribution } from '../../src/lib/incomeTarget'
import { loadIncomeCheck } from '../../src/services/incomeCheckService'
import { accountKind, distributionTaxSaved, dropMonths, isTotalReturnEtf } from '../../src/lib/savingProgress'
import { cashEffect, categoryById } from '../../src/lib/moneyFlow'
import { fetchKospiCloses } from '../../src/services/marketFlowCaution'

// 홈·모아가기 "내 모으기" (계산 src/lib/savingProgress.ts)
//   GET → { ok, data } 실계좌 원금·예수금·평가금, 순매수 있었던 달, 이번 달 실계좌 매수(monthBuys), 분배금 기록, 세금으로 아끼는 돈(추정), 목표, 내 계획, 시장 고점 대비
//         + 고정비 사다리 재료(가계부 고정지출·인출률·이번 달 순매수), 코스피가 10% 넘게 빠졌던 달
// 읽기만 한다. 체크인(이번 달 넣었어요)은 웹의 user-state 'accumulate'.deposits에 저장한다.

/** 같은 지수 일반형 분배율을 TR형 절세 추정에 쓴다 */
const UNDERLYING_INDEX = { code: '069500', name: 'KODEX 200' }

/** KST 'YYYY-MM' */
function kstYm(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return String(iso).slice(0, 7)
  return new Date(t + 9 * 3_600_000).toISOString().slice(0, 7)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || process.env.UI_CORS_ORIGIN || '*'
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key,x-user-chat-id,x-user-client-id,Authorization')
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
  if (!chatId && !user.clientId) return res.status(400).json({ error: 'identity required' })

  try {
    // 실계좌 보유 — 원금(매수가 × 수량)과 평가금. 목표 트래커와 같은 계산(src/services/realAccountValue.ts)
    const guide = chatId ? await loadGuideFile(supabase, chatId) : null
    const real = chatId ? await fetchRealAccountValue(supabase, chatId, { guide }) : null
    const holdings = real?.guideHoldings ?? []
    const cash = real?.cash ?? 0
    const cost = real?.cost ?? 0
    const value = real?.holdings ?? 0

    // 순매수가 있었던 달 — 수량 고침(ADJUST)은 넣은 돈이 아니라 빼고, 매수 − 매도 > 0인 달만
    const owner = [user.clientId ? `client_id.eq.${user.clientId}` : null, chatId ? `chat_id.eq.${chatId}` : null].filter(Boolean).join(',')
    const trades = await selectPaged<{ side: string; price: number; quantity: number; traded_at: string; code: string; broker_name: string | null; account_name: string | null; memo: string | null }>(
      async (from, to) =>
        await supabase
          .from('virtual_trades')
          .select('side, price, quantity, traded_at, code, broker_name, account_name, memo')
          .or(owner)
          .not('account_name', 'is', null)
          .in('side', ['BUY', 'SELL'])
          .order('traded_at', { ascending: true })
          .range(from, to),
      { logLabel: 'savingProgress.trades' },
    )
    const netByMonth = new Map<string, number>()
    for (const t of trades) {
      const amount = Number(t.price) * Number(t.quantity)
      if (!Number.isFinite(amount)) continue
      const ym = kstYm(t.traded_at)
      netByMonth.set(ym, (netByMonth.get(ym) ?? 0) + (t.side === 'BUY' ? amount : -amount))
    }
    const buyMonths = [...netByMonth.entries()].filter(([, v]) => v > 0).map(([ym]) => ym).sort()
    // 이번 달 실계좌 매수 — 홈 '이번 달 할 일'이 포트폴리오에서 먼저 적은 매수를 알아보고 중복 기록을 막는다
    const thisYm = kstYm(new Date().toISOString())
    const monthBuys = trades
      .filter((t) => t.side === 'BUY' && kstYm(t.traded_at) === thisYm)
      .map((t) => ({ code: t.code, quantity: Number(t.quantity), price: Number(t.price), tradedAt: t.traded_at, broker: t.broker_name, account: t.account_name, memo: t.memo }))

    // 분배금 받은 기록(리밸런싱 가이드에서 적은 것)
    const receipts = guide?.receipts ?? []
    const receiptMonths = [...new Set(receipts.map((r) => r.month))].sort()
    const receiptTotal = receipts.reduce((s, r) => s + (r.net ?? Math.round(r.quantity * r.perShare * 0.846)), 0)

    // 세금으로 아끼는 돈 — 예산의 연금 저축(월) × 12, 계좌별 분배금 세금
    let pensionMonthly: number | null = null
    // 고정비 사다리 — 가계부(예산) 고정지출. 조회 실패면 null(화면이 사다리를 숨긴다), 기록이 없으면 []
    let fixedCosts: Array<{ label: string; amount: number }> | null = user.clientId ? null : []
    if (user.clientId) {
      const { data: check, error: checkError } = await supabase
        .from('money_flow_checks')
        .select('input, checked_on')
        .eq('client_id', user.clientId)
        .order('checked_on', { ascending: false })
        .limit(1)
        .maybeSingle()
      // 조회 실패는 "없음"이 아니다 — null로 두고 화면이 "불러오지 못함"으로 보여 준다
      if (!checkError) {
        const saving = Array.isArray((check as any)?.input?.saving) ? (check as any).input.saving : []
        pensionMonthly = saving.filter((i: any) => i?.categoryId === 'save_pension').reduce((s: number, i: any) => s + Math.max(0, Number(i?.amount) || 0), 0)
        const fixed = Array.isArray((check as any)?.input?.fixed) ? (check as any).input.fixed : []
        fixedCosts = fixed
          .map((i: any) => ({ label: String(i?.label || categoryById(String(i?.categoryId))?.label || '').trim(), amount: cashEffect({ amount: Number(i?.amount) || 0, payment: i?.payment }) }))
          .filter((i: { label: string; amount: number }) => i.label && i.amount > 0)
      }
    }
    const [yieldPctByCode, underlying] = await Promise.all([
      fetchYieldPctByCode(holdings, undefined, { supabase, today: kstDateKey() }).catch(() => ({})),
      fetchYieldPctByCode([UNDERLYING_INDEX]).catch(() => ({})),
    ])
    const underlyingYield = (underlying as Record<string, number>)[UNDERLYING_INDEX.code] ?? null
    const taxHoldings = holdings.map((h) => {
      const bucket = classifyHolding(h.code, h.name)
      return {
        value: h.quantity * h.price,
        accountKind: accountKind(h.accountLabel),
        isTR: isTotalReturnEtf(h.name),
        yieldPct: resolveYieldPct(h.code, bucket, h.name, yieldPctByCode).pct,
      }
    })
    const distTax = distributionTaxSaved(taxHoldings, underlyingYield)
    const kinds = new Set(taxHoldings.map((h) => h.accountKind))

    // 인컴 목표 — 계좌별 연 분배금(세전)과, 고정비 사다리가 있을 때만 일반 계좌 인컴 상품 점검(네트워크를 쓰므로 필요할 때만)
    const distribution = annualDistribution(taxHoldings)
    // 일반 계좌 인컴 원금 — 구성 비교의 "지금 원금". 분배금을 바로 꺼내 쓸 수 있는 계좌만 센다
    const generalIncomeCapital = Math.round(
      holdings
        .filter((h) => h.code !== 'CASH' && h.quantity > 0 && h.price > 0 && !isTaxAdvantagedAccount(h.accountLabel) && BUCKET_GROUP[classifyHolding(h.code, h.name, h.productType)] === 'income')
        .reduce((s, h) => s + h.quantity * h.price, 0),
    )
    const incomeCheck = fixedCosts && fixedCosts.length > 0
      ? await loadIncomeCheck({
          supabase,
          holdings: holdings
            .filter((h) => h.quantity > 0 && h.price > 0 && h.code !== 'CASH')
            .map((h) => {
              const bucket = classifyHolding(h.code, h.name, h.productType)
              return { code: h.code, name: h.name, price: h.price, value: h.quantity * h.price, group: BUCKET_GROUP[bucket], bucket, accountLabel: h.accountLabel }
            }),
          yieldPctByCode: yieldPctByCode as Record<string, number>,
          today: kstDateKey(),
        }).catch(() => [])
      : []

    // 목표(목표 트래커에서 정한 월 인출 목표가 있을 때만)
    const goalFile = chatId ? await loadGoalFile(supabase, Number(chatId)).catch(() => null) : null
    const goalSeed = goalFile?.settings?.targetMonthlyProfit
      ? requiredSeed(goalFile.settings.targetMonthlyProfit, goalFile.settings.withdrawalPct ?? DEFAULT_WITHDRAWAL_PCT)
      : null

    // 내 계획 — 매달 넣을 돈·넣는 날
    let plan: { monthly: number; depositDay: number } | null = null
    if (chatId) {
      const { data: u } = await supabase.from('users').select('prefs').eq('tg_id', chatId).maybeSingle()
      const p = readInvestPlan(((u as any)?.prefs ?? {}) as Record<string, unknown>)
      plan = { monthly: p.monthly, depositDay: p.depositDay }
    }

    const [drop, kospi] = await Promise.all([
      fetchDropDayContext(null, null).catch(() => null),
      fetchKospiCloses(7).catch(() => new Map<string, number>()),
    ])
    // 빠진 달 — 홈 하락 안내와 같은 기준(최근 60거래일 고점 대비 −10%)
    const drops = dropMonths([...kospi.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, close]) => ({ date, close })))

    return res.status(200).json({
      ok: true,
      data: {
        principal: { cost: Math.round(cost), cash: Math.round(cash), total: Math.round(cost + cash) },
        value: { holdings: Math.round(value), total: Math.round(value + cash), pnlPct: cost > 0 ? ((value - cost) / cost) * 100 : null },
        holdingCount: holdings.length,
        buyMonths,
        monthBuys,
        receipts: { total: Math.round(receiptTotal), months: receiptMonths.length, since: receiptMonths[0] ?? null },
        tax: {
          pensionMonthly,
          distribution: distTax,
          underlyingYieldPct: underlyingYield,
          accountKinds: [...kinds],
        },
        goal: goalSeed && Number.isFinite(goalSeed) ? { requiredSeed: Math.round(goalSeed), monthlyNeed: goalFile!.settings.targetMonthlyProfit } : null,
        plan,
        market: drop ? { asOf: drop.asOf, fromHighPct: drop.fromHighPct } : null,
        dropMonths: drops.since ? drops : null,
        income: { distribution, generalIncomeCapital, check: incomeCheck },
        ladder: {
          fixed: fixedCosts,
          withdrawalPct: goalFile?.settings?.withdrawalPct ?? DEFAULT_WITHDRAWAL_PCT,
          addedThisMonth: Math.max(0, Math.round(netByMonth.get(thisYm) ?? 0)),
        },
      },
    })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
