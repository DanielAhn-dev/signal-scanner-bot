import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createDailyCandidatePlanningReportResult } from './marketInsightService'
import { getUserInvestmentPrefs } from './userService'
import { createWeeklyReportPdf } from './weeklyReportService'
import { fetchRealtimePriceBatch } from '../utils/fetchRealtimePrice'
import { buildCandidateCardsWebHtml, buildConvictionWebHtml, buildPortfolioWebHtml, buildPublicCandidateWebHtml, buildPullbackWebHtml, buildStructuredWeeklyWebHtml, buildWatchOnlyWebHtml, HTML_BODY_PREFIX } from './reportWebRenderService'
import { selectForecastsForTopic } from './reportTopicForecasts'

export type ReportTopic =
  | '추천'
  | '확신추천'
  | '공개추천'
  | '실행가이드'
  | '가이드'
  | '자동매매'
  | '주간'
  | '눌림목'
  | '포트폴리오'
  | '관심종목'
  | '거시'
  | '수급'
  | '섹터'

export const REPORT_SNAPSHOT_TABLE = 'ui_report_snapshots'

export function resolveReportTopic(raw: unknown): ReportTopic {
  const v = String(raw || '').trim().toLowerCase()
  if (v === '확신추천' || v === '확실추천' || v === '핵심추천' || v === 'conviction') return '확신추천'
  if (v === '공개추천' || v === 'public') return '공개추천'
  if (v === '실행가이드' || v === '실행 가이드' || v === 'execution-guide' || v === 'execution_guide' || v === 'executionguide') return '실행가이드'
  if (v === '가이드' || v === 'guide') return '가이드'
  if (v === '자동매매' || v === 'auto-guide') return '자동매매'
  if (v === '주간' || v === 'full' || v === 'weekly') return '주간'
  if (v === '눌림목' || v === 'pullback') return '눌림목'
  if (v === '포트폴리오' || v === 'portfolio' || v === 'watchlist') return '포트폴리오'
  if (v === '관심종목' || v === '관심' || v === 'watchonly' || v === 'watch') return '관심종목'
  if (v === '거시' || v === '경제' || v === 'macro' || v === 'economy') return '거시'
  if (v === '수급' || v === 'flow') return '수급'
  if (v === '섹터' || v === 'sector') return '섹터'
  return '추천'
}

export function parseChatId(value: unknown): number | null {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.floor(n)
}

export function isGuideTopic(topic: ReportTopic): boolean {
  return topic === '가이드' || topic === '자동매매'
}

export function getKstDateKey(now = new Date()): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const year = kst.getUTCFullYear()
  const month = String(kst.getUTCMonth() + 1).padStart(2, '0')
  const day = String(kst.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function buildAudienceKey(input: number | null | { chatId?: number | null; clientId?: string | null }): string {
  if (typeof input === 'object' && input !== null) {
    const clientId = String(input.clientId || '').trim()
    if (clientId) return `client:${clientId}`
    const chatId = Number(input.chatId ?? 0)
    if (Number.isFinite(chatId) && chatId > 0) return `chat:${Math.trunc(chatId)}`
    return 'anon'
  }
  const chatId = Number(input ?? 0)
  if (Number.isFinite(chatId) && chatId > 0) return `chat:${Math.trunc(chatId)}`
  return 'anon'
}

export function createSupabaseServiceClientFromEnv(): SupabaseClient {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing')
  }
  return createClient(url, key)
}

export async function getPersistedReportBody(params: {
  supabase: SupabaseClient
  topic: ReportTopic
  audienceKey: string
  reportDate: string
}): Promise<{ bodyText: string; sourceLabel: string } | null> {
  const { supabase, topic, audienceKey, reportDate } = params

  try {
    const { data, error } = await supabase
      .from(REPORT_SNAPSHOT_TABLE)
      .select('body_text,source_label')
      .eq('topic', topic)
      .eq('audience_key', audienceKey)
      .eq('report_date', reportDate)
      .maybeSingle()

    if (error || !data?.body_text) return null

    return {
      bodyText: String(data.body_text || ''),
      sourceLabel: String(data.source_label || '/리포트 명령 결과(스냅샷)'),
    }
  } catch {
    return null
  }
}

export async function saveReportBodySnapshot(params: {
  supabase: SupabaseClient
  topic: ReportTopic
  audienceKey: string
  reportDate: string
  bodyText: string
  sourceLabel: string
}): Promise<void> {
  const { supabase, topic, audienceKey, reportDate, bodyText, sourceLabel } = params

  try {
    await supabase.from(REPORT_SNAPSHOT_TABLE).upsert(
      {
        topic,
        audience_key: audienceKey,
        report_date: reportDate,
        body_text: bodyText,
        source_label: sourceLabel,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'topic,audience_key,report_date' }
    )
  } catch {
    // Snapshot persistence is best-effort and should not break report generation.
  }
}

