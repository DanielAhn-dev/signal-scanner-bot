import type { VercelRequest, VercelResponse } from '@vercel/node'
import { fetchSentimentState } from '../../src/services/sentimentState'
import { denyIfUnauthorizedRead } from './_accessControl'

/** '지금과 비슷했던 때' 화면 — 코스피 오늘의 시장 상태(심리 점수·60일 고점 대비·20일 변동성). 예측이 아니라 지금 위치다 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || process.env.UI_CORS_ORIGIN || '*'
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key,x-user-chat-id,Authorization')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  res.setHeader('Cache-Control', 'private, max-age=60, stale-while-revalidate=300')
  res.setHeader('Vary', 'Origin')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })
  if (denyIfUnauthorizedRead(req, res)) return

  try {
    const state = await fetchSentimentState()
    // 자료가 모자라거나 외부 조회가 실패하면 '없음'으로 두고 화면이 다시 시도하게 한다
    return res.status(200).json({ ok: true, data: state })
  } catch (e: any) {
    return res.status(200).json({ ok: true, data: null, error: String(e?.message || e) })
  }
}
