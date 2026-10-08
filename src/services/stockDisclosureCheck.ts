/**
 * 한 종목의 최근 1년 위험·희석 공시 점검 — 종목 분석 화면 "이 종목 공시 점검"용.
 *
 * DART list.json을 회사 코드로 2번(주요사항보고 B, 거래소공시 I) 부르고 classifyDisclosure로 범주를 붙인다.
 * 같은 종목은 6시간 동안 인스턴스 메모리에 둬서 다시 부르지 않는다(DART 한도 20,000회/일, 조회당 2~4회).
 * 화면에 붙는 과거 수치는 웹(disclosureStats.ts)이 가진다 — 여기서는 사실(어떤 공시가 언제 났나)만 돌려준다.
 */
import { classifyDisclosure, DISCLOSURE_RISK_LABEL, type DisclosureRiskCategory } from "../lib/disclosureRisk";
import { isExchangeTradedProduct } from "../lib/securitiesTax";
import { resolveCorpCodeWithRefresh } from "./stockDividend";

const DART = "https://opendart.fss.or.kr/api";
const CACHE_MS = 6 * 60 * 60 * 1000;
export const DISCLOSURE_CHECK_DAYS = 365;
const MAX_PAGES = 3;

export type DisclosureCheckItem = { category: DisclosureRiskCategory; label: string; date: string; reportName: string; rceptNo: string };
export type DisclosureCheck = {
  code: string;
  status: "ok" | "not_company" | "no_key" | "error";
  since: string;
  items: DisclosureCheckItem[];
  counts: Partial<Record<DisclosureRiskCategory, number>>;
  fetchedAt: string;
};

const cache = new Map<string, { at: number; value: DisclosureCheck }>();

const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");

export async function fetchStockDisclosureCheck(
  code: string,
  now = new Date(),
  apiKey = process.env.DART_API_KEY,
  fetchImpl: typeof fetch = fetch
): Promise<DisclosureCheck> {
  const since = new Date(now.getTime() - DISCLOSURE_CHECK_DAYS * 86400000);
  const base: DisclosureCheck = { code, status: "ok", since: ymd(since), items: [], counts: {}, fetchedAt: now.toISOString() };
  if (!apiKey) return { ...base, status: "no_key" };
  if (isExchangeTradedProduct(code)) return { ...base, status: "not_company" };
  const hit = cache.get(code);
  if (hit && now.getTime() - hit.at < CACHE_MS) return hit.value;

  const corp = await resolveCorpCodeWithRefresh(code, apiKey, fetchImpl);
  if (!corp) return { ...base, status: "not_company" };
  try {
    const items: DisclosureCheckItem[] = [];
    for (const ty of ["B", "I"]) {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const url =
          `${DART}/list.json?crtfc_key=${encodeURIComponent(apiKey)}&corp_code=${corp.corpCode}` +
          `&bgn_de=${ymd(since)}&end_de=${ymd(now)}&pblntf_ty=${ty}&page_no=${page}&page_count=100`;
        const res = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(`DART HTTP ${res.status}`);
        const json = (await res.json()) as {
          status?: string;
          total_page?: number;
          list?: Array<{ report_nm?: string; rcept_dt?: string; rcept_no?: string }>;
        };
        if (json.status === "013") break; // 결과 없음
        if (json.status !== "000") throw new Error(`DART status ${json.status}`);
        for (const r of json.list ?? []) {
          const category = classifyDisclosure(String(r.report_nm ?? ""));
          if (!category) continue;
          items.push({
            category,
            label: DISCLOSURE_RISK_LABEL[category],
            date: String(r.rcept_dt ?? ""),
            reportName: String(r.report_nm ?? "").replace(/\s+/g, " ").trim(),
            rceptNo: String(r.rcept_no ?? ""),
          });
        }
        if (page >= Number(json.total_page || 1)) break;
      }
    }
    items.sort((a, b) => b.date.localeCompare(a.date));
    const counts: DisclosureCheck["counts"] = {};
    for (const it of items) counts[it.category] = (counts[it.category] ?? 0) + 1;
    const value = { ...base, items, counts };
    cache.set(code, { at: now.getTime(), value });
    return value;
  } catch (e) {
    console.error("[stockDisclosureCheck]", code, e);
    return { ...base, status: "error" };
  }
}
