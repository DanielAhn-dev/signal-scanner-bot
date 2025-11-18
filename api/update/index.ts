// api/update/index.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

type UpdateResult = {
  total: number;
  inserted: number;
  updated: number;
  changed: number;
  error?: string;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const headers = {
    "x-telegram-bot-secret":
      (req.headers["x-telegram-bot-secret"] as string) ||
      (req.headers["x-cron-secret"] as string) ||
      "",
  };

  const base = `https://${req.headers.host}`;

  const [st, sc] = await Promise.all([
    fetch(`${base}/api/update/stocks`, { method: "POST", headers }),
    fetch(`${base}/api/update/sectors`, { method: "POST", headers }),
  ]);

  const b1 = (await st.json()) as UpdateResult;
  const b2 = (await sc.json()) as UpdateResult;

  return res.status(200).json({
    stocks: { status: st.status, ...b1 },
    sectors: { status: sc.status, ...b2 },
  });
}
