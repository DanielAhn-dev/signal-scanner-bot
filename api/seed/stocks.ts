// api/seed/stocks.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supa } from "../../src/lib/supa";
import type { StockRow } from "../../src/types/db";
import { fetchAllKRX } from "../../src/adapters/stocks";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });
  const secret = req.headers["x-internal-secret"];
  if (secret !== process.env.CRON_SECRET)
    return res.status(401).json({ ok: false });

  const rows: StockRow[] = await fetchAllKRX();

  const { data, error } = await supa()
    .from("stocks")
    .upsert<StockRow>( // 반환 타입 지정
      rows.map((r: StockRow) => ({
        ...r,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "code" }
    )
    .select(); // data를 반환 받아 length 사용 가능

  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true, count: data?.length ?? 0 });
}
