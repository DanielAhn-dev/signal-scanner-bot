import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createDailyCandidatePlanningReportResult } from './marketInsightService'
import { buildPublicDailyCandidateText } from '../bot/commands/report'
import { getUserInvestmentPrefs } from './userService'

export type ReportTopic = '추천' | '공개추천' | '가이드' | '자동매매'

export const REPORT_SNAPSHOT_TABLE = 'ui_report_snapshots'

export function resolveReportTopic(raw: unknown): ReportTopic {
  const v = String(raw || '').trim().toLowerCase()
  if (v === '공개추천' || v === 'public') return '공개추천'
  if (v === '가이드' || v === 'guide') return '가이드'
  if (v === '자동매매' || v === 'auto-guide') return '자동매매'
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
  const bodyText = topic === '공개추천' ? buildPublicDailyCandidateText(baseText) : baseText

  return {
    bodyText,
    sourceLabel: '/리포트 명령 결과',
  }
}
