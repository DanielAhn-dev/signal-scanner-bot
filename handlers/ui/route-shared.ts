import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  getReportShareByPublicToken,
  markReportShareAccessed,
} from '../../src/services/reportShareService'
import { createSupabaseServiceClientFromEnv } from '../../src/services/reportSnapshotService'
import { escapeHtml, renderLayout } from '../../src/services/reportWebRenderService'

const ORIGIN = process.env.UI_CORS_ORIGIN || '*'

type ShareKind = 'scan' | 'analyze' | 'highlights'

function resolveKind(value: unknown): ShareKind {
  const v = String(value || '').trim().toLowerCase()
  if (v === 'analyze') return 'analyze'
  if (v === 'highlights') return 'highlights'
  return 'scan'
}

function expectedTopic(kind: ShareKind): string {
  if (kind === 'analyze') return 'analyze-share'
  if (kind === 'highlights') return 'highlights-share'
  return 'scan-share'
}

function formatKrw(value: number): string {
  return `${Number(value || 0).toLocaleString('ko-KR')}원`
}

function formatMaybeKrw(value: unknown): string {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return '-'
  return formatKrw(n)
}

function gradeBadge(value?: string | null): string {
  const v = String(value || '').toUpperCase().trim()
  if (!v) return '<span style="color:#94a3b8">-</span>'
  const style =
    v === 'A' ? 'background:#ecfdf5;color:#059669;border:1px solid #a7f3d0;' :
    v === 'B' ? 'background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe;' :
    v === 'C' ? 'background:#fff7ed;color:#ea580c;border:1px solid #fed7aa;' :
    'background:#f8fafc;color:#64748b;border:1px solid #cbd5e1;'
  return `<span style="display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;border-radius:6px;font-size:12px;font-weight:700;${style}">${escapeHtml(v)}</span>`
}

function sharedResponsiveStyles(): string {
  return `
    <style>
      .shared-grid-metrics { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:10px; margin-bottom:14px; }
      .shared-table-wrap { border:1px solid var(--color-border-default); border-radius:14px; overflow:hidden; background:#fff; }
      .shared-table-scroll { overflow-x:auto; }
      .shared-table { width:100%; border-collapse:separate; border-spacing:0; font-size:13px; line-height:1.4; min-width:860px; }
      .shared-cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:10px; }
      @media (max-width: 900px) {
        .shared-grid-metrics { grid-template-columns:repeat(2,minmax(0,1fr)); }
      }
      @media (max-width: 640px) {
        .shared-grid-metrics { grid-template-columns:1fr; }
        .shared-cards { grid-template-columns:1fr; }
        .shared-table { font-size:12px; min-width:760px; }
      }
    </style>
  `
}

