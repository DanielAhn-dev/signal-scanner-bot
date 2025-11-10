// api/seed/stocks.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supa } from "../../src/lib/supa";
import { fetchAllKRX, StockRow } from "../../src/adapters/stocks";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });
  if ((req.headers["x-internal-secret"] || "") !== process.env.CRON_SECRET)
    return res.status(401).json({ ok: false });

  try {
    const rows = await fetchAllKRX(); // 전체 KRX
    if (!rows?.length) return res.status(200).json({ ok: true, count: 0 });

    const chunk = 500;
    let total = 0;
    for (let i = 0; i < rows.length; i += chunk) {
      const part = rows
        .slice(i, i + chunk)
        .map((r) => ({ ...r, updated_at: new Date().toISOString() }));
      const { data, error } = await supa()
        .from("stocks")
        .upsert<StockRow>(part, { onConflict: "code" })
        .select();
      if (error)
        return res.status(500).json({ ok: false, error: error.message });
      total += data?.length ?? 0;
    }
    return res.json({ ok: true, count: total });
  } catch (e: any) {
    return res
      .status(500)
      .json({ ok: false, error: e?.message || "seed failed" });
  }
}
