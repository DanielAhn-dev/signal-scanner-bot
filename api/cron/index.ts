// api/cron/index.ts  (POST만 허용, x-internal-secret 검증)
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getUniverse } from "../../src/adapters";
import { supabase } from "../../src/db/client";

const INTERNAL_SECRET = process.env.CRON_SECRET || "";

export const config = { api: { bodyParser: false } };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end();
  if ((req.headers["x-internal-secret"] as string) !== INTERNAL_SECRET)
    return res.status(401).end();

  // 1) 외부에서 code,name 수집
  const list = await getUniverse("ALL"); // [{ code, name, market? }]
  const rows = (list || []).map((x: any) => ({ code: x.code, name: x.name }));

  // 2) Supabase로 배치 업서트 (chunk 처리)
  const chunk = 500;
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const { error } = await supabase
      .from("stocks")
      .upsert(slice, { onConflict: "code" });
    if (error) console.error("upsert error", error);
  }

  return res.status(200).json({ ok: true, count: rows.length });
}