function resolveGuideMarkdownPath(topic: ReportTopic): string {
  if (topic === '자동매매') {
    return path.join(process.cwd(), 'docs', 'automate-trade-command-guide.md')
  }
  return path.join(process.cwd(), 'docs', 'user-operating-guide.md')
}

const WEEKLY_REPORT_TOPIC_MAP: Partial<Record<ReportTopic, string>> = {
  주간: 'full',
  눌림목: 'pullback',
  포트폴리오: 'portfolio',
  관심종목: 'watchonly',
  거시: 'economy',
  수급: 'flow',
  섹터: 'sector',
}

type WatchlistSnapshotRow = {
  code?: string | null
  buy_price?: number | null
  buy_date?: string | null
  created_at?: string | null
  quantity?: number | null
  status?: string | null
  memo?: string | null
  stock?:
    | {
        name?: string | null
        close?: number | null
      }
    | Array<{
        name?: string | null
        close?: number | null
      }>
    | null
}

function unwrapJoinedStock(value: WatchlistSnapshotRow['stock']) {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

function toFiniteNumber(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

async function buildWatchOnlyWebItems(supabase: SupabaseClient, chatId: number | null): Promise<Array<{
  code: string
  name: string
  status?: string | null
  buyPrice?: number | null
  currentPrice?: number | null
  changePct?: number | null
  addedAt?: string | null
  memo?: string | null
}>> {
  if (!chatId || chatId <= 0) return []

  const { data } = await supabase
    .from('virtual_positions')
    .select('code,buy_price,buy_date,created_at,quantity,status,memo,stock:stocks(name,close)')
    .eq('chat_id', chatId)
    .order('created_at', { ascending: false })
    .limit(120)

  const rows = (data ?? []) as WatchlistSnapshotRow[]
  if (!rows.length) return []

  const codes = [...new Set(rows.map((row) => String(row.code || '').trim()).filter(Boolean))]
  let realtimeMap: Record<string, { price?: number }> = {}
  if (codes.length) {
    try {
      realtimeMap = await fetchRealtimePriceBatch(codes)
    } catch {
      realtimeMap = {}
    }
  }

  return rows
    .map((row) => {
      const stock = unwrapJoinedStock(row.stock)
      const code = String(row.code || '').trim()
      const qty = Math.max(0, Math.floor(toFiniteNumber(row.quantity) ?? 0))
      if (!code || qty > 0) return null
      const buyPrice = toFiniteNumber(row.buy_price)
      const realtimePrice = toFiniteNumber(realtimeMap[code]?.price)
      const closePrice = toFiniteNumber(stock?.close)
      const currentPrice = realtimePrice && realtimePrice > 0
        ? realtimePrice
        : closePrice && closePrice > 0
          ? closePrice
          : null
      const changePct = buyPrice && currentPrice
        ? ((currentPrice - buyPrice) / buyPrice) * 100
        : null

      return {
        code,
        name: String(stock?.name || code),
        status: row.status || null,
        buyPrice,
        currentPrice,
        changePct,
        addedAt: row.created_at || row.buy_date || null,
        memo: row.memo || null,
      }
    })
    .filter((item): item is {
      code: string
      name: string
      status: string | null
      buyPrice: number | null
      currentPrice: number | null
      changePct: number | null
      addedAt: string | null
      memo: string | null
    } => Boolean(item))
}

export async function buildReportBodyText(params: {
  topic: ReportTopic
  chatId: number | null
  supabase?: SupabaseClient
}): Promise<{ bodyText: string; sourceLabel: string }> {
  const { topic, chatId, supabase } = params
  const t0 = Date.now()
  const log = (step: string) => {
    if (process.env.NODE_ENV !== 'production') {
      console.log(JSON.stringify({ scope: 'report_web', step, topic, duration_ms: Date.now() - t0, ts: new Date().toISOString() }))
    }
  }

  if (isGuideTopic(topic)) {
    const fullPath = resolveGuideMarkdownPath(topic)
    const bodyText = await readFile(fullPath, 'utf8')
    log('guide_file_read')
    return {
      bodyText,
      sourceLabel: path.basename(fullPath),
    }
  }

  if (topic === '실행가이드') {
    log('execution_guide_snapshot_missing')
    return {
      bodyText: [
        '<b>실행 가이드 스냅샷이 없습니다.</b>',
        '─────────────────',
        '실행가이드 화면에서 자동 후보를 선택하고 가이드 생성 후,',
        '리포트 페이지에서 PDF/웹 공유를 다시 실행해 주세요.',
      ].join('\n'),
      sourceLabel: '/실행가이드 스냅샷 미존재',
    }
  }

  if (!supabase) {
    throw new Error('Supabase client is required for 추천/공개추천 generation')
  }

  const riskProfile = chatId
    ? ((await getUserInvestmentPrefs(chatId)).risk_profile ?? 'safe') as 'safe' | 'balanced' | 'active'
    : 'balanced'
  log('risk_profile')

  const report = await createDailyCandidatePlanningReportResult(supabase, {
    riskProfile,
    chatId: chatId ?? undefined,
    fixedDisplayLimit: 5,
    forecastPoolLimit: 15,
    excludeHoldingCodes: true,
  })
  log('candidate_report')
  const dailyForecasts = selectForecastsForTopic('추천', report.forecasts)
  const convictionForecasts = selectForecastsForTopic('확신추천', report.forecasts)
  const publicForecasts = selectForecastsForTopic('공개추천', report.forecasts)

  const baseText = report.text || ''

  if (topic === '확신추천') {
    log('done')
    return {
      bodyText: HTML_BODY_PREFIX + buildConvictionWebHtml(convictionForecasts),
      sourceLabel: '/리포트 명령 결과',
    }
  }

  if (topic === '추천') {
    log('done')
    return {
      bodyText: HTML_BODY_PREFIX + buildCandidateCardsWebHtml({
        forecasts: dailyForecasts,
        title: '오늘의 후보 리포트 · 우선 점검 카드',
        subtitle: '눌림목·점수·리스크를 종합해 오늘 바로 볼 후보를 신뢰도 순으로 정렬했습니다.',
        note: '상위 1~2개에 우선 집중하고 추격보다 분할 진입을 기본으로 운용하세요.',
        limit: 8,
      }),
      sourceLabel: '/리포트 명령 결과',
    }
  }

  if (topic === '공개추천') {
    log('done')
    return {
      bodyText: HTML_BODY_PREFIX + buildPublicCandidateWebHtml({
        forecasts: publicForecasts,
        title: '공유용 오늘의 후보 리포트',
        subtitle: '개인 보유/자금 정보는 제외하고 후보 핵심 지표만 공개용으로 구성했습니다.',
        note: '공유용 리포트는 참고 자료이며 최종 투자 판단은 본인 책임입니다.',
        limit: 6,
      }),
      sourceLabel: '/리포트 명령 결과',
    }
  }

  if (WEEKLY_REPORT_TOPIC_MAP[topic]) {
    // webOnly: true — PDF 렌더(폰트 로딩·pdf-lib 생성, ~1-2초)를 건너뛰고
    // 데이터 조회 + summary/caption 빌드만 수행해 웹 미리보기 응답을 빠르게 반환
    const weekly = await createWeeklyReportPdf(supabase, {
      chatId: chatId ?? 999999,
      topic: WEEKLY_REPORT_TOPIC_MAP[topic],
      webOnly: true,
    })
    log('weekly_data')

    if (topic === '눌림목') {
      log('done')
      return {
        bodyText: HTML_BODY_PREFIX + buildPullbackWebHtml({
          title: weekly.title,
          summaryText: weekly.summaryText,
          caption: weekly.caption,
          candidates: weekly.pullbackCandidates ?? [],
          meta: weekly.pullbackMeta ?? null,
        }),
        sourceLabel: '/리포트 명령 결과',
      }
    }

    if (topic === '관심종목') {
      const watchOnlyItems = await buildWatchOnlyWebItems(supabase, chatId)
      log('done')
      return {
        bodyText: HTML_BODY_PREFIX + buildWatchOnlyWebHtml({
          title: weekly.title,
          summaryText: weekly.summaryText,
          caption: weekly.caption,
          items: watchOnlyItems,
        }),
        sourceLabel: '/리포트 명령 결과',
      }
    }

    if (topic === '포트폴리오') {
      log('done')
      return {
        bodyText: HTML_BODY_PREFIX + buildPortfolioWebHtml({
          title: weekly.title,
          summaryText: weekly.summaryText,
          caption: weekly.caption,
          items: (weekly.portfolioItems ?? []).map(i => ({
            code: i.code,
            name: i.name,
            qty: i.qty,
            buyPrice: i.buyPrice,
            currentPrice: i.currentPrice,
            invested: i.invested,
            unrealized: i.unrealized,
            pnlPct: i.pnlPct,
            targetHorizon: i.targetHorizon,
            plannedReviewAt: i.plannedReviewAt,
          })),
        }),
        sourceLabel: '/리포트 명령 결과',
      }
    }

    log('done')
    return {
      bodyText: HTML_BODY_PREFIX + buildStructuredWeeklyWebHtml({
        title: weekly.title,
        topic,
        summaryText: weekly.summaryText,
        caption: weekly.caption,
        payload: weekly.webPayload ?? null,
      }),
      sourceLabel: '/리포트 명령 결과',
    }
  }

  log('done')
  return {
    bodyText: baseText,
    sourceLabel: '/리포트 명령 결과',
  }
}
