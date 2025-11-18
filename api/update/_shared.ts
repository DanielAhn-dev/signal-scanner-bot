// api/update/_shared.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";

export type UpdateResult = {
  total: number;
  inserted: number;
  updated: number;
  changed: number;
  error?: string;
};

export function supaAdmin() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error("Supabase env missing");
  return createClient(url, key, { auth: { persistSession: false } });
}

export function isAuthorized(req: VercelRequest) {
  const secret =
    (req.headers["x-telegram-bot-secret"] as string) ||
    (req.headers["x-cron-secret"] as string);
  return (
    !!secret &&
    (secret === process.env.TELEGRAM_BOT_SECRET ||
      secret === process.env.CRON_SECRET)
  );
}

export function ok(res: VercelResponse, body: UpdateResult) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.status(200).send(body);
}
export function bad(res: VercelResponse, code = 401, msg = "unauthorized") {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res
    .status(code)
    .send({ total: 0, inserted: 0, updated: 0, changed: 0, error: msg });
}

export function slugify(s: string) {
  return (s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]/g, "");
}
