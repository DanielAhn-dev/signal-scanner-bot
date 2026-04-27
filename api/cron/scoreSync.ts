import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { syncScoresFromEngine } from "../../src/services/scoreSyncService";
import { parsePositiveInt } from "../../src/server/cronQuery";

const CRON_SECRET = process.env.CRON_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const config = {
  maxDuration: 60,
};

function isKrxSessionKstNow(now = new Date()): boolean {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const day = kst.getUTCDay();
  if (day === 0 || day === 6) return false;
  const minutes = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  const open = 9 * 60;
  const close = 15 * 60 + 30;
  return minutes >= open && minutes <= close;
}

function parseBooleanLike(value: unknown): boolean | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim().toLowerCase();
  if (!text) return undefined;
  if (["1", "true", "yes", "on", "y"].includes(text)) return true;
  if (["0", "false", "no", "off", "n"].includes(text)) return false;
  return undefined;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).send("Method Not Allowed");
  }

  if (req.headers.authorization !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).send("Unauthorized");
  }

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(500).send("Missing SUPABASE credentials");
  }

  try {
    const limit = parsePositiveInt(req.query.limit);
    const concurrency = parsePositiveInt(req.query.concurrency);
    const asof = typeof req.query.asof === "string" ? req.query.asof : undefined;
    const fastQuery = parseBooleanLike(req.query.fast);
    const fastMode = fastQuery ?? (!limit && !concurrency ? isKrxSessionKstNow() : false);

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false },
    });

    const summary = await syncScoresFromEngine(supabase, {
      asof,
      limit,
      concurrency,
      fastMode,
    });

    return res.status(200).json({
      ok: true,
      fastMode,
      summary,
    });
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: error?.message ?? "score sync failed",
    });
  }
}
