// api/update/stocks.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { supaAdmin, isAuthorized, ok, bad, UpdateResult } from "./_shared";
import * as XLSX from "xlsx";

// KRX 상장법인 XLS (회사명/종목코드/업종 등 포함)
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

    // 1) 섹터 맵 로드: 이름 키워드 매칭을 위해 미리 가져옴
    const { data: sectors } = await supa
      .from("sectors")
      .select("id,name,metrics");

    const sectorRows = sectors ?? [];

    // name 또는 id에서 키워드 탐색
    const sectorResolver = (industry: string | undefined) => {
      const s = (industry || "").trim();
      if (!s) return null;

      // 간단 매칭 규칙
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

      // 정확 일치/부분 일치 최후 매칭
      const byName = sectorRows.find((x: any) => (x.name || "").includes(s));
      return (byName?.id as string) || null;
    };

    // 2) KRX XLS 다운로드 및 파싱
    const resp = await fetch(KRX_LIST_URL);
    if (!resp.ok) {
      throw new Error(`KRX list download failed: ${resp.status}`);
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    const wb = XLSX.read(buf, { type: "buffer" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<KRXRow>(ws);

    // 3) 종목 payload 생성
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

    // 4) 기존 조회
    const { data: existing } = await supa
      .from("stocks")
      .select("code,name,sector_id");

    const existingRows = existing ?? [];
    const existByCode = new Map(existingRows.map((r: any) => [r.code, r]));

    // 5) 삽입/갱신 카운팅
    let inserted = 0;
    let updated = 0;

    for (const row of payload) {
      const prev = existByCode.get(row.code);
      if (!prev) {
        inserted += 1;
      } else {
        const changedName = (prev.name || "") !== row.name;
        const changedSector =
          (prev.sector_id || null) !== (row.sector_id || null);
        if (changedName || changedSector) {
          updated += 1;
        }
      }
    }

    // 6) upsert 실행
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
