import type { GuideRow, RiskMode } from '../types'
import { decodeHeadlineText, formatDateRangeLabel, normalizeNewsSource, normalizeNewsUrl } from './news'
import { applyRiskMode, parseHoldDays } from './risk'

/**
 * 종목 조회(stock-latest)·뉴스 응답으로 가이드 행 하나를 만든다. 수량 = ⌊예산 ÷ 진입 기준가⌋,
 * 1회 주문 = 수량×기준가 ÷ 분할 횟수. 손절·목표는 위험 성향 계수로 보정한다.
 */
export function buildGuideRow(input: {
  code: string
  stockRes: any
  newsRes: any
  includeNews: boolean
  riskMode: RiskMode
  budgetPerName: number
  slots: number
}): GuideRow {
  const { code, stockRes, newsRes, includeNews, riskMode, budgetPerName, slots } = input
  const merged = { ...(stockRes.profile || {}), ...(stockRes.latest || {}) }
  const advisor = stockRes.advisor || {}

  let headlines: string[] = []
  let headlineLinks: Array<{ title: string; url: string | null; source: string | null }> = []
  if (includeNews) {
    headlineLinks = Array.isArray(newsRes?.data)
      ? newsRes.data
        .map((item: any) => {
          const title = decodeHeadlineText(String(item?.title || ''))
          const url = normalizeNewsUrl(item?.originallink ?? item?.link ?? item?.url)
          const source = normalizeNewsSource(item?.source ?? item?.press ?? item?.officeName ?? item?.publisher ?? item?.media)
          return { title, url, source }
        })
        .filter((item: { title: string }) => Boolean(item.title))
        .slice(0, 3)
      : []
    headlines = headlineLinks.map((item) => item.title)
  }

  const marketDataDate = formatDateRangeLabel([
    stockRes?.latest?.trade_date,
    stockRes?.profile?.indicators_as_of,
    stockRes?.data?.[0]?.trade_date,
    stockRes?.data?.[0]?.date,
    stockRes?.flow?.date,
    stockRes?.profile?.updated_at,
  ])
  const newsDataDate = includeNews
    ? formatDateRangeLabel(
      (Array.isArray(newsRes?.data) ? newsRes.data : []).slice(0, 3).flatMap((item: any) => [
        item?.pubDate,
        item?.published_at,
        item?.publishedAt,
        item?.datetime,
        item?.date,
      ])
    )
    : null

  const entryLow = Number.isFinite(Number(advisor.entryLow)) ? Number(advisor.entryLow) : null
  const entryHigh = Number.isFinite(Number(advisor.entryHigh)) ? Number(advisor.entryHigh) : null
  const entryRef = entryLow != null && entryHigh != null
    ? Math.round((entryLow + entryHigh) / 2)
    : (Number.isFinite(Number(merged.close)) ? Number(merged.close) : null)

  const stopPriceRaw = Number.isFinite(Number(advisor.stopPrice)) ? Number(advisor.stopPrice) : null
  const target1Raw = Number.isFinite(Number(advisor.target1)) ? Number(advisor.target1) : null
  const target2Raw = Number.isFinite(Number(advisor.target2)) ? Number(advisor.target2) : null

  const stopPrice = applyRiskMode(stopPriceRaw, riskMode, 'stop')
  const target1 = applyRiskMode(target1Raw, riskMode, 'target')
  const target2 = applyRiskMode(target2Raw, riskMode, 'target')

  const qty = entryRef && entryRef > 0 ? Math.max(0, Math.floor(budgetPerName / entryRef)) : 0
  const firstOrderAmount = entryRef && qty > 0
    ? Math.round((qty * entryRef) / slots)
    : 0

  return {
    code,
    name: String(merged.name || code),
    score: Number.isFinite(Number(advisor.finalScore)) ? Number(advisor.finalScore) : null,
    statusLabel: advisor.statusLabel ? String(advisor.statusLabel) : null,
    summary: advisor.summary ? decodeHeadlineText(String(advisor.summary)) : null,
    entryLow,
    entryHigh,
    entryRef,
    stopPrice,
    target1,
    target2,
    target1Pct: Number.isFinite(Number(advisor.target1Pct)) ? Number(advisor.target1Pct) : null,
    target2Pct: Number.isFinite(Number(advisor.target2Pct)) ? Number(advisor.target2Pct) : null,
    holdDays: parseHoldDays(advisor.holdDays),
    riskReward: Number.isFinite(Number(advisor.riskReward)) ? Number(advisor.riskReward) : null,
    warnings: Array.isArray(advisor.warnings)
      ? advisor.warnings.map((w: any) => decodeHeadlineText(String(w))).slice(0, 2)
      : [],
    headlines: headlines.map(decodeHeadlineText),
    headlineLinks,
    marketDataDate,
    newsDataDate,
    plannedBudget: budgetPerName,
    qty,
    firstOrderAmount,
  } satisfies GuideRow
}
