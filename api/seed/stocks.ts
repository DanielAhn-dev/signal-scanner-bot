// api/update/stocks.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supa } from "../../src/lib/supa";
import { loadAllKRXStocks } from "../../src/lib/snapshot";
import { diffStocks } from "../../src/lib/diff";
import { StockRow } from "../../src/types/db";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });
  if ((req.headers["x-internal-secret"] || "") !== process.env.CRON_SECRET)
    return res.status(401).json({ ok: false });

  try {
    const snap = await loadAllKRXStocks();
    const { data: cur, error: qErr } = await supa()
      .from("stocks")
      .select("code,name,market,liquidity");
    if (qErr) return res.status(500).json({ ok: false, error: qErr.message });

    const { inserted, updated, total } = diffStocks(snap, cur || []);
    const payload = [...inserted, ...updated].map((x) => ({
      ...x,
      updated_at: new Date().toISOString(),
    }));

    let changed = 0;
    if (payload.length) {
      const { data, error } = await supa()
        .from("stocks")
        .upsert<StockRow>(payload, { onConflict: "code" })
        .select();
      if (error)
        return res.status(500).json({ ok: false, error: error.message });
      changed = data?.length ?? 0;
    }
    return res.json({
      ok: true,
      total,
      inserted: inserted.length,
      updated: updated.length,
      changed,
    });
  } catch (e: any) {
    return res
      .status(500)
      .json({ ok: false, error: e?.message || "update failed" });
  }
}