function renderScanShared(payload: any): string {
  const rows = Array.isArray(payload?.rows) ? payload.rows : []
  const generatedAt = payload?.generatedAt
    ? new Date(payload.generatedAt).toLocaleString('ko-KR', { hour12: false })
    : '-'
  const latestDate = String(payload?.latestDate || '-')
  const phase = String(payload?.marketPhase || 'after-close') === 'intraday' ? '장중' : '종가'
  const filterLabel = String(payload?.conditionFilterLabel || '전체')
  const sectorLabel = String(payload?.sectorLabel || '전체 섹터')
  const highlightsLabel = String(payload?.sectionLabels?.highlights || '참고용 추천')
  const candidatesLabel = String(payload?.sectionLabels?.candidates || '실전 기준 후보')
  const viewMode = String(payload?.viewMode || 'table').toLowerCase() === 'cards' ? 'cards' : 'table'
  const cardLimitRaw = Number(payload?.cardLimit || 20)
  const cardLimit = Number.isFinite(cardLimitRaw)
    ? Math.max(5, Math.min(60, Math.round(cardLimitRaw)))
    : 20

  const rowHtml = rows.map((row: any, idx: number) => {
    const intraday = typeof row?.intradayChangePct === 'number'
      ? `${row.intradayChangePct > 0 ? '+' : ''}${Number(row.intradayChangePct).toFixed(2)}%`
      : '-'
    return `
      <tr style="border-bottom:1px solid var(--color-border-default)">
        <td style="padding:10px 8px">${idx + 1}</td>
        <td style="padding:10px 8px">${escapeHtml(String(row?.name || '-'))}</td>
        <td style="padding:10px 8px;color:#64748b">${escapeHtml(String(row?.code || '-'))}</td>
        <td style="padding:10px 8px">${escapeHtml(String(row?.sector || '-'))}</td>
        <td style="padding:10px 8px">${gradeBadge(row?.entryGrade)}</td>
        <td style="padding:10px 8px">${gradeBadge(row?.trendGrade)}</td>
        <td style="padding:10px 8px">${gradeBadge(row?.distGrade)}</td>
        <td style="padding:10px 8px">${gradeBadge(row?.pivotGrade)}</td>
        <td style="padding:10px 8px;color:${Number(row?.warnScore || 0) > 0 ? '#dc2626' : '#64748b'}">${escapeHtml(String(row?.warnGrade || '-'))}</td>
        <td style="padding:10px 8px;font-weight:600">${escapeHtml(String(row?.priorityScore ?? '-'))}</td>
        <td style="padding:10px 8px;color:${String(intraday).startsWith('-') ? '#dc2626' : '#059669'}">${escapeHtml(intraday)}</td>
      </tr>`
  }).join('')

  const cardHtml = rows.slice(0, cardLimit).map((row: any, idx: number) => {
    const intraday = typeof row?.intradayChangePct === 'number'
      ? `${row.intradayChangePct > 0 ? '+' : ''}${Number(row.intradayChangePct).toFixed(2)}%`
      : '-'
    const intradayColor = intraday.startsWith('-') ? '#dc2626' : '#059669'
    return `
      <article style="border:1px solid var(--color-border-default);border-radius:12px;padding:12px;background:#fff;">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;">
          <div>
            <div style="font-size:12px;color:#64748b">TOP ${idx + 1}</div>
            <div style="margin-top:3px;font-size:16px;font-weight:800;color:#0f172a">${escapeHtml(String(row?.name || '-'))}</div>
            <div style="margin-top:2px;font-size:12px;color:#64748b">${escapeHtml(String(row?.code || '-'))}</div>
          </div>
          <div style="font-size:12px;color:#64748b;">${escapeHtml(String(row?.sector || '-'))}</div>
        </div>
        <div style="margin-top:10px;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:6px;align-items:center;">
          <div style="font-size:11px;color:#64748b">진입 ${gradeBadge(row?.entryGrade)}</div>
          <div style="font-size:11px;color:#64748b">추세 ${gradeBadge(row?.trendGrade)}</div>
          <div style="font-size:11px;color:#64748b">매집 ${gradeBadge(row?.distGrade)}</div>
          <div style="font-size:11px;color:#64748b">세력 ${gradeBadge(row?.pivotGrade)}</div>
          <div style="font-size:11px;color:#64748b">경고 ${escapeHtml(String(row?.warnGrade || '-'))}</div>
        </div>
        <div style="margin-top:10px;display:flex;justify-content:space-between;font-size:13px;">
          <span style="color:#334155">우선순위 <strong>${escapeHtml(String(row?.priorityScore ?? '-'))}</strong></span>
          <span style="color:${intradayColor};font-weight:700">${escapeHtml(intraday)}</span>
        </div>
      </article>`
  }).join('')

  return `
    ${sharedResponsiveStyles()}
    <section style="margin-bottom:12px;padding:14px 16px;border:1px solid var(--color-border-default);border-radius:14px;background:linear-gradient(135deg,#eef4ff 0%,#f8fbff 100%);">
      <div style="font-size:12px;color:#64748b">기준시각 ${escapeHtml(generatedAt)}</div>
      <div style="margin-top:6px;font-size:21px;line-height:1.25;font-weight:800;color:#0f172a">Nexora 눌림목 공유</div>
      <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
        <span style="display:inline-flex;align-items:center;padding:4px 10px;border-radius:999px;background:#eff6ff;color:#1d4ed8;font-size:12px;font-weight:700;border:1px solid #bfdbfe">${escapeHtml(highlightsLabel)} · 참고</span>
        <span style="display:inline-flex;align-items:center;padding:4px 10px;border-radius:999px;background:#ecfdf5;color:#047857;font-size:12px;font-weight:700;border:1px solid #a7f3d0">${escapeHtml(candidatesLabel)} · 실전</span>
      </div>
    </section>
    <section class="shared-grid-metrics">
      <div style="border:1px solid var(--color-border-default);border-radius:12px;padding:12px;background:#fff"><div style="font-size:12px;color:#64748b">기준일</div><div style="margin-top:4px;font-size:18px;font-weight:700">${escapeHtml(latestDate)}</div></div>
      <div style="border:1px solid var(--color-border-default);border-radius:12px;padding:12px;background:#fff"><div style="font-size:12px;color:#64748b">시장 구분</div><div style="margin-top:4px;font-size:18px;font-weight:700">${escapeHtml(phase)}</div></div>
      <div style="border:1px solid var(--color-border-default);border-radius:12px;padding:12px;background:#fff"><div style="font-size:12px;color:#64748b">필터</div><div style="margin-top:4px;font-size:18px;font-weight:700">${escapeHtml(filterLabel)}</div></div>
      <div style="border:1px solid var(--color-border-default);border-radius:12px;padding:12px;background:#fff"><div style="font-size:12px;color:#64748b">섹터</div><div style="margin-top:4px;font-size:18px;font-weight:700">${escapeHtml(sectorLabel)}</div></div>
    </section>
    ${viewMode === 'cards'
      ? `<section style="margin:0 0 10px;font-size:12px;color:#64748b">카드 모드 · 상위 ${cardLimit}개 표시</section><section class="shared-cards">${cardHtml || '<article style="border:1px solid var(--color-border-default);border-radius:12px;padding:16px;background:#fff;color:#64748b">표시할 후보가 없습니다.</article>'}</section>`
      : `<section class="shared-table-wrap"><div class="shared-table-scroll"><table class="shared-table"><thead><tr style="background:var(--color-bg-sunken);color:#64748b"><th style="text-align:left;padding:10px 8px">순위</th><th style="text-align:left;padding:10px 8px">종목명</th><th style="text-align:left;padding:10px 8px">코드</th><th style="text-align:left;padding:10px 8px">섹터</th><th style="text-align:left;padding:10px 8px">진입</th><th style="text-align:left;padding:10px 8px">추세</th><th style="text-align:left;padding:10px 8px">매집</th><th style="text-align:left;padding:10px 8px">세력</th><th style="text-align:left;padding:10px 8px">경고</th><th style="text-align:left;padding:10px 8px">우선순위</th><th style="text-align:left;padding:10px 8px">변동</th></tr></thead><tbody>${rowHtml || '<tr><td colspan="11" style="padding:16px;color:#64748b">표시할 후보가 없습니다.</td></tr>'}</tbody></table></div></section>`}
  `
}

