import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPA_URL = process.env.SUPABASE_URL || "";
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || process.env.CRON_SECRET || "";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).end();
  }

  const REQUIRE_SECRET_IN_PROD = process.env.NODE_ENV === 'production';
  const hdr = String(req.headers["x-internal-secret"] || "");
  if (INTERNAL_SECRET && hdr !== INTERNAL_SECRET) {
    if (REQUIRE_SECRET_IN_PROD) return res.status(401).json({ error: "unauthorized" });
    console.warn('[getUserByTg] missing or invalid internal secret (non-prod)')
  }

  const chatId = String(req.query.chatId || "").trim();
  if (!chatId) return res.status(400).json({ error: "chatId required" });
  if (!SERVICE_KEY || !SUPA_URL) return res.status(500).json({ error: "server misconfigured" });

  const supa = createClient(SUPA_URL, SERVICE_KEY, { auth: { persistSession: false } });

  try {
    const { data, error } = await supa
      .from("users")
      .select("tg_id, username, first_name, last_name, language_code, is_active, prefs")
      .eq("tg_id", Number(chatId))
      .single();

    if (error) {
      if ((error as any).code === "PGRST116") {
        // no rows
        return res.status(404).json({ error: "not_found" });
      }
      return res.status(500).json({ error: (error as any).message || 'db error' });
    }

    // Cache lightly
    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60');
    return res.status(200).json(data);
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
