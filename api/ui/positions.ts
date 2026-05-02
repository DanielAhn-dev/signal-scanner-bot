import type { VercelRequest, VercelResponse } from '@vercel/node'
import handler from '../../handlers/ui/positions'

export const config = {
  maxDuration: 60,
}

export default async function route(req: VercelRequest, res: VercelResponse) {
  return handler(req, res)
}
