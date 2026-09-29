/**
 * 개별 종목 배당금 — 공시된 1주당 배당금 × 받을 자격이 있는 보유 수량을 가상 계좌에 넣는다 (ETF 분배금과 같은 방식).
 *
 * - 데이터: DART "현금ㆍ현물배당결정" 공시 본문 (배당기준일·1주당 배당금·지급 예정일)
 * - 받을 자격: 배당락일(기준일 전 거래일) 전날까지 산 수량 — etfDistribution.eligibleQuantity
 * - 지급일이 지난 첫 점검 때 세후(15.4%) 금액을 현금·확정 수익에 넣는다 → 매주 시드 재계산 때 재투자
 * - 결산배당은 주총 뒤에 지급해 공시에 지급일이 없다("-"). 그땐 주총일 + 30일, 주총일도 없으면
 *   결정 연도 4월 30일(12월 결산 법인의 주총 후 1개월 법정 기한)로 잡고 기록에 "예정일 추정"으로 남긴다.
 * - DART는 동시 요청을 끊으므로 차례대로 부른다. 종목별 결과는 6시간 캐시.
 */
import { readZipEntries } from "../lib/zipReader";
import { isExchangeTradedProduct } from "../lib/securitiesTax";
import corpCodes from "../data/dartCorpCodes.json";
import type { EtfDistribution } from "./etfDistribution";

export type StockDividend = EtfDistribution & {
  /** 지급일을 공시에서 못 읽어 추정했는지 */
  payDateEstimated: boolean;
  rceptNo: string;
};

const DART = "https://opendart.fss.or.kr/api";
/** 이 기간 안에 난 배당결정 공시를 본다 (1월 말 결산배당 결정 → 4월 지급까지 포함) */
export const DIVIDEND_DISCLOSURE_LOOKBACK_DAYS = 200;

/**
 * 종목코드 → DART 회사 코드. 저장소의 표(pnpm gen:dart-corps로 다시 만든다)에 없는 종목(새 상장)이 나오면
 * DART corpCode.xml을 받아 채운다 — 하루 한 번까지, 인스턴스 메모리에만.
 */
const CORP_CODES: Record<string, string> = { ...(corpCodes as Record<string, string>) };
const CORP_REFRESH_MS = 24 * 60 * 60 * 1000;
let corpRefreshedAt = 0;

/** corpCode.xml → 상장사만 { 종목코드: 회사코드 } */
export function parseCorpCodeXml(xml: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, blk] of xml.matchAll(/<list>([\s\S]*?)<\/list>/g)) {
    const stock = blk.match(/<stock_code>\s*(\w{6})\s*<\/stock_code>/)?.[1];
    const corp = blk.match(/<corp_code>\s*(\d{8})\s*<\/corp_code>/)?.[1];
    if (stock && corp) out[stock] = corp;
  }
  return out;
}

