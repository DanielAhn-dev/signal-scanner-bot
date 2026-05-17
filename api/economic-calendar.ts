import type { VercelRequest, VercelResponse } from '@vercel/node'
import economicCalendar from '../handlers/ui/economic-calendar'

export const config = {
  maxDuration: 60,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  return economicCalendar(req, res)
}