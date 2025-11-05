// api/cron/sync-stocks.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { KRXClient } from "../../packages/data/krx-client";

const URL = process.env.SUPABASE_URL!;
const KEY = process.env.SUPABASE_ANON_KEY!; // RLS 쓰면 SERVICE_KEY 권장
const CRON_SECRET = process.env.CRON_SECRET;

async function upsertStocks(rows: any[]) {
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

// 간단 업종 파서(네이버 HTML 폴백)
async function resolveSector(code: string): Promise<string | null> {
  try {
    const r = await fetch(
      `https://finance.naver.com/item/main.nhn?code=${code}`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    const html = await r.text();
    const m =
      html.match(/업종<\/span>\s*<\/dt>\s*<dd[^>]*>\s*<a[^>]*>([^<]+)<\/a>/i) ||
      html.match(/class="summary_info".*?업종[^>]*>\s*<a[^>]*>([^<]+)/is);
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
  );
  const offset = parseInt((req.query.cursor as string) || "0", 10);

  // 1) 전체 목록 동기화(code/name/market)
  const krx = new KRXClient();
  const list = await krx.getStockList("ALL"); // [{ code,name,market }]
  // 배치 upsert
  for (let i = 0; i < list.length; i += 500) {
    const slice = list.slice(i, i + 500);
    await upsertStocks(slice);
  }

  // 2) 섹터가 비어있는 코드 페이징 조회
  const resp = await fetch(
    `${URL}/rest/v1/stocks?select=code&sector=is.null&order=code.asc&limit=${limit}&offset=${offset}`,
    {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    }
  );
  const missing = (await resp.json()) as { code: string }[];
  if (!missing.length)
    return res.status(200).json({ done: true, processed: 0 });

  // 3) 제한된 동시성으로 업종 해석
  const updates: any[] = [];
  const pool = 8;
  let idx = 0;
  async function worker() {
    while (idx < missing.length) {
      const i = idx++;
      const code = missing[i].code;
      const sector = await resolveSector(code);
      if (sector) updates.push({ code, sector });
    }
  }
  await Promise.all(Array.from({ length: pool }, worker));

  if (updates.length) await upsertStocks(updates);

  const next = offset + limit;
  return res
    .status(200)
    .json({ done: false, processed: missing.length, nextCursor: next });
}
