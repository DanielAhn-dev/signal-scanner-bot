/**
 * etf_distributions 테이블 접근 (db/migrations/039). 업로드 미리보기·저장·요약이 쓴다.
 * 서버(service role)만 읽고 쓴다. 1000행에서 조용히 잘리므로 요약은 range 루프로 읽는다.
 */
import { matchStockName, type DistributionRow, type StockNameRow } from "../lib/distributionImport";
import type { DistRow } from "../lib/distributionStats";

export type StoredDistribution = { code: string; record_date: string; pay_date: string | null; per_share: number; rate_pct: number | null };

export type StockLookup = StockNameRow & { close: number | null };

const PAGE = 1000;
const CHUNK = 500;

/** 기존 값과 비교: 새 기준일 / 금액이 달라지는 기준일 / 같은 기준일 */
export function diffDistributions(
  existing: Array<{ record_date: string; per_share: number }>,
  incoming: DistributionRow[],
): { added: number; changed: number; same: number } {
  const old = new Map(existing.map((r) => [r.record_date, Number(r.per_share)]));
  let added = 0;
  let changed = 0;
  let same = 0;
  for (const r of incoming) {
    const prev = old.get(r.recordDate);
    if (prev == null) added++;
    else if (Math.abs(prev - r.perShare) > 1e-9) changed++;
    else same++;
  }
  return { added, changed, same };
}

/** 한 주당 분배금이 현재가의 25%를 넘으면 오입력(단위·상품 착오) 의심 */
export function suspiciousRows(rows: DistributionRow[], close: number | null): DistributionRow[] {
  if (!close || close <= 0) return [];
  return rows.filter((r) => r.perShare > close * 0.25);
}

/** 상품명으로 stocks 후보를 찾는다 — 공백 개수가 달라도 맞도록 공백 자리를 와일드카드로 */
export async function findStocksByName(supabase: any, hint: string): Promise<StockLookup[]> {
  const core = hint.trim();
  if (core.length < 3) return [];
  const pattern = `%${core.replace(/[%_,()]/g, " ").trim().replace(/\s+/g, "%")}%`;
  const { data, error } = await supabase.from("stocks").select("code,name,close").ilike("name", pattern).limit(20);
  if (error) throw new Error(`종목 조회 실패: ${error.message}`);
  return (data ?? []).map((r: any) => ({ code: String(r.code), name: String(r.name), close: r.close != null ? Number(r.close) : null }));
}

export async function findStockByCode(supabase: any, code: string): Promise<StockLookup | null> {
  const { data, error } = await supabase.from("stocks").select("code,name,close").eq("code", code).maybeSingle();
  if (error) throw new Error(`종목 조회 실패: ${error.message}`);
  return data ? { code: String(data.code), name: String(data.name), close: data.close != null ? Number(data.close) : null } : null;
}

/** 파일에서 읽은 코드(ISIN) 또는 상품명으로 상품을 정한다. 이름은 정확히 같을 때만 확정, 아니면 후보 */
export async function resolveProduct(
  supabase: any,
  parsed: { code: string | null; nameHint: string },
): Promise<{ stock: StockLookup | null; source: "isin" | "name" | "none"; candidates: StockLookup[] }> {
  if (parsed.code) {
    const stock = await findStockByCode(supabase, parsed.code);
    return { stock, source: stock ? "isin" : "none", candidates: stock ? [stock] : [] };
  }
  const found = await findStocksByName(supabase, parsed.nameHint);
  const m = matchStockName(parsed.nameHint, found);
  const stock = m.code ? found.find((s) => s.code === m.code) ?? null : null;
  return { stock, source: stock ? "name" : "none", candidates: found.slice(0, 5) };
}

export async function loadExisting(supabase: any, code: string, fromDate: string): Promise<Array<{ record_date: string; per_share: number }>> {
  const { data, error } = await supabase.from("etf_distributions").select("record_date,per_share").eq("code", code).gte("record_date", fromDate).limit(PAGE);
  if (error) throw new Error(`기존 분배금 조회 실패: ${error.message}`);
  return (data ?? []).map((r: any) => ({ record_date: String(r.record_date), per_share: Number(r.per_share) }));
}

