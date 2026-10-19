import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { denyIfUnauthorizedRead } from './_accessControl'
import { resolveUiUserContext } from './_userContext'
import { loadAccountPositionRows } from '../../src/services/incomeGuideStore'
import { fetchEtfTopHoldings, loadThemeDays, loadThemeMeta } from '../../src/services/marketThemeStore'
import { fetchNaverCloses } from '../../src/services/coreProfiles'
import {
  BASELINE_DAYS,
  EVIDENCE_RULES,
  RECENT_DAYS,
  evaluateEvidence,
  linkHoldingToThemes,
  priceTrend,
  themeStats,
  type HoldingWeight,
  type PriceTrend,
  type ThemeDay,
} from '../../src/lib/themeFlow'

// 웹 '오늘 시장' — 내 보유와 이어진 테마의 지금 근거 (계산 src/lib/themeFlow.ts)
//   GET → { data: { asOf, holdings: [...], rules } }
// 보유는 실계좌 입력 행만. ETF는 네이버 상위 10 구성으로 테마에 잇는다. 매도·매수 권유가 아니라 현황 표시다.

/** 평가금 큰 순서로 이만큼만 (네이버 호출 수 제한) */
const MAX_HOLDINGS = 8
/** 200거래일 + 여유 */
const PRICE_CALENDAR_DAYS = 320

type Row = { code: string; quantity: number; buy_price: number | null; stock: { name?: string; close?: number } | Array<{ name?: string; close?: number }> | null }

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null)

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
  if (!user.chatId && !user.clientId) return res.status(400).json({ error: 'identity required' })
  res.setHeader('Cache-Control', 'private, no-store')

  try {
    const rows = (user.chatId ? await loadAccountPositionRows(supabase, user.chatId) : []) as Row[]
    // 같은 종목이 여러 계좌에 있으면 합친다
    const byCode = new Map<string, { code: string; name: string; value: number }>()
    for (const r of rows) {
      const s = one(r.stock)
      const px = Number(s?.close) || Number(r.buy_price) || 0
      const cur = byCode.get(r.code) ?? { code: r.code, name: s?.name || r.code, value: 0 }
      cur.value += Number(r.quantity) * px
      byCode.set(r.code, cur)
    }
    const holdings = [...byCode.values()].sort((a, b) => b.value - a.value).slice(0, MAX_HOLDINGS)
    if (!holdings.length) return res.status(200).json({ data: { asOf: null, holdings: [], rules: EVIDENCE_RULES, themeError: null } })

    // 테마 기록이 아직 없거나(마이그레이션 037 전) 조회가 실패해도 가격 흐름은 보여 준다 — themeError로 알린다
    let themeError: string | null = null
    const meta = await loadThemeMeta(supabase).catch((e) => {
      themeError = e instanceof Error ? e.message : String(e)
      return []
    })
    const since = new Date(Date.now() - PRICE_CALENDAR_DAYS * 86_400_000).toISOString().slice(0, 10)
    const enriched = await Promise.all(
      holdings.map(async (h) => {
        const [etf, closes] = await Promise.all([
          fetchEtfTopHoldings(h.code),
          fetchNaverCloses(h.code, since).catch(() => null),
        ])
        const weights: HoldingWeight[] = etf?.weights.length ? etf.weights : [{ code: h.code, name: h.name, weight: 1 }]
        const links = linkHoldingToThemes(weights, meta)
        const price: PriceTrend | null = closes && closes.length ? priceTrend(closes.map((b) => b.close)) : null
        return { ...h, isEtf: !!etf, category: etf?.category ?? null, topWeightCovered: etf ? etf.weights.reduce((a, w) => a + w.weight, 0) : null, links, price }
      })
    )

    const themeNos = [...new Set(enriched.flatMap((h) => h.links.map((l) => l.themeNo)))]
    const daysSince = new Date(Date.now() - (RECENT_DAYS + BASELINE_DAYS) * 2 * 86_400_000).toISOString().slice(0, 10)
    const days = themeNos.length
      ? await loadThemeDays(supabase, { sinceDate: daysSince, themeNos }).catch((e) => {
          themeError = e instanceof Error ? e.message : String(e)
          return [] as ThemeDay[]
        })
      : []
    const byTheme = new Map<number, ThemeDay[]>()
    for (const d of days) byTheme.set(d.themeNo, [...(byTheme.get(d.themeNo) ?? []), d])
    for (const list of byTheme.values()) list.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))
    const asOf = days.reduce((m, d) => (d.tradeDate > m ? d.tradeDate : m), '') || null

    const out = enriched.map((h) => {
      const primary = h.links[0] ?? null
      const list = primary ? byTheme.get(primary.themeNo) ?? [] : []
      const stats = themeStats(list)
      const evidence = evaluateEvidence({ price: h.price, theme: stats })
      return {
        code: h.code,
        name: h.name,
        isEtf: h.isEtf,
        category: h.category,
        topWeightCovered: h.topWeightCovered,
        price: h.price,
        links: h.links.map((l) => ({ themeNo: l.themeNo, name: l.name, overlap: l.overlap, matched: l.matched.map((m) => m.name) })),
        primaryTheme: primary ? { themeNo: primary.themeNo, name: primary.name, stats, news: list[list.length - 1]?.news ?? [] } : null,
        evidence,
      }
    })
    return res.status(200).json({ data: { asOf, holdings: out, rules: EVIDENCE_RULES, themeError } })
  } catch (e) {
    return res.status(503).json({ error: `보유 테마 조회 실패: ${e instanceof Error ? e.message : String(e)}` })
  }
}
