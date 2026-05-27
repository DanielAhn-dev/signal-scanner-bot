import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createDailyCandidatePlanningReportResult } from './marketInsightService'
import { getUserInvestmentPrefs } from './userService'
import { createWeeklyReportPdf } from './weeklyReportService'
import { buildCandidateCardsWebHtml, buildConvictionWebHtml, HTML_BODY_PREFIX } from './reportWebRenderService'

export type ReportTopic =
  | '추천'
  | '확신추천'
  | '공개추천'
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

export function buildAudienceKey(chatId: number | null): string {
  return chatId ? `chat:${chatId}` : 'anon'
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
  포트폴리오: 'portfolio',
  관심종목: 'watchonly',
  거시: 'economy',
  수급: 'flow',
  섹터: 'sector',
}

export async function buildReportBodyText(params: {
  topic: ReportTopic
  chatId: number | null
  supabase?: SupabaseClient
}): Promise<{ bodyText: string; sourceLabel: string }> {
  const { topic, chatId, supabase } = params

  if (isGuideTopic(topic)) {
    const fullPath = resolveGuideMarkdownPath(topic)
    const bodyText = await readFile(fullPath, 'utf8')
    return {
      bodyText,
      sourceLabel: path.basename(fullPath),
    }
  }

  if (!supabase) {
    throw new Error('Supabase client is required for 추천/공개추천 generation')
  }

  const riskProfile = chatId
    ? ((await getUserInvestmentPrefs(chatId)).risk_profile ?? 'safe') as 'safe' | 'balanced' | 'active'
    : 'balanced'

  const report = await createDailyCandidatePlanningReportResult(supabase, {
    riskProfile,
    chatId: chatId ?? undefined,
  })

  const baseText = report.text || ''

  if (topic === '확신추천') {
    return {
      bodyText: HTML_BODY_PREFIX + buildConvictionWebHtml(report.forecasts),
      sourceLabel: '/리포트 명령 결과',
    }
  }

  if (topic === '추천') {
    return {
      bodyText: HTML_BODY_PREFIX + buildCandidateCardsWebHtml({
        forecasts: report.forecasts,
        title: '오늘의 후보 리포트 · 우선 점검 카드',
        subtitle: '눌림목·점수·리스크를 종합해 오늘 바로 볼 후보를 신뢰도 순으로 정렬했습니다.',
        note: '상위 1~2개에 우선 집중하고 추격보다 분할 진입을 기본으로 운용하세요.',
        limit: 8,
      }),
      sourceLabel: '/리포트 명령 결과',
    }
  }

  if (topic === '공개추천') {
    return {
      bodyText: HTML_BODY_PREFIX + buildCandidateCardsWebHtml({
        forecasts: report.forecasts,
        title: '공유용 오늘의 후보 리포트',
        subtitle: '개인 보유/자금 정보는 제외하고 후보 핵심 지표만 공개용으로 구성했습니다.',
        note: '공유용 리포트는 참고 자료이며 최종 투자 판단은 본인 책임입니다.',
        limit: 8,
      }),
      sourceLabel: '/리포트 명령 결과',
    }
  }

  if (topic === '눌림목') {
    return {
      bodyText: HTML_BODY_PREFIX + buildCandidateCardsWebHtml({
        forecasts: report.forecasts,
        title: '다음 주 눌림목 리포트 · 선진입 후보',
        subtitle: '주간 운용 관점에서 재진입 가능성이 높은 후보를 카드형으로 압축했습니다.',
        note: '다음 주 장 시작 전 갭/거래대금 변화를 확인한 뒤 진입 구간을 재조정하세요.',
        limit: 6,
      }),
      sourceLabel: '/리포트 명령 결과',
    }
  }

  if (WEEKLY_REPORT_TOPIC_MAP[topic]) {
    const weekly = await createWeeklyReportPdf(supabase, {
      chatId: chatId ?? 999999,
      topic: WEEKLY_REPORT_TOPIC_MAP[topic],
    })

    return {
      bodyText: [
        `<b>${weekly.title}</b>`,
        weekly.summaryText,
        '',
        `<i>${weekly.caption}</i>`,
      ].join('\n'),
      sourceLabel: '/리포트 명령 결과',
    }
  }

  return {
    bodyText: baseText,
    sourceLabel: '/리포트 명령 결과',
  }
}
