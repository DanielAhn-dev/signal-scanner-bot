// api/cron/sync-stocks.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { KRXClient } from "../../packages/data/krx-client";
const URL = process.env.SUPABASE_URL!,
  KEY = process.env.SUPABASE_ANON_KEY!,
  CRON_SECRET = process.env.CRON_SECRET;

async function upsert(rows: any[]) {
  await fetch(`${URL}/rest/v1/stocks`, {
    method: "POST",
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates",
    },
    body: JSON.stringify(rows),
  });
}

async function resolveSector(code: string): Promise<string | null> {
  try {
    const r = await fetch(
      `https://finance.naver.com/item/main.nhn?code=${code}`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    const h = await r.text();
    const m =
      h.match(/업종<\/span>\s*<\/dt>\s*<dd[^>]*>\s*<a[^>]*>([^<]+)<\/a>/i) ||
      h.match(/업종[^<]*<a[^>]*>([^<]+)/i);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (CRON_SECRET && req.headers["x-cron-secret"] !== CRON_SECRET)
    return res.status(401).send("Unauthorized");
  const limit = Math.min(
      parseInt((req.query.limit as string) || "300", 10),
      1000
    ),
    offset = parseInt((req.query.cursor as string) || "0", 10);

  const krx = new KRXClient();
  const list = await krx.getStockList("ALL");
  for (let i = 0; i < list.length; i += 500)
    await upsert(list.slice(i, i + 500));

  const r = await fetch(
    `${URL}/rest/v1/stocks?select=code&sector=is.null&order=code.asc&limit=${limit}&offset=${offset}`,
    { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } }
  );
  const missing = (await r.json()) as { code: string }[];
  if (!missing.length)
    return res.status(200).json({ done: true, processed: 0 });

  const updates: any[] = [];
  let idx = 0;
  const pool = 8;
  await Promise.all(
    Array.from({ length: pool }).map(async () => {
      while (idx < missing.length) {
        const i = idx++;
        const s = await resolveSector(missing[i].code);
        if (s) updates.push({ code: missing[i].code, sector: s });
      }
    })
  );
  if (updates.length) await upsert(updates);

  return res
    .status(200)
    .json({
      done: false,
      processed: missing.length,
      nextCursor: offset + limit,
    });
}
