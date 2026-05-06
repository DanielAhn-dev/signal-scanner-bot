import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  getReportShareByPublicToken,
  markReportShareAccessed,
} from '../../src/services/reportShareService'
import { createSupabaseServiceClientFromEnv } from '../../src/services/reportSnapshotService'
import { escapeHtml, renderLayout } from '../../src/services/reportWebRenderService'

const ORIGIN = process.env.UI_CORS_ORIGIN || '*'

type PortfolioSharePayload = {
  schema?: string
  generatedAt?: string
  totals?: {
    holdingCount?: number
    invested?: number
    currentValue?: number
    unrealized?: number
    returnPct?: number
  }
  rows?: Array<{
    stockName?: string
    code?: string
    quantity?: number
    buyPrice?: number
    buyDate?: string
    currentPrice?: number
    unrealizedPnl?: number
    unrealizedPct?: number
  }>
}

function formatKrw(value: number): string {
  const abs = Math.abs(Number(value || 0))
  return `${abs.toLocaleString('ko-KR')}원`
}

function formatSignedKrw(value: number): string {
  const num = Number(value || 0)
  if (num === 0) return formatKrw(0)
  return `${num > 0 ? '+' : '-'}${formatKrw(num)}`
}

function renderMetric(label: string, value: string): string {
  return `
    <div style="border:1px solid #dbe3ea;border-radius:12px;padding:12px;background:#f8fbff">
      <div style="font-size:12px;color:#64748b">${escapeHtml(label)}</div>
      <div style="margin-top:3px;font-size:24px;font-weight:800;color:#0f172a">${escapeHtml(value)}</div>
    </div>`
}

function renderPortfolioSummary(payload: PortfolioSharePayload): string {
  const rows = Array.isArray(payload.rows) ? payload.rows : []
  const totals = payload.totals || {}
  const generatedAt = payload.generatedAt
    ? new Date(payload.generatedAt).toLocaleString('ko-KR', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
    : '-'

  const tableRows = rows.map((row) => {
    const pnl = Number(row.unrealizedPnl || 0)
    const pct = Number(row.unrealizedPct || 0)
    const pnlColor = pnl > 0 ? '#15803d' : pnl < 0 ? '#b91c1c' : '#334155'
    const pctColor = pct > 0 ? '#15803d' : pct < 0 ? '#b91c1c' : '#334155'

    return `
      <tr>
        <td>${escapeHtml(String(row.stockName || '-'))}</td>
        <td>${escapeHtml(String(row.code || '-'))}</td>
        <td>${escapeHtml(`${Number(row.quantity || 0).toLocaleString('ko-KR')}주`)}</td>
        <td>${escapeHtml(formatKrw(Number(row.buyPrice || 0)))}</td>
        <td>${escapeHtml(String(row.buyDate || '-'))}</td>
        <td style="color:${pnlColor};font-weight:700">${escapeHtml(formatSignedKrw(pnl))}</td>
        <td style="color:${pctColor};font-weight:700">${escapeHtml(`${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`)}</td>
      </tr>`
  }).join('')

  return `
    <section style="margin-bottom:16px;color:#64748b">기준시각 ${escapeHtml(generatedAt)}</section>

    <section style="display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin-bottom:14px;">
      ${renderMetric('보유 종목', `${Number(totals.holdingCount || 0).toLocaleString('ko-KR')}개`)}
      ${renderMetric('총 매수원금', formatKrw(Number(totals.invested || 0)))}
      ${renderMetric('평가금액', formatKrw(Number(totals.currentValue || 0)))}
      ${renderMetric('평가손익', formatSignedKrw(Number(totals.unrealized || 0)))}
      ${renderMetric('현재 수익률', `${Number(totals.returnPct || 0) > 0 ? '+' : ''}${Number(totals.returnPct || 0).toFixed(2)}%`)}
    </section>

    <section style="border:1px solid #dbe3ea;border-radius:14px;overflow:hidden;background:#fff">
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="background:#f1f5f9;color:#334155">
            <th style="text-align:left;padding:10px;border-bottom:1px solid #e2e8f0;">종목명</th>
            <th style="text-align:left;padding:10px;border-bottom:1px solid #e2e8f0;">종목코드</th>
            <th style="text-align:left;padding:10px;border-bottom:1px solid #e2e8f0;">보유수량</th>
            <th style="text-align:left;padding:10px;border-bottom:1px solid #e2e8f0;">매수가</th>
            <th style="text-align:left;padding:10px;border-bottom:1px solid #e2e8f0;">매수일</th>
            <th style="text-align:left;padding:10px;border-bottom:1px solid #e2e8f0;">손익</th>
            <th style="text-align:left;padding:10px;border-bottom:1px solid #e2e8f0;">수익률</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows || '<tr><td colspan="7" style="padding:14px;color:#64748b">표시할 보유 종목이 없습니다.</td></tr>'}
        </tbody>
      </table>
    </section>`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN)
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Cache-Control', 'private, no-store')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const share = String(req.query.share || '')
  if (!share) return res.status(400).json({ error: 'share required' })

  try {
    const supabase = createSupabaseServiceClientFromEnv()
    const record = await getReportShareByPublicToken({ supabase, publicToken: share })

    if (!record || String(record.topic || '') !== 'portfolio-share') {
      return res.status(404).send('공유 요약을 찾을 수 없습니다.')
    }
    if (record.revoked_at) return res.status(410).send('철회된 공유 링크입니다.')
    if (new Date(String(record.expires_at)).getTime() <= Date.now()) {
      return res.status(410).send('만료된 공유 링크입니다.')
    }

    let payload: PortfolioSharePayload = {}
    try {
      payload = JSON.parse(String(record.body_text || '{}')) as PortfolioSharePayload
    } catch {
      return res.status(500).send('공유 데이터 형식이 올바르지 않습니다.')
    }

    await markReportShareAccessed({
      supabase,
      shareId: String(record.id),
      accessCount: Number(record.access_count || 0),
    }).catch(() => undefined)

    const html = renderLayout({
      title: '가상 포트폴리오 공유 요약',
      topic: '포트폴리오 공유',
      sourceLabel: String(record.source_label || 'portfolio-share'),
      description: '가상 포트폴리오 공유용 요약 페이지',
      contentHtml: renderPortfolioSummary(payload),
      shareLocked: true,
    })

    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.status(200).send(html)
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
