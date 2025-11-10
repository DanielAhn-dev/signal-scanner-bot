// api/seed/stocks.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supa } from "../src/lib/supa";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });
  const secret = req.headers["x-internal-secret"];
  if (secret !== process.env.CRON_SECRET)
    return res.status(401).json({ ok: false });

  // TODO: 여기서는 외부 어댑터 호출로 전체 티커/이름/시장 수집
  const rows: Array<{
    code: string;
    name: string;
    market?: string;
    updated_at?: string;
  }> = await fetchAllKRX();

  const { data, error } = await supa()
    .from("stocks")
    .upsert(
      rows.map((r) => ({ ...r, updated_at: new Date().toISOString() })),
      { onConflict: "code" }
    );
  if (error) return res.status(500).json({ ok: false, error: error.message });
  return res.json({ ok: true, count: data?.length ?? 0 });
}
