import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createDailyCandidatePlanningReportResult } from '../../src/services/marketInsightService'
import {
  buildConvictionRecommendationText,
  buildPublicDailyCandidateText,
  createDailyCandidateReportPdf,
} from '../../src/bot/commands/report'
import { getUserInvestmentPrefs } from '../../src/services/userService'
import { createWeeklyReportPdf } from '../../src/services/weeklyReportService'

const ORIGIN = process.env.UI_CORS_ORIGIN || '*'

type ReportTopic =
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

const WEEKLY_TOPIC_MAP: Partial<Record<ReportTopic, string>> = {
  주간: 'full',
  눌림목: 'pullback',
  포트폴리오: 'portfolio',
  관심종목: 'watchonly',
  거시: 'economy',
  수급: 'flow',
  섹터: 'sector',
}

function resolveTopic(raw: unknown): ReportTopic {
  const v = String(raw || '').trim().toLowerCase()
  if (v === '확신추천' || v === '확실추천' || v === '핵심추천' || v === 'conviction') return '확신추천'
  if (v === 'public' || v === '공개추천') return '공개추천'
  if (v === 'guide' || v === '가이드') return '가이드'
  if (v === 'auto-guide' || v === '자동매매') return '자동매매'
  if (v === '주간' || v === 'full' || v === 'weekly') return '주간'
  if (v === '눌림목' || v === 'pullback') return '눌림목'
  if (v === '포트폴리오' || v === 'portfolio' || v === 'watchlist') return '포트폴리오'
  if (v === '관심종목' || v === '관심' || v === 'watchonly' || v === 'watch') return '관심종목'
  if (v === '거시' || v === '경제' || v === 'macro' || v === 'economy') return '거시'
  if (v === '수급' || v === 'flow') return '수급'
  if (v === '섹터' || v === 'sector') return '섹터'
  return '추천'
}

function resolveGuidePath(topic: ReportTopic): string {
  if (topic === '자동매매') {
    return path.join(process.cwd(), 'docs', 'generated', 'automate-trade-command-guide.pdf')
  }
  return path.join(process.cwd(), 'docs', 'generated', 'user-operating-guide.pdf')
}

function asInt(value: unknown): number | null {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.floor(n)
}

function resolveChatId(req: VercelRequest): number | null {
  return asInt(req.query.chatId ?? req.query.chat_id ?? req.headers['x-user-chat-id'])
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN)
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key')
  res.setHeader('Access-Control-Allow-Credentials', 'true')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const readKey = req.headers['x-ui-key'] || req.query.ui_key || process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY
  if (!readKey || String(readKey) !== (process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const topic = resolveTopic(req.query.topic)

  try {
    const SUPABASE_URL = process.env.SUPABASE_URL
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return res.status(500).json({ error: 'Server misconfiguration' })
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
    const chatId = resolveChatId(req)

    if (topic === '가이드' || topic === '자동매매') {
      const fullPath = resolveGuidePath(topic)
      const bytes = await readFile(fullPath)
      const fileName = topic === '자동매매' ? 'automate-trade-command-guide.pdf' : 'user-operating-guide.pdf'
      const inline = String(req.query.inline || req.query.display || '').toLowerCase() === 'inline' || String(req.query.inline) === '1'
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${fileName}"`)
      return res.status(200).send(Buffer.from(bytes))
    }

    if (WEEKLY_TOPIC_MAP[topic]) {
      const weekly = await createWeeklyReportPdf(supabase, {
        chatId: chatId ?? 999999,
        topic: WEEKLY_TOPIC_MAP[topic],
      })
      const inline = String(req.query.inline || req.query.display || '').toLowerCase() === 'inline' || String(req.query.inline) === '1'
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${weekly.fileName}"`)
      return res.status(200).send(Buffer.from(weekly.bytes))
    }

    const riskProfile = chatId
      ? ((await getUserInvestmentPrefs(chatId)).risk_profile ?? 'safe') as 'safe' | 'balanced' | 'active'
      : 'balanced'

    let report = await createDailyCandidatePlanningReportResult(supabase, {
      riskProfile,
      chatId: chatId ?? undefined,
    })

    if (topic === '공개추천') {
      report = {
        ...report,
        text: buildPublicDailyCandidateText(report.text),
      }
    } else if (topic === '확신추천') {
      report = {
        ...report,
        text: buildConvictionRecommendationText(report),
      }
    }

    const pdf = await createDailyCandidateReportPdf(
      chatId ?? 999999,
      report,
      topic === '공개추천'
        ? {
            title: '오늘의 투자 후보 리포트',
            subtitle: '개인 보유·자금·리스크 정보를 제외한 요약입니다.',
            filePrefix: 'public_candidate_report',
            captionTitle: '오늘의 투자 후보 리포트',
            captionSubtitle: '추천 엔진 기준 일일 후보 PDF (개인정보 제외)',
            summaryText: '오늘의 투자 후보 리포트 PDF를 생성했습니다.',
          }
        : topic === '확신추천'
          ? {
              title: '하이라이트 종목',
              subtitle: '눌림목·점수·리스크를 함께 반영한 확신 후보 하이라이트입니다.',
              filePrefix: 'conviction_candidate_report',
              captionTitle: '하이라이트 종목',
              captionSubtitle: '추천 엔진 기준 일일 확신 후보 PDF',
              summaryText: '하이라이트 종목 PDF를 생성했습니다.',
            }
          : undefined
    )

    const inline = String(req.query.inline || req.query.display || '').toLowerCase() === 'inline' || String(req.query.inline) === '1'
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${pdf.fileName}"`)
    return res.status(200).send(Buffer.from(pdf.bytes))
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