export async function upsertDistributions(supabase: any, code: string, rows: DistributionRow[], sourceFile: string): Promise<number> {
  const now = new Date().toISOString();
  const payload = rows.map((r) => ({
    code,
    record_date: r.recordDate,
    pay_date: r.payDate,
    per_share: r.perShare,
    rate_pct: r.ratePct,
    source_file: sourceFile.slice(0, 200),
    updated_at: now,
  }));
  let written = 0;
  for (let i = 0; i < payload.length; i += CHUNK) {
    const part = payload.slice(i, i + CHUNK);
    const { error } = await supabase.from("etf_distributions").upsert(part, { onConflict: "code,record_date" });
    if (error) throw new Error(`분배금 저장 실패(${written}행까지 저장됨): ${error.message}`);
    written += part.length;
  }
  return written;
}

export type DistributionSummaryRow = {
  code: string;
  name: string | null;
  count: number;
  firstDate: string;
  lastDate: string;
  lastPerShare: number;
  updatedAt: string | null;
};

/** 저장된 상품별 요약 (상품 수는 수십 개, 행은 수백~수천 개라 끝까지 읽는다) */
export async function loadSummary(supabase: any): Promise<DistributionSummaryRow[]> {
  const rows: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("etf_distributions")
      .select("code,record_date,per_share,updated_at")
      .order("code", { ascending: true })
      .order("record_date", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`분배금 요약 조회 실패: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  const by = new Map<string, DistributionSummaryRow>();
  for (const r of rows) {
    const code = String(r.code);
    const cur = by.get(code);
    const updated = r.updated_at ? String(r.updated_at) : null;
    if (!cur) {
      by.set(code, { code, name: null, count: 1, firstDate: String(r.record_date), lastDate: String(r.record_date), lastPerShare: Number(r.per_share), updatedAt: updated });
    } else {
      cur.count++;
      cur.lastDate = String(r.record_date);
      cur.lastPerShare = Number(r.per_share);
      if (updated && (!cur.updatedAt || updated > cur.updatedAt)) cur.updatedAt = updated;
    }
  }
  const codes = [...by.keys()];
  if (codes.length) {
    const { data } = await supabase.from("stocks").select("code,name").in("code", codes);
    for (const s of data ?? []) {
      const row = by.get(String(s.code));
      if (row) row.name = String(s.name);
    }
  }
  return [...by.values()].sort((a, b) => (a.lastDate < b.lastDate ? 1 : -1));
}

/** 상품 코드별 기준일·지급일 이력(다음 분배 일정 추정용, 최근 2년) */
export async function loadDistributionDates(supabase: any, codes: string[], fromDate: string): Promise<Map<string, Array<{ record_date: string; pay_date: string | null }>>> {
  const out = new Map<string, Array<{ record_date: string; pay_date: string | null }>>();
  const uniq = [...new Set(codes.filter(Boolean))].slice(0, 80);
  if (!uniq.length) return out;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("etf_distributions")
      .select("code,record_date,pay_date")
      .in("code", uniq)
      .gte("record_date", fromDate)
      .order("code", { ascending: true })
      .order("record_date", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`분배 일정 이력 조회 실패: ${error.message}`);
    for (const r of data ?? []) {
      const code = String(r.code);
      out.set(code, [...(out.get(code) ?? []), { record_date: String(r.record_date), pay_date: r.pay_date ? String(r.pay_date) : null }]);
    }
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/** 상품 코드별 분배금 이력(기준일 오름차순). 코드는 가이드 보유 종목 수준(수십 개)이라 in 조건으로 받고, 행은 끝까지 읽는다 */
export async function loadDistributionRows(supabase: any, codes: string[]): Promise<Map<string, DistRow[]>> {
  const out = new Map<string, DistRow[]>();
  const uniq = [...new Set(codes.filter(Boolean))].slice(0, 80);
  if (!uniq.length) return out;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("etf_distributions")
      .select("code,record_date,per_share")
      .in("code", uniq)
      .order("code", { ascending: true })
      .order("record_date", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`분배금 이력 조회 실패: ${error.message}`);
    for (const r of data ?? []) {
      const code = String(r.code);
      out.set(code, [...(out.get(code) ?? []), { record_date: String(r.record_date), per_share: Number(r.per_share) }]);
    }
    if (!data || data.length < PAGE) break;
  }
  return out;
}
