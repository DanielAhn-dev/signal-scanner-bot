import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  supaAdmin,
  isAuthorized,
  ok,
  bad,
  slugify,
  UpdateResult,
} from "../../src/lib/apiUpdateShared";

type SectorSeed = { id: string; name: string; metrics: { krx_index?: string } };
type ExistingSectorRow = { id: string; name: string | null; metrics: Record<string, unknown> | null };

const SEED: SectorSeed[] = [
  { id: "semiconductor", name: "반도체", metrics: { krx_index: "1014" } },
  {
    id: "electronics",
    name: "전자장비/전기전자",
    metrics: { krx_index: "1013" },
  },
  { id: "chemicals", name: "화학", metrics: { krx_index: "1010" } },
  { id: "steel", name: "철강", metrics: { krx_index: "1011" } },
  { id: "machinery", name: "기계", metrics: { krx_index: "1012" } },
  { id: "shipbuilding", name: "조선/운수장비", metrics: { krx_index: "1017" } },
  { id: "banks", name: "은행/금융", metrics: { krx_index: "1027" } },
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!isAuthorized(req)) return bad(res, 401, "unauthorized");

  try {
    const supa = supaAdmin();

    const { data: existing } = await supa.from("sectors").select("id,name,metrics");

    const existingRows: ExistingSectorRow[] = existing ?? [];
    const existById = new Map(existingRows.map((r: ExistingSectorRow) => [r.id, r]));

    const payload = SEED.map((s) => ({
      id: slugify(s.id || s.name),
      name: s.name,
      metrics: s.metrics || {},
    }));

    let inserted = 0;
    let updated = 0;

    for (const row of payload) {
      const prev = existById.get(row.id);
      if (!prev) {
        inserted += 1;
      } else {
        const changedName = (prev.name || "") !== row.name;
        const changedMetrics =
          JSON.stringify(prev.metrics || {}) !== JSON.stringify(row.metrics || {});
        if (changedName || changedMetrics) {
          updated += 1;
        }
      }
    }

    await supa.from("sectors").upsert(payload, { onConflict: "id" });

    const result: UpdateResult = {
      total: payload.length,
      inserted,
      updated,
      changed: inserted + updated,
    };

    return ok(res, result);
  } catch (e: any) {
    return bad(res, 500, e?.message || "failed");
  }
}
