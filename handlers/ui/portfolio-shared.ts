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

function renderMetric(label: string, value: string, valueColor?: string): string {
  const color = valueColor || 'var(--color-text-primary)'
  return `
    <div style="border:1px solid var(--color-border-default);border-radius:var(--radius-lg);padding:14px 14px 13px;background:var(--color-bg-surface);box-shadow:inset 0 1px 0 rgba(255,255,255,0.8)">
      <div style="font-size:12px;color:var(--color-text-tertiary);letter-spacing:-0.01em">${escapeHtml(label)}</div>
      <div style="margin-top:4px;font-size:22px;line-height:1.15;font-weight:var(--font-weight-semibold);letter-spacing:-0.02em;color:${color}">${escapeHtml(value)}</div>
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
    const pnlColor = pnl > 0 ? 'var(--color-stock-up)' : pnl < 0 ? 'var(--color-stock-down)' : 'var(--color-text-secondary)'
    const pctColor = pct > 0 ? 'var(--color-stock-up)' : pct < 0 ? 'var(--color-stock-down)' : 'var(--color-text-secondary)'

    return `
      <tr style="border-bottom:1px solid var(--color-border-default);">
        <td style="padding:12px 10px;line-height:1.5;">${escapeHtml(String(row.stockName || '-'))}</td>
        <td style="padding:12px 10px;color:var(--color-text-secondary);line-height:1.5;">${escapeHtml(String(row.code || '-'))}</td>
        <td style="padding:12px 10px;line-height:1.5;">${escapeHtml(`${Number(row.quantity || 0).toLocaleString('ko-KR')}주`)}</td>
        <td style="padding:12px 10px;line-height:1.5;">${escapeHtml(formatKrw(Number(row.buyPrice || 0)))}</td>
        <td style="padding:12px 10px;color:var(--color-text-secondary);line-height:1.5;">${escapeHtml(String(row.buyDate || '-'))}</td>
        <td style="padding:12px 10px;color:${pnlColor};font-weight:var(--font-weight-semibold);line-height:1.5;">${escapeHtml(formatSignedKrw(pnl))}</td>
        <td style="padding:12px 10px;color:${pctColor};font-weight:var(--font-weight-semibold);line-height:1.5;">${escapeHtml(`${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`)}</td>
      </tr>`
  }).join('')

  return `
    <section style="margin-bottom:16px;color:var(--color-text-secondary)">기준시각 ${escapeHtml(generatedAt)}</section>

    <section style="display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin-bottom:14px;">
      ${renderMetric('보유 종목', `${Number(totals.holdingCount || 0).toLocaleString('ko-KR')}개`)}
      ${renderMetric('총 매수원금', formatKrw(Number(totals.invested || 0)))}
      ${renderMetric('평가금액', formatKrw(Number(totals.currentValue || 0)))}
      ${(() => {
        const unrealized = Number(totals.unrealized || 0)
        const unrealizedColor = unrealized > 0 ? 'var(--color-stock-up)' : unrealized < 0 ? 'var(--color-stock-down)' : undefined
        return renderMetric('평가손익', formatSignedKrw(unrealized), unrealizedColor)
      })()}
      ${(() => {
        const returnPct = Number(totals.returnPct || 0)
        const returnColor = returnPct > 0 ? 'var(--color-stock-up)' : returnPct < 0 ? 'var(--color-stock-down)' : undefined
        return renderMetric('현재 수익률', `${returnPct > 0 ? '+' : ''}${returnPct.toFixed(2)}%`, returnColor)
      })()}
    </section>

    <section style="border:1px solid var(--color-border-default);border-radius:var(--radius-xl);overflow:hidden;background:var(--color-bg-surface);box-shadow:0 1px 0 rgba(255,255,255,0.8)">
      <table style="width:100%;border-collapse:separate;border-spacing:0;font-size:14px;line-height:1.45;color:var(--color-text-primary);">
        <thead>
          <tr style="background:var(--color-bg-sunken);color:var(--color-text-secondary)">
            <th style="text-align:left;padding:13px 10px 12px;border-bottom:1px solid var(--color-border-default);font-size:13px;font-weight:var(--font-weight-semibold);letter-spacing:-0.01em;">종목명</th>
            <th style="text-align:left;padding:13px 10px 12px;border-bottom:1px solid var(--color-border-default);font-size:13px;font-weight:var(--font-weight-semibold);letter-spacing:-0.01em;">종목코드</th>
            <th style="text-align:left;padding:13px 10px 12px;border-bottom:1px solid var(--color-border-default);font-size:13px;font-weight:var(--font-weight-semibold);letter-spacing:-0.01em;">보유수량</th>
            <th style="text-align:left;padding:13px 10px 12px;border-bottom:1px solid var(--color-border-default);font-size:13px;font-weight:var(--font-weight-semibold);letter-spacing:-0.01em;">매수가</th>
            <th style="text-align:left;padding:13px 10px 12px;border-bottom:1px solid var(--color-border-default);font-size:13px;font-weight:var(--font-weight-semibold);letter-spacing:-0.01em;">매수일</th>
            <th style="text-align:left;padding:13px 10px 12px;border-bottom:1px solid var(--color-border-default);font-size:13px;font-weight:var(--font-weight-semibold);letter-spacing:-0.01em;">손익</th>
            <th style="text-align:left;padding:13px 10px 12px;border-bottom:1px solid var(--color-border-default);font-size:13px;font-weight:var(--font-weight-semibold);letter-spacing:-0.01em;">수익률</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows || '<tr><td colspan="7" style="padding:16px 12px;color:var(--color-text-secondary);font-size:14px;line-height:1.5;">표시할 보유 종목이 없습니다.</td></tr>'}
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
