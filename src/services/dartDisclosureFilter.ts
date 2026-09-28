/**
 * 공시 악재 매수 제외 필터 (금감원 DART Open API, 무료 — 환경변수 DART_API_KEY 필요, 없으면 동작하지 않음).
 *
 * 최근 며칠 안에 희석·재무위험 공시(유상증자·감자·CB/BW 발행·횡령배임·회생 등)가 난 종목은 신규 매수 후보에서 뺀다.
 * 주요사항보고서(pblntf_ty=B)만 조회해 요청 수를 하루 수 회로 유지한다(DART 한도 20,000회/일).
 * 호재 공시(자사주 취득 등) 가점은 수익 근거가 확인되지 않아 넣지 않는다 — 손실 회피 목적의 차단만 한다.
 */

const DART_LIST_URL = "https://opendart.fss.or.kr/api/list.json";
export const DISCLOSURE_LOOKBACK_DAYS = 5;

/** 보고서명에 이 표현이 있으면 악재로 본다 (정정 공시 포함) */
const NEGATIVE_REPORT_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /유상증자결정|유무상증자결정/, label: "유상증자" },
  { pattern: /감자결정/, label: "감자" },
  { pattern: /전환사채권발행결정/, label: "전환사채" },
  { pattern: /신주인수권부사채권발행결정/, label: "신주인수권부사채" },
  { pattern: /교환사채권발행결정/, label: "교환사채" },
  { pattern: /횡령|배임/, label: "횡령·배임" },
  { pattern: /회생절차|파산신청|해산사유/, label: "회생·파산" },
  { pattern: /영업정지|부도발생|은행거래정지/, label: "영업·거래 정지" },
];

export type DisclosureHit = { code: string; label: string; reportName: string; date: string };

export function classifyNegativeDisclosure(reportName: string): string | null {
  const name = String(reportName ?? "");
  if (/철회|취소/.test(name)) return null; // 결정 철회·취소는 악재 해소
  return NEGATIVE_REPORT_PATTERNS.find((p) => p.pattern.test(name))?.label ?? null;
}

function ymd(date: Date): string {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, "");
}

/**
 * 필터 동작 상태 — 키 누락·키 오류가 "악재 0건"과 구분되지 않아 조용히 꺼져 있는 걸 막는다.
 *   off   = DART_API_KEY 없음
 *   ok    = 조회 성공 (hits가 비어 있으면 최근 악재 공시 없음)
 *   error = 키 오류(010·011·020 등)·네트워크 오류 — 이 경우 필터가 동작하지 않은 것
 */
export type DisclosureFilterStatus = "off" | "ok" | "error";

export type DisclosureFilterResult = {
  status: DisclosureFilterStatus;
  hits: Map<string, DisclosureHit>;
  error?: string;
};

/** 최근 lookbackDays 동안 악재 공시가 난 상장 종목(6자리 코드) + 필터 상태 */
export async function fetchNegativeDisclosures(
  lookbackDays = DISCLOSURE_LOOKBACK_DAYS,
  apiKey = process.env.DART_API_KEY,
  fetchImpl: typeof fetch = fetch
): Promise<DisclosureFilterResult> {
  const hits = new Map<string, DisclosureHit>();
  if (!apiKey) return { status: "off", hits };
  const end = new Date();
  const start = new Date(end.getTime() - lookbackDays * 24 * 60 * 60 * 1000);
  try {
    for (let page = 1; page <= 10; page += 1) {
      const url =
        `${DART_LIST_URL}?crtfc_key=${encodeURIComponent(apiKey)}&bgn_de=${ymd(start)}&end_de=${ymd(end)}` +
        `&pblntf_ty=B&page_no=${page}&page_count=100`;
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) return { status: "error", hits, error: `HTTP ${res.status}` };
      const json = (await res.json()) as {
        status?: string;
        message?: string;
        total_page?: number;
        list?: Array<{ stock_code?: string; report_nm?: string; rcept_dt?: string; corp_cls?: string }>;
      };
      if (json.status === "013") break; // 조회 결과 없음 = 정상
      if (json.status !== "000") {
        // 010 미등록 키, 011 사용할 수 없는 키, 020 요청 제한 초과 등
        return { status: "error", hits, error: `${json.status ?? "?"} ${json.message ?? ""}`.trim() };
      }
      for (const item of json.list ?? []) {
        const code = String(item.stock_code ?? "").trim();
        if (!/^\d{6}$/.test(code) || !["Y", "K"].includes(String(item.corp_cls))) continue; // 유가·코스닥만
        const label = classifyNegativeDisclosure(String(item.report_nm ?? ""));
        if (label && !hits.has(code)) {
          hits.set(code, { code, label, reportName: String(item.report_nm), date: String(item.rcept_dt ?? "") });
        }
      }
      if (!json.total_page || page >= json.total_page) break;
    }
  } catch (e) {
    return { status: "error", hits, error: e instanceof Error ? e.message : String(e) };
  }
  return { status: "ok", hits };
}

/** 후보 선정 메모·점검 리포트에 붙는 한 줄 */
export function formatDisclosureFilterNote(result: DisclosureFilterResult): string {
  if (result.status === "off") return "공시필터 꺼짐(DART_API_KEY 없음)";
  if (result.status === "error") return `공시필터 오류(${result.error ?? "알 수 없음"})`;
  return result.hits.size > 0 ? `공시악재 ${result.hits.size}종목 제외` : "공시필터 정상(악재 0)";
}

/** 최근 lookbackDays 동안 악재 공시가 난 상장 종목(6자리 코드) */
export async function fetchNegativeDisclosureCodes(
  lookbackDays = DISCLOSURE_LOOKBACK_DAYS,
  apiKey = process.env.DART_API_KEY
): Promise<Map<string, DisclosureHit>> {
  return (await fetchNegativeDisclosures(lookbackDays, apiKey)).hits;
}
