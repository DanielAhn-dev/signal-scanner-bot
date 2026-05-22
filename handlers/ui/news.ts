import type { VercelRequest, VercelResponse } from '@vercel/node'
import { fetchMarketNews, fetchStockNews } from '../../src/utils/fetchNews'
import { searchByNameOrCode } from '../../src/search/normalize'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const query = String(req.query.q || '').trim()
  const pageRaw = Number(req.query.page || 1)
  const pageSizeRaw = Number(req.query.pageSize || 16)
  const page = Number.isFinite(pageRaw) ? Math.max(1, Math.floor(pageRaw)) : 1
  const pageSize = Number.isFinite(pageSizeRaw) ? Math.min(40, Math.max(8, Math.floor(pageSizeRaw))) : 16
  const offset = (page - 1) * pageSize
  // hasMore를 정확히 계산하려면 현재 페이지 끝보다 1건 이상 더 가져와야 함
  const fetchLimit = Math.min(320, offset + pageSize + 1)

  const toPaged = (items: any[]) => {
    const list = Array.isArray(items) ? items : []
    const data = list.slice(offset, offset + pageSize)
    const hasMore = list.length > offset + data.length
    return { data, hasMore }
  }

  try {
    if (!query) {
      const raw = await fetchMarketNews(fetchLimit)
      const { data, hasMore } = toPaged(raw)
      return res.status(200).json({
        mode: 'market',
        data,
        page,
        pageSize,
        hasMore,
      })
    }

    const hits = await searchByNameOrCode(query, 1)
    if (!hits?.length) {
      return res.status(200).json({ mode: 'stock', query, data: [], page, pageSize, hasMore: false })
    }

    const { code, name } = hits[0]
    const raw = await fetchStockNews(code, fetchLimit)
    const { data, hasMore } = toPaged(raw)
    return res.status(200).json({
      mode: 'stock',
      query,
      code,
      name,
      data,
      page,
      pageSize,
      hasMore,
    })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