/** DART가 3.6MB를 3~16초에 준다 — 자동매매 실행 중엔 짧게(20초), 스크립트에선 길게 */
export async function downloadCorpCodes(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 20_000
): Promise<Record<string, string>> {
  const res = await fetchImpl(`${DART}/corpCode.xml?crtfc_key=${encodeURIComponent(apiKey)}`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`corpCode.xml HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const entry = readZipEntries(buf).find((e) => /corpcode\.xml$/i.test(e.name));
  if (!entry) throw new Error("corpCode.xml: zip entry not found");
  return parseCorpCodeXml(entry.data.toString("utf8"));
}

/** 표에 없는 종목이 나왔을 때 — 하루 한 번까지만 DART에서 표를 새로 받는다. 받았으면 true */
async function refreshCorpCodesOnMiss(apiKey: string, fetchImpl: typeof fetch): Promise<boolean> {
  if (Date.now() - corpRefreshedAt < CORP_REFRESH_MS) return false;
  corpRefreshedAt = Date.now(); // 실패해도 하루 동안 다시 시도하지 않는다 (3.6MB 다운로드)
  try {
    Object.assign(CORP_CODES, await downloadCorpCodes(apiKey, fetchImpl));
    return true;
  } catch (e) {
    console.error("[stockDividend] corpCode refresh failed", e);
    return false;
  }
}

/** 우선주(005935 등)는 공시가 보통주 회사 코드로 나므로 끝자리를 0으로 바꿔 찾는다 */
export function resolveCorpCode(code: string): { corpCode: string; preferred: boolean } | null {
  if (CORP_CODES[code]) return { corpCode: CORP_CODES[code], preferred: false };
  const base = `${code.slice(0, 5)}0`;
  if (base !== code && CORP_CODES[base]) return { corpCode: CORP_CODES[base], preferred: true };
  return null;
}

const plain = (xml: string) =>
  xml
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " | ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");

const SEP = "[|\\s]*";
const pick = (text: string, label: string, value: string) => text.match(new RegExp(`${label}${SEP}(${value})`))?.[1] ?? "";
const DATE = "\\d{4}-\\d{2}-\\d{2}";

const addDays = (key: string, days: number) =>
  new Date(new Date(`${key}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);

/** 배당결정 공시 본문 → 이 종목(보통주/우선주)의 현금배당. 현물배당만이거나 값을 못 읽으면 null */
export function parseDividendDecision(
  xml: string,
  input: { code: string; preferred: boolean; rceptNo: string }
): StockDividend | null {
  const text = plain(xml);
  const kind = pick(text, "배당종류", "[^|]+").trim();
  if (kind && !kind.includes("현금")) return null;
  const perShareBlock = text.match(new RegExp(`1주당${SEP}배당금\\(원\\)${SEP}보통주식${SEP}([\\d,]+|-)${SEP}종류주식${SEP}([\\d,]+|-)`));
  const raw = perShareBlock ? perShareBlock[input.preferred ? 2 : 1] : "";
  const perShare = Number(String(raw).replace(/,/g, ""));
  const recordDate = pick(text, "배당기준일", DATE);
  if (!recordDate || !Number.isFinite(perShare) || perShare <= 0) return null;
  let payDate = pick(text, "배당금지급\\s*예정일자", DATE);
  let payDateEstimated = false;
  if (!payDate) {
    payDateEstimated = true;
    const agm = pick(text, "주주총회\\s*예정일자", DATE);
    const decided = pick(text, "이사회결의일\\(결정일\\)", DATE);
    if (agm) payDate = addDays(agm, 30);
    else if (decided && recordDate > decided) payDate = addDays(recordDate, 30);
    else {
      // 기준일 다음에 오는 첫 4월 30일 (12/31 기준 → 이듬해 4/30)
      const y = Number(recordDate.slice(0, 4));
      payDate = `${recordDate.slice(5) < "04-30" ? y : y + 1}-04-30`;
    }
    if (payDate < recordDate) payDate = addDays(recordDate, 30);
  }
  return {
    code: input.code,
    recordDate,
    payDate,
    perShare,
    taxablePerShare: perShare, // 일반 배당은 전액 과세
    payDateEstimated,
    rceptNo: input.rceptNo,
  };
}

function decodeXml(buf: Buffer): string {
  const head = buf.subarray(0, 200).toString("latin1");
  const enc = /encoding="(euc-kr|ks_c_5601-1987|cp949)"/i.test(head) ? "euc-kr" : "utf-8";
  return new TextDecoder(enc).decode(buf);
}

const ymd = (key: string) => key.replace(/-/g, "");
const cache = new Map<string, { at: number; list: StockDividend[] }>();
const docCache = new Map<string, string>();
const CACHE_MS = 6 * 60 * 60 * 1000;

/** 한 종목의 최근 배당결정 공시들 (정정 공시가 있으면 같은 기준일은 최신 것만) */
export async function fetchStockDividends(
  code: string,
  todayKey: string,
  apiKey = process.env.DART_API_KEY,
  fetchImpl: typeof fetch = fetch
): Promise<StockDividend[]> {
  if (!apiKey) return [];
  let corp = resolveCorpCode(code);
  // ETF·ETN은 DART 회사가 아니다 — 표를 새로 받아도 없다
  if (!corp && !isExchangeTradedProduct(code) && (await refreshCorpCodesOnMiss(apiKey, fetchImpl))) corp = resolveCorpCode(code);
  if (!corp) return [];
  const hit = cache.get(code);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.list;
  try {
    const listUrl =
      `${DART}/list.json?crtfc_key=${encodeURIComponent(apiKey)}&corp_code=${corp.corpCode}` +
      `&bgn_de=${ymd(addDays(todayKey, -DIVIDEND_DISCLOSURE_LOOKBACK_DAYS))}&end_de=${ymd(todayKey)}&pblntf_ty=I&page_count=100`;
    const res = await fetchImpl(listUrl, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const json = (await res.json()) as { status?: string; list?: Array<{ rcept_no?: string; report_nm?: string }> };
    if (json.status !== "000" && json.status !== "013") return [];
    const items = (json.list ?? [])
      // "(자회사의 주요경영사항)"은 지주사가 대신 낸 자회사 배당 — 이 종목 주주가 받는 돈이 아니다
      .filter((x) => /배당결정/.test(String(x.report_nm ?? "")) && !/철회|취소|자회사/.test(String(x.report_nm ?? "")))
      .map((x) => String(x.rcept_no ?? ""))
      .filter(Boolean)
      .sort(); // 접수번호 오름차순 = 시간순 → 정정 공시가 뒤에 와서 덮어쓴다
    const byRecord = new Map<string, StockDividend>();
    for (const rceptNo of items) {
      let xml = docCache.get(rceptNo);
      if (!xml) {
        const doc = await fetchImpl(`${DART}/document.xml?crtfc_key=${encodeURIComponent(apiKey)}&rcept_no=${rceptNo}`, {
          signal: AbortSignal.timeout(8000),
        });
        if (!doc.ok) continue;
        const buf = Buffer.from(await doc.arrayBuffer());
        if (buf.readUInt32LE(0) !== 0x04034b50) continue; // ZIP이 아니면 오류 응답(JSON/XML)
        const entry = readZipEntries(buf)[0];
        if (!entry) continue;
        xml = decodeXml(entry.data);
        docCache.set(rceptNo, xml);
      }
      const d = parseDividendDecision(xml, { code, preferred: corp.preferred, rceptNo });
      if (d) byRecord.set(d.recordDate, d);
    }
    const list = [...byRecord.values()].sort((a, b) => a.recordDate.localeCompare(b.recordDate));
    cache.set(code, { at: Date.now(), list });
    return list;
  } catch (e) {
    console.error("[stockDividend] fetch failed", code, e);
    return [];
  }
}
