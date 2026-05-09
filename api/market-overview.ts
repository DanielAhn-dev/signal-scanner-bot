import type { VercelRequest, VercelResponse } from '@vercel/node'
import marketOverview from '../handlers/ui/market-overview'

export const config = {
  maxDuration: 60,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return marketOverview(req, res)
}
