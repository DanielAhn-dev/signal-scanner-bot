import type { VercelRequest, VercelResponse } from '@vercel/node'
import handler from '../../handlers/ui/report-web'

export const config = {
  maxDuration: 60,
}

export default async function route(req: VercelRequest, res: VercelResponse) {
  return handler(req, res)
}
