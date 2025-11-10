// api/seed/sectors.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createClient } from "@supabase/supabase-js";
import type { SectorRow } from "../../src/types/db";
import { fetchAllSectorsWithMetrics } from "../../src/adapters/sectors";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_ANON_KEY!
);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });
  const secret = req.headers["x-internal-secret"];
  if (secret !== process.env.CRON_SECRET)
    return res.status(401).json({ ok: false });

  try {
    const sectors: SectorRow[] = await fetchAllSectorsWithMetrics();
    if (!sectors?.length) {
      console.warn("seed sectors: empty list");
      return res.status(200).json({ ok: true, count: 0 });
    }

    const { data, error } = await supabase
      .from("sectors")
      .upsert<SectorRow>(
        sectors.map((s) => ({ ...s, updated_at: new Date().toISOString() })),
        { onConflict: "id" }
      )
      .select();

    if (error) return res.status(500).json({ ok: false, error: error.message });

    console.log("seed sectors result", {
      count: data?.length,
      sample: data?.slice(0, 3),
    });
    return res.json({ ok: true, count: data?.length ?? 0 });
  } catch (e: any) {
    console.error("seed sectors error", e);
    return res
      .status(500)
      .json({ ok: false, error: e?.message || "unknown error" });
  }
}
