import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supaAdmin, isAuthorized, ok, bad, UpdateResult } from "../../src/lib/apiUpdateShared";
import * as XLSX from "xlsx";

const KRX_LIST_URL =
  "https://kind.krx.co.kr/corpgeneral/corpList.do?method=download";

type KRXRow = {
  회사명?: string;
  종목코드?: string;
  업종?: string;
};

function pad6(s: string) {
  return (s || "").replace(/\D/g, "").padStart(6, "0");
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!isAuthorized(req)) return bad(res, 401, "unauthorized");

  try {
    const supa = supaAdmin();

    const { data: sectors } = await supa.from("sectors").select("id,name,metrics");

    const sectorRows = sectors ?? [];

    const sectorResolver = (industry: string | undefined) => {
      const s = (industry || "").trim();
      if (!s) return null;

      const rules: [string, string][] = [
        ["반도체", "semiconductor"],
        ["전자", "electronics"],
        ["전기전자", "electronics"],
        ["전자장비", "electronics"],
        ["화학", "chemicals"],
        ["철강", "steel"],
        ["기계", "machinery"],
        ["조선", "shipbuilding"],
        ["운수장비", "shipbuilding"],
        ["은행", "banks"],
        ["금융", "banks"],
      ];

      for (const [kw, target] of rules) {
        if (s.includes(kw)) {
          const found = sectorRows.find(
            (x: any) => x.id === target || (x.name || "").includes(kw)
          );
          if (found) return found.id as string;
        }
      }

      const byName = sectorRows.find((x: any) => (x.name || "").includes(s));
      return (byName?.id as string) || null;
    };

    const resp = await fetch(KRX_LIST_URL);
    if (!resp.ok) {
      throw new Error(`KRX list download failed: ${resp.status}`);
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<KRXRow>(ws);

    const payload = rows
      .map((r: KRXRow) => {
        const code = pad6(String(r.종목코드 || ""));
        const name = String(r.회사명 || "").trim();
        if (!code || !name) return null;
        const sector_id = sectorResolver(String(r.업종 || "").trim());
        return { code, name, sector_id };
      })
      .filter(Boolean) as {
      code: string;
      name: string;
      sector_id: string | null;
    }[];

    const { data: existing } = await supa.from("stocks").select("code,name,sector_id");

    const existingRows = existing ?? [];
    const existByCode = new Map(existingRows.map((r: any) => [r.code, r]));

    let inserted = 0;
    let updated = 0;

    for (const row of payload) {
      const prev = existByCode.get(row.code);
      if (!prev) {
        inserted += 1;
      } else {
        const changedName = (prev.name || "") !== row.name;
        const changedSector = (prev.sector_id || null) !== (row.sector_id || null);
        if (changedName || changedSector) {
          updated += 1;
        }
      }
    }

    await supa.from("stocks").upsert(payload, { onConflict: "code" });

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
