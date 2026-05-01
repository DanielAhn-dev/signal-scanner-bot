import type { VercelRequest, VercelResponse } from '@vercel/node'
import {
  createSupabaseServiceClientFromEnv,
  resolveReportTopic,
} from '../../src/services/reportSnapshotService'
import {
  getReportShareByPublicToken,
  markReportShareAccessed,
  verifyInviteCode,
} from '../../src/services/reportShareService'
import {
  escapeHtml,
  renderLayout,
  toRichHtml,
  topicTitle,
} from '../../src/services/reportWebRenderService'

const ORIGIN = process.env.UI_CORS_ORIGIN || '*'

function renderCodeGate(params: {
  share: string
  topic: string
  error?: string
}) {
  const { share, topic, error } = params
  const action = `/api/ui/report-shared?share=${encodeURIComponent(share)}`
  const body = `
    <section style="max-width:520px;margin:8vh auto;background:rgba(255,255,255,0.94);border:1px solid #e5e8eb;border-radius:18px;padding:24px;box-shadow:0 16px 48px rgba(15,23,42,0.08)">
      <div style="display:inline-block;background:#0060ff;color:#fff;border-radius:999px;padding:4px 10px;font-size:12px;font-weight:700">공유 링크</div>
      <h1 style="margin:12px 0 8px;font-size:28px;line-height:1.2">초대코드 확인</h1>
      <p style="margin:0 0 14px;color:#6b7280">공유자가 전달한 초대코드를 입력하면 ${escapeHtml(topic)} 리포트를 열 수 있습니다.</p>
      ${error ? `<div style="margin:0 0 14px;padding:10px 12px;border-radius:10px;background:#fff1f2;color:#be123c;border:1px solid #fecdd3">${escapeHtml(error)}</div>` : ''}
      <form method="GET" action="${action}">
        <label style="display:block;font-size:13px;color:#475569;margin-bottom:6px">초대코드</label>
        <input name="code" placeholder="예: ABC123" style="width:100%;padding:12px 14px;border:1px solid #d1d5db;border-radius:12px;font-size:15px" />
        <button type="submit" style="margin-top:14px;padding:12px 16px;border-radius:12px;background:#0f172a;color:#fff;border:none;font-weight:700;cursor:pointer">리포트 열기</button>
      </form>
    </section>`

  return renderLayout({
    title: `${topicTitle(resolveReportTopic(topic))} 열기`,
    topic,
    sourceLabel: 'share-gate',
    contentHtml: body,
    description: '초대코드를 입력해 공유 리포트를 확인합니다.',
    shareLocked: true,
  })
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN)
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Cache-Control', 'private, no-store')

  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const share = String(req.query.share || '')
  if (!share) return res.status(400).json({ error: 'share required' })

  const secret = process.env.SHARE_KEY || process.env.UI_SHARE_KEY || process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY
  if (!secret) return res.status(500).json({ error: 'Server misconfiguration' })

  try {
    const supabase = createSupabaseServiceClientFromEnv()
    const record = await getReportShareByPublicToken({ supabase, publicToken: share })
    if (!record) return res.status(404).send(renderCodeGate({ share, topic: '추천', error: '존재하지 않는 공유 링크입니다.' }))
    if (record.revoked_at) return res.status(410).send(renderCodeGate({ share, topic: String(record.topic), error: '철회된 공유 링크입니다.' }))
    if (new Date(String(record.expires_at)).getTime() <= Date.now()) {
      return res.status(410).send(renderCodeGate({ share, topic: String(record.topic), error: '만료된 공유 링크입니다.' }))
    }

    const providedCode = String(req.query.code || '').trim().toUpperCase()
    if (!providedCode) {
      return res.status(200).send(renderCodeGate({ share, topic: String(record.topic) }))
    }

    if (!verifyInviteCode({ secret, inviteCode: providedCode, inviteCodeHash: String(record.invite_code_hash) })) {
      return res.status(403).send(renderCodeGate({ share, topic: String(record.topic), error: '초대코드가 올바르지 않습니다.' }))
    }

    await markReportShareAccessed({
      supabase,
      shareId: String(record.id),
      accessCount: Number(record.access_count || 0),
    }).catch(() => undefined)

    const topic = resolveReportTopic(record.topic)
    const html = renderLayout({
      title: topicTitle(topic),
      topic,
      sourceLabel: String(record.source_label || 'shared-report'),
      contentHtml: toRichHtml(String(record.body_text || '')),
      description: `${topicTitle(topic)} 공유 페이지`,
      shareLocked: true,
    })

    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    return res.status(200).send(html)
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
