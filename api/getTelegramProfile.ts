import type { VercelRequest, VercelResponse } from "@vercel/node";

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || process.env.CRON_SECRET || "";
const REQUIRE_SECRET_IN_PROD = process.env.NODE_ENV === 'production';

type CacheEntry = { expiresAt: number; data: any };
const CACHE_MS = 30 * 1000; // 30s
const cache = new Map<string, CacheEntry>();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end();
  }

  // in production require internal secret to be set and provided
  if (REQUIRE_SECRET_IN_PROD && !INTERNAL_SECRET) {
    return res.status(500).json({ error: 'INTERNAL_API_SECRET must be set in production' });
  }

  const hdr = String(req.headers["x-internal-secret"] || "");
  if (INTERNAL_SECRET && hdr !== INTERNAL_SECRET) {
    if (REQUIRE_SECRET_IN_PROD) return res.status(401).json({ error: "unauthorized" });
    // in non-prod, allow but log
    console.warn('[getTelegramProfile] missing or invalid internal secret (non-prod)')
  }

  const chatId = String(req.query.chatId || "").trim();
  if (!chatId) return res.status(400).json({ error: "chatId required" });

  if (!TELEGRAM_TOKEN) return res.status(500).json({ error: "server misconfigured" });

  // check cache
  const cached = cache.get(chatId);
  if (cached && cached.expiresAt > Date.now()) {
    res.setHeader('X-Cache', 'HIT');
    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=30');
    return res.status(200).json(cached.data);
  }

  try {
    const url = `https://api.telegram.org/bot${encodeURIComponent(TELEGRAM_TOKEN)}/getChat?chat_id=${encodeURIComponent(chatId)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    const json = await resp.json();
    if (!json || !json.ok) {
      return res.status(502).json({ error: json?.description || 'telegram api error' });
    }

    const chat = json.result || {};
    const out = {
      id: chat.id,
      type: chat.type,
      username: chat.username || null,
      first_name: chat.first_name || null,
      last_name: chat.last_name || null,
      title: chat.title || null,
      is_bot: chat.is_bot || false,
    };

    cache.set(chatId, { expiresAt: Date.now() + CACHE_MS, data: out });
    res.setHeader('X-Cache', 'MISS');
    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=30');
    return res.status(200).json(out);
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
