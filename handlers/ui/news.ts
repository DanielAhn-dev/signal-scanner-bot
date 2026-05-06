import type { VercelRequest, VercelResponse } from '@vercel/node'
import { fetchMarketNews, fetchStockNews } from '../../src/utils/fetchNews'
import { searchByNameOrCode } from '../../src/search/normalize'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const query = String(req.query.q || '').trim()

  try {
    if (!query) {
      const data = await fetchMarketNews(12)
      return res.status(200).json({ mode: 'market', data })
    }

    const hits = await searchByNameOrCode(query, 1)
    if (!hits?.length) {
      return res.status(200).json({ mode: 'stock', query, data: [] })
    }

    const { code, name } = hits[0]
    const data = await fetchStockNews(code, 12)
    return res.status(200).json({ mode: 'stock', query, code, name, data })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