function renderHighlightsShared(payload: any): string {
  const items = Array.isArray(payload?.items) ? payload.items : []
  const totalCapital = Number(payload?.totalCapital || 0)
  const selectedCount = Number(payload?.selectedCount || 0)
  const totalCount = Number(payload?.totalCount || 0)

  const itemsHtml = items.slice(0, 20).map((item: any, idx: number) => {
    const entryPrice = item?.entry_price ? formatKrw(item.entry_price) : '-'
    const basePct = item?.expected_base_pct != null ? `${Number(item.expected_base_pct).toFixed(1)}%` : '-'
    const upPct = item?.expected_upside_pct != null ? `${Number(item.expected_upside_pct).toFixed(1)}%` : '-'
    const downPct = item?.expected_drawdown_pct != null ? `${Number(item.expected_drawdown_pct).toFixed(1)}%` : '-'
    const confidence = item?.confidence_pct != null ? `${Number(item.confidence_pct).toFixed(1)}%` : '-'
    return `
      <article style="border:1px solid var(--color-border-default);border-radius:12px;padding:14px;background:#fff;">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start;margin-bottom:10px;">
          <div>
            <div style="font-size:12px;color:#64748b">TOP ${idx + 1}</div>
            <div style="margin-top:4px;font-size:16px;font-weight:800;color:#0f172a">${escapeHtml(String(item?.name || '-'))}</div>
            <div style="margin-top:2px;font-size:12px;color:#64748b">${escapeHtml(String(item?.code || '-'))}</div>
          </div>
          <div style="text-align:right;font-size:14px;font-weight:700;color:#0060ff;">${escapeHtml(confidence)}</div>
        </div>
        <div style="border-top:1px solid var(--color-border-default);padding-top:10px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;">
          <div style="font-size:11px;color:#64748b;"><div style="font-weight:600;color:#0f172a;margin-top:4px;">${escapeHtml(entryPrice)}</div><div style="font-size:10px;margin-top:2px;">진입가</div></div>
          <div style="font-size:11px;color:#64748b;"><div style="font-weight:600;color:#059669;margin-top:4px;">+${escapeHtml(basePct)}</div><div style="font-size:10px;margin-top:2px;">목표1</div></div>
          <div style="font-size:11px;color:#64748b;"><div style="font-weight:600;color:#059669;margin-top:4px;">+${escapeHtml(upPct)}</div><div style="font-size:10px;margin-top:2px;">목표2</div></div>
          <div style="font-size:11px;color:#64748b;"><div style="font-weight:600;color:#dc2626;margin-top:4px;">-${escapeHtml(downPct)}</div><div style="font-size:10px;margin-top:2px;">손절</div></div>
        </div>
      </article>`
  }).join('')

  return `
    ${sharedResponsiveStyles()}
    <section style="margin-bottom:12px;padding:14px 16px;border:1px solid var(--color-border-default);border-radius:14px;background:linear-gradient(135deg,#fff5f0 0%,#fffaf8 100%);">
      <div style="font-size:21px;line-height:1.25;font-weight:800;color:#0f172a">하이라이트 허브 공유</div>
      <div style="margin-top:8px;font-size:13px;color:#475569">선택된 ${selectedCount}개 종목 · 총 투자금 ${formatKrw(totalCapital)} (전체 ${totalCount}개 중)</div>
    </section>
    <section class="shared-cards">${itemsHtml || '<article style="border:1px solid var(--color-border-default);border-radius:12px;padding:16px;background:#fff;color:#64748b">표시할 종목이 없습니다.</article>'}</section>
  `
}

