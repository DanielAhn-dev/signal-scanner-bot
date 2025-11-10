// api/seed/sectors.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supa } from "../../src/lib/supa";
import { fetchAllSectors, SectorRow } from "../../src/adapters/sectors";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });
  if ((req.headers["x-internal-secret"] || "") !== process.env.CRON_SECRET)
    return res.status(401).json({ ok: false });

  try {
    const sectors = await fetchAllSectors();
    if (!sectors?.length) return res.status(200).json({ ok: true, count: 0 });

    const chunk = 500;
    let total = 0;
    for (let i = 0; i < sectors.length; i += chunk) {
      const part = sectors
        .slice(i, i + chunk)
        .map((s) => ({ ...s, updated_at: new Date().toISOString() }));
      const { data, error } = await supa()
        .from("sectors")
        .upsert<SectorRow>(part, { onConflict: "id" })
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
