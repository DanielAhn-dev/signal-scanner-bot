import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { evaluateAdvancedAccess, setUiCorsHeaders } from './_accessControl'
import { resolveUiUserContext } from './_userContext'
import { parseDistributionFile } from '../../src/lib/distributionImport'
import {
  diffDistributions,
  findStockByCode,
  loadExisting,
  loadSummary,
  resolveProduct,
  suspiciousRows,
  upsertDistributions,
} from '../../src/services/etfDistributionStore'

// 운용사 분배금 엑셀 업로드 (관리자 전용, src/lib/distributionImport.ts · src/services/etfDistributionStore.ts)
// GET  ?mode=list                      저장된 상품별 요약
// POST {action:'preview', files:[{name, base64}]}              파싱·상품 인식·기존 값과 비교 (저장하지 않음)
// POST {action:'save', files:[{name, base64, code}]}           코드를 확정해 저장 (파일을 서버에서 다시 파싱 — 클라이언트가 보낸 행을 믿지 않는다)
const MAX_FILES = 10
const MAX_BASE64_LEN = 2_800_000

function decodeFile(f: any): { name: string; bytes: Uint8Array } | { error: string } {
  const name = typeof f?.name === 'string' ? f.name.slice(0, 200) : ''
  const b64 = typeof f?.base64 === 'string' ? f.base64 : ''
  if (!name || !b64) return { error: '파일 이름 또는 내용이 없습니다.' }
  if (b64.length > MAX_BASE64_LEN) return { error: '파일이 너무 큽니다 (2MB 이하).' }
  return { name, bytes: new Uint8Array(Buffer.from(b64, 'base64')) }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setUiCorsHeaders(req, res, 'GET,POST,OPTIONS')
  res.setHeader('Cache-Control', 'private, no-store')
  if (req.method === 'OPTIONS') return res.status(204).end()

  const readKey = req.headers['x-ui-key'] || req.query.ui_key || process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY
  if (!readKey || String(readKey) !== (process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY
  if (!url || !key) return res.status(500).json({ error: 'Server not configured' })

  try {
    const user = await resolveUiUserContext(req)
    if (!user.authenticated || !user.clientId) return res.status(401).json({ error: 'Authenticated session required' })
    const access = await evaluateAdvancedAccess({ clientId: user.clientId, chatId: user.chatId })
    if (!access.isAdmin) return res.status(403).json({ error: 'Admin only' })
    const supabase = createClient(url, key, { auth: { persistSession: false } })

    if (req.method === 'GET') {
      return res.status(200).json({ data: { products: await loadSummary(supabase) } })
    }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

    const body = (req.body || {}) as Record<string, unknown>
    const action = String(body.action || '')
    const files = Array.isArray(body.files) ? body.files.slice(0, MAX_FILES) : []
    if (!files.length) return res.status(400).json({ error: '파일이 없습니다.' })

    if (action === 'preview') {
      const items = []
      for (const f of files) {
        const decoded = decodeFile(f)
        if ('error' in decoded) {
          items.push({ fileName: String((f as any)?.name ?? ''), ok: false, error: decoded.error })
          continue
        }
        const parsed = parseDistributionFile(decoded.name, decoded.bytes)
        if (!parsed.ok) {
          items.push({ fileName: parsed.fileName, ok: false, error: parsed.error })
          continue
        }
        const product = await resolveProduct(supabase, parsed)
        const warnings = [...parsed.warnings]
        let diff: { added: number; changed: number; same: number } | null = null
        if (product.stock) {
          diff = diffDistributions(await loadExisting(supabase, product.stock.code, parsed.rows[0].recordDate), parsed.rows)
          const odd = suspiciousRows(parsed.rows, product.stock.close)
          if (odd.length) warnings.push(`분배금이 현재가의 25%를 넘는 행이 ${odd.length}개 있습니다(${odd[0].recordDate} ${odd[0].perShare}원). 상품이 맞는지 확인하세요.`)
        }
        const last = parsed.rows[parsed.rows.length - 1]
        items.push({
          fileName: parsed.fileName,
          ok: true,
          nameHint: parsed.nameHint,
          code: product.stock?.code ?? null,
          stockName: product.stock?.name ?? null,
          codeSource: product.source,
          candidates: product.candidates.map((c) => ({ code: c.code, name: c.name })),
          rows: parsed.rows.length,
          firstDate: parsed.rows[0].recordDate,
          lastDate: last.recordDate,
          lastPerShare: last.perShare,
          diff,
          warnings,
        })
      }
      return res.status(200).json({ data: { items } })
    }

    if (action === 'save') {
      const results = []
      for (const f of files) {
        const decoded = decodeFile(f)
        const fileName = decoded && 'name' in decoded ? decoded.name : String((f as any)?.name ?? '')
        if ('error' in decoded) {
          results.push({ fileName, ok: false, error: decoded.error })
          continue
        }
        const code = typeof (f as any).code === 'string' ? (f as any).code.trim().toUpperCase() : ''
        if (!/^[0-9A-Z]{4,10}$/.test(code)) {
          results.push({ fileName, ok: false, error: '상품 코드를 확정해 주세요.' })
          continue
        }
        const stock = await findStockByCode(supabase, code)
        if (!stock) {
          results.push({ fileName, ok: false, error: `종목 ${code}를 찾지 못했습니다.` })
          continue
        }
        const parsed = parseDistributionFile(decoded.name, decoded.bytes)
        if (!parsed.ok) {
          results.push({ fileName, ok: false, error: parsed.error })
          continue
        }
        // 파일 안에 코드(ISIN)가 있으면 사람이 고른 코드와 달라서는 안 된다
        if (parsed.code && parsed.code !== code) {
          results.push({ fileName, ok: false, error: `파일 안의 상품 코드(${parsed.code})와 고른 코드(${code})가 다릅니다.` })
          continue
        }
        const written = await upsertDistributions(supabase, code, parsed.rows, decoded.name)
        results.push({ fileName, ok: true, code, stockName: stock.name, written })
      }
      return res.status(200).json({ data: { results } })
    }

    return res.status(400).json({ error: 'Unknown action' })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