function renderAnalyzeShared(payload: any): string {
  const stock = payload?.stock || {}
  const advisor = payload?.advisor || {}
  const summaryLines = Array.isArray(payload?.summaryLines) ? payload.summaryLines : []
  const generatedAt = payload?.generatedAt
    ? new Date(payload.generatedAt).toLocaleString('ko-KR', { hour12: false })
    : '-'
  const name = String(stock?.name || stock?.code || '종목')
  const code = String(stock?.code || '-')
  const price = Number(stock?.price || 0)
  const changePct = Number(stock?.changePct || 0)

  const changeColor = changePct > 0 ? '#059669' : changePct < 0 ? '#dc2626' : '#64748b'

  const summaryHtml = summaryLines
    .slice(0, 5)
    .map((line: string) => `<div style="font-size:13px;color:#475569;line-height:1.55">• ${escapeHtml(String(line || ''))}</div>`)
    .join('')

  const recentCloses = Array.isArray(payload?.recentCloses)
    ? payload.recentCloses.map((v: unknown) => Number(v)).filter((v: number) => Number.isFinite(v) && v > 0).slice(-10)
    : []
  const closeMin = recentCloses.length > 0 ? Math.min(...recentCloses) : 0
  const closeMax = recentCloses.length > 0 ? Math.max(...recentCloses) : 0
  const closeRange = closeMax - closeMin
  const closePath = recentCloses.map((value: number, idx: number) => {
    const x = recentCloses.length > 1 ? (idx / (recentCloses.length - 1)) * 100 : 50
    const y = closeRange > 0 ? 36 - ((value - closeMin) / closeRange) * 30 : 21
    return `${idx === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
  }).join(' ')
  const closeTrendColor = recentCloses.length >= 2 && recentCloses[recentCloses.length - 1] >= recentCloses[0] ? '#059669' : '#dc2626'

  return `
    ${sharedResponsiveStyles()}
    <section style="margin-bottom:12px;padding:14px 16px;border:1px solid var(--color-border-default);border-radius:14px;background:linear-gradient(135deg,#effcf7 0%,#f8fffc 100%);">
      <div style="font-size:12px;color:#64748b">기준시각 ${escapeHtml(generatedAt)}</div>
      <div style="margin-top:6px;font-size:21px;line-height:1.25;font-weight:800;color:#0f172a">종목 분석 공유 요약</div>
    </section>
    <section style="border:1px solid var(--color-border-default);border-radius:14px;padding:16px;background:#fff;margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap">
        <div>
          <div style="font-size:28px;font-weight:800;line-height:1.2">${escapeHtml(name)}</div>
          <div style="margin-top:4px;color:#64748b">${escapeHtml(code)}</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:30px;font-weight:800">${escapeHtml(formatMaybeKrw(price))}</div>
          <div style="margin-top:4px;color:${changeColor};font-weight:700">${escapeHtml(`${changePct > 0 ? '+' : ''}${changePct.toFixed(2)}%`)}</div>
        </div>
      </div>
    </section>

    <section style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin-bottom:12px;">
      <div style="border:1px solid var(--color-border-default);border-radius:12px;padding:12px;background:#fff"><div style="font-size:12px;color:#64748b">일중 범위</div><div style="margin-top:4px;font-size:18px;font-weight:700">${escapeHtml(`${formatMaybeKrw(stock?.low)} ~ ${formatMaybeKrw(stock?.high)}`)}</div></div>
      <div style="border:1px solid var(--color-border-default);border-radius:12px;padding:12px;background:#fff"><div style="font-size:12px;color:#64748b">PER / PBR / ROE</div><div style="margin-top:4px;font-size:18px;font-weight:700">${escapeHtml(`${stock?.per ?? '-'} / ${stock?.pbr ?? '-'} / ${stock?.roe ?? '-'}`)}</div></div>
      <div style="border:1px solid var(--color-border-default);border-radius:12px;padding:12px;background:#fff"><div style="font-size:12px;color:#64748b">AI 판정</div><div style="margin-top:4px;font-size:18px;font-weight:700">${escapeHtml(String(advisor?.statusLabel || '-'))}</div></div>
      <div style="border:1px solid var(--color-border-default);border-radius:12px;padding:12px;background:#fff"><div style="font-size:12px;color:#64748b">종합 점수</div><div style="margin-top:4px;font-size:18px;font-weight:700">${escapeHtml(String(advisor?.finalScore ?? '-'))}</div></div>
    </section>

    <section style="border:1px solid var(--color-border-default);border-radius:14px;padding:14px;background:#fff;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;">
      <div><div style="font-size:12px;color:#64748b">진입구간</div><div style="margin-top:4px;font-size:20px;font-weight:800">${escapeHtml(`${formatMaybeKrw(advisor?.entryLow)} ~ ${formatMaybeKrw(advisor?.entryHigh)}`)}</div></div>
      <div><div style="font-size:12px;color:#64748b">1차/2차 목표</div><div style="margin-top:4px;font-size:20px;font-weight:800">${escapeHtml(`${formatMaybeKrw(advisor?.target1)} / ${formatMaybeKrw(advisor?.target2)}`)}</div></div>
      <div><div style="font-size:12px;color:#64748b">손절 기준</div><div style="margin-top:4px;font-size:20px;font-weight:800;color:#dc2626">${escapeHtml(formatMaybeKrw(advisor?.stopPrice))}</div></div>
    </section>

    ${recentCloses.length >= 2
      ? `<section style="margin-top:12px;border:1px solid var(--color-border-default);border-radius:14px;padding:14px;background:#fff;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
            <div style="font-size:13px;font-weight:700;color:#0f172a;">최근 종가 추이 (${recentCloses.length}일)</div>
            <div style="font-size:12px;color:#64748b">${escapeHtml(formatMaybeKrw(recentCloses[0]))} → ${escapeHtml(formatMaybeKrw(recentCloses[recentCloses.length - 1]))}</div>
          </div>
          <svg viewBox="0 0 100 42" preserveAspectRatio="none" style="margin-top:8px;width:100%;height:84px;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0;">
            <path d="${closePath}" fill="none" stroke="${closeTrendColor}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </section>`
      : ''}
    <section style="margin-top:12px;border:1px solid var(--color-border-default);border-radius:14px;padding:14px;background:#fff;">
      <div style="font-size:13px;font-weight:700;color:#0f172a;margin-bottom:8px">핵심 요약</div>
      ${summaryHtml || '<div style="font-size:13px;color:#64748b">요약 정보가 없습니다.</div>'}
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

  const kind = resolveKind(req.query.kind)

  try {
    const supabase = createSupabaseServiceClientFromEnv()
    const record = await getReportShareByPublicToken({ supabase, publicToken: share })

    if (!record || String(record.topic || '') !== expectedTopic(kind)) {
      return res.status(404).send('공유 페이지를 찾을 수 없습니다.')
    }
    if (record.revoked_at) return res.status(410).send('철회된 공유 링크입니다.')
    if (new Date(String(record.expires_at)).getTime() <= Date.now()) {
      return res.status(410).send('만료된 공유 링크입니다.')
    }

    let payload: any = {}
    try {
      payload = JSON.parse(String(record.body_text || '{}')) as any
    } catch {
      return res.status(500).send('공유 데이터 형식이 올바르지 않습니다.')
    }

    await markReportShareAccessed({
      supabase,
      shareId: String(record.id),
      accessCount: Number(record.access_count || 0),
    }).catch(() => undefined)

    const contentHtml = kind === 'analyze'
      ? renderAnalyzeShared(payload)
      : kind === 'highlights'
        ? renderHighlightsShared(payload)
        : renderScanShared(payload)

    const html = renderLayout({
      title: kind === 'analyze' ? '종목 분석 공유' : kind === 'highlights' ? '하이라이트 허브 공유' : '눌림목 스캔 공유',
      topic: kind === 'analyze' ? '종목 분석 공유' : kind === 'highlights' ? '하이라이트 공유' : '눌림목 공유',
      sourceLabel: String(record.source_label || `${kind}-share`),
      description: kind === 'analyze' ? 'Nexora 종목 분석 공유 페이지' : kind === 'highlights' ? 'Nexora 하이라이트 허브 공유 페이지' : 'Nexora 눌림목 스캔 공유 페이지',
      contentHtml,
      shareLocked: true,
    })

    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.status(200).send(html)
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
