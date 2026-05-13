import type { VercelRequest, VercelResponse } from '@vercel/node'
import economicalCalendarHandler from '../handlers/ui/economic-calendar'

export const config = {
  maxDuration: 30,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return economicalCalendarHandler(req, res)
}
