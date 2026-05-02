import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createDailyCandidatePlanningReportResult } from '../../src/services/marketInsightService'
import {
  buildPublicDailyCandidateText,
  createDailyCandidateReportPdf,
} from '../../src/bot/commands/report'
import { getUserInvestmentPrefs } from '../../src/services/userService'

const ORIGIN = process.env.UI_CORS_ORIGIN || '*'

type ReportTopic = '추천' | '공개추천' | '가이드' | '자동매매'

function resolveTopic(raw: unknown): ReportTopic {
  const v = String(raw || '').trim().toLowerCase()
  if (v === 'public' || v === '공개추천') return '공개추천'
  if (v === 'guide' || v === '가이드') return '가이드'
  if (v === 'auto-guide' || v === '자동매매') return '자동매매'
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
    if (topic === '가이드' || topic === '자동매매') {
      const fullPath = resolveGuidePath(topic)
      const bytes = await readFile(fullPath)
      const fileName = topic === '자동매매' ? 'automate-trade-command-guide.pdf' : 'user-operating-guide.pdf'
      const inline = String(req.query.inline || req.query.display || '').toLowerCase() === 'inline' || String(req.query.inline) === '1'
      res.setHeader('Content-Type', 'application/pdf')
      res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${fileName}"`)
      return res.status(200).send(Buffer.from(bytes))
    }

    const SUPABASE_URL = process.env.SUPABASE_URL
    const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      return res.status(500).json({ error: 'Server misconfiguration' })
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
    const chatId = asInt(req.query.chatId)

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
    }

    const pdf = await createDailyCandidateReportPdf(chatId ?? 999999, report, topic === '공개추천'
      ? {
          title: '오늘의 투자 후보 리포트',
          subtitle: '개인 보유·자금·리스크 정보를 제외한 요약입니다.',
          filePrefix: 'public_candidate_report',
          captionTitle: '오늘의 투자 후보 리포트',
          captionSubtitle: '추천 엔진 기준 일일 후보 PDF (개인정보 제외)',
          summaryText: '오늘의 투자 후보 리포트 PDF를 생성했습니다.',
        }
      : undefined)

    const inline = String(req.query.inline || req.query.display || '').toLowerCase() === 'inline' || String(req.query.inline) === '1'
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${pdf.fileName}"`)
    return res.status(200).send(Buffer.from(pdf.bytes))
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
