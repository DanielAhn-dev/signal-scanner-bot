import type { VercelRequest, VercelResponse } from '@vercel/node'
import { sendMessage } from '../../src/telegram/api'
import { resolveUiUserContext } from './_userContext'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const origin = (req.headers.origin as string) || process.env.UI_CORS_ORIGIN || '*'
  res.setHeader('Access-Control-Allow-Origin', origin)
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-ui-key,x-user-chat-id')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const readKey = req.headers['x-ui-key'] || req.query.ui_key || process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY
  if (!readKey || String(readKey) !== (process.env.UI_READ_KEY || process.env.VITE_UI_READ_KEY)) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const { message, chat_id } = req.body || {}
  if (!message || typeof message !== 'string') return res.status(400).json({ error: 'Missing message' })

  const user = await resolveUiUserContext(req)
  const target = chat_id || user.chatId
  if (!target) return res.status(500).json({ error: 'No target chat configured' })

  try {
    const numeric = Number(target)
    const resp = await sendMessage(numeric, message)
    return res.status(200).json({ ok: true, resp })
  } catch (e: any) {
    return res.status(500).json({ error: String(e) })
  }
}
