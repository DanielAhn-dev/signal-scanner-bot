import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supaAdmin, isAuthorized, ok, bad, UpdateResult } from "../../src/lib/apiUpdateShared";
import * as XLSX from "xlsx";
import fs from "node:fs/promises";
import path from "node:path";

const KRX_LIST_URL =
  "https://kind.krx.co.kr/corpgeneral/corpList.do?method=download";

type KRXRow = {
  회사명?: string;
  종목코드?: string;
  업종?: string;
};

type AliasRow = { alias: string; sector_id: string };

type ExistingSectorRow = { id: string; name: string | null; metrics: Record<string, unknown> | null };
type ExistingStockRow = { code: string; name: string | null; sector_id: string | null };

function pad6(s: string) {
  return (s || "").replace(/\D/g, "").padStart(6, "0");
}

function normalizeLabel(s: string): string {
  return String(s || "").trim().replace(/\s+/g, "").toLowerCase();
}

async function loadAliasRows(): Promise<AliasRow[]> {
  const filePath = path.join(process.cwd(), "data", "sector_aliases.json");
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row: any) => ({
        alias: String(row?.alias || "").trim(),
        sector_id: String(row?.sector_id || "").trim(),
      }))
      .filter((row: AliasRow) => row.alias && row.sector_id);
  } catch {
    return [];
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!isAuthorized(req)) return bad(res, 401, "unauthorized");

  try {
    const supa = supaAdmin();

    const { data: sectors } = await supa.from("sectors").select("id,name,metrics");

    const sectorRows: ExistingSectorRow[] = sectors ?? [];
    const aliasRows = await loadAliasRows();
    const aliasMap = new Map<string, string>(
      aliasRows.map((row) => [normalizeLabel(row.alias), row.sector_id])
    );
    const sectorIdSet = new Set<string>(sectorRows.map((row) => String(row.id)));
    const sectorNameMap = new Map<string, string>(
      sectorRows
        .filter((row) => row.name)
        .map((row) => [normalizeLabel(String(row.name)), String(row.id)])
    );

    const sectorResolver = (industry: string | undefined): string | null => {
      const s = (industry || "").trim();
      if (!s) return null;

      const norm = normalizeLabel(s);
      const viaAlias = aliasMap.get(norm);
      if (viaAlias) return viaAlias;

      const viaName = sectorNameMap.get(norm);
      if (viaName) return viaName;

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
            (x: ExistingSectorRow) => x.id === target || (x.name || "").includes(kw)
          );
          if (found) return found.id as string;
        }
      }

      const byName = sectorRows.find((x: ExistingSectorRow) => (x.name || "").includes(s));
      if (byName?.id) return byName.id as string;

      // 마지막 폴백: 원문 업종명을 KRX prefix sector id로 사용
      return `KRX:${s}`;
    };

    const resp = await fetch(KRX_LIST_URL);
    if (!resp.ok) {
      throw new Error(`KRX list download failed: ${resp.status}`);
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<KRXRow>(ws);

    const nowIso = new Date().toISOString();
    const payload = rows
      .map((r: KRXRow) => {
        const code = pad6(String(r.종목코드 || ""));
        const name = String(r.회사명 || "").trim();
        const industry = String(r.업종 || "").trim();
        if (!code || !name) return null;
        const sector_id = sectorResolver(industry);
        return { code, name, sector_id, updated_at: nowIso };
      })
      .filter(Boolean) as {
      code: string;
      name: string;
      sector_id: string | null;
      updated_at: string;
    }[];

    // stocks 업서트 전, payload에서 발견된 신규 sector_id를 먼저 보장
    const missingSectorIds = [...new Set(payload.map((row) => row.sector_id).filter((id): id is string => !!id && !sectorIdSet.has(id)))];
    if (missingSectorIds.length) {
      const sectorSeedRows = missingSectorIds.map((id) => ({
        id,
        name: id.startsWith("KRX:") ? id.replace(/^KRX:/, "") : id,
        metrics: {},
      }));
      await supa.from("sectors").upsert(sectorSeedRows, { onConflict: "id" });
    }

    const { data: existing } = await supa.from("stocks").select("code,name,sector_id");

    const existingRows: ExistingStockRow[] = existing ?? [];
    const existByCode = new Map(existingRows.map((r: ExistingStockRow) => [r.code, r]));

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
