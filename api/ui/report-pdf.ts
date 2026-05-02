import type { VercelRequest, VercelResponse } from '@vercel/node'
import handler from '../../handlers/ui/report-pdf'

export const config = {
  maxDuration: 60,
}

export default async function route(req: VercelRequest, res: VercelResponse) {
  return handler(req, res)
}
