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

  const sectors: SectorRow[] = await fetchAllSectorsWithMetrics();

  const { data, error } = await supabase
    .from("sectors")
    .upsert<SectorRow>( // 제네릭으로 반환 타입 지정
      sectors.map((s: SectorRow) => ({
        ...s,
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "id" }
    )
    .select(); // data를 반환받아 length 사용 가능

  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true, count: data?.length ?? 0 });
}
