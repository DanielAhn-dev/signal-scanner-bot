import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import { syncScoresFromEngine } from "../../src/services/scoreSyncService";
import { parsePositiveInt } from "./query";

const CRON_SECRET = process.env.CRON_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const config = {
  maxDuration: 60,
};

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

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false },
    });

    const summary = await syncScoresFromEngine(supabase, {
      asof,
      limit,
      concurrency,
    });

    return res.status(200).json({
      ok: true,
      summary,
    });
  } catch (error: any) {
    return res.status(500).json({
      ok: false,
      error: error?.message ?? "score sync failed",
    });
  }
}
