/**
 * 네이버 모바일 API(integration, finance/annual)를 예전 finance.naver.com 표 형식으로 바꾼다.
 * finance.naver.com/item/main.naver 가 stock.naver.com 으로 넘어가 옛 HTML 표가 사라졌다(2026-10 이전부터 전 종목 PER·PBR·ROE 공백).
 * 아래 계산 로직(fundamentalParser)은 '실적 3칸 + 컨센서스 1칸' 행 배열을 기대하므로 그 모양으로 맞춘다.
 */
import { ACTUAL_ANNUAL_COLUMN_COUNT, parseNum } from "./fundamentalParser";

export type MobileFinanceData = {
  rows: Record<string, string[]>;
  currentPer?: number;
  currentPbr?: number;
  marketCap?: number;
};

type TotalInfo = { code?: string; value?: string };
type AnnualRow = { title?: string; columns?: Record<string, { value?: string }> };
type AnnualCol = { key?: string; isConsensus?: string };

/** "1,095조 81억" → 원 단위 숫자 */
export function parseKoreanMoneyText(text: string): number | undefined {
  const normalized = String(text || "").replace(/\s+/g, "").replace(/,/g, "").trim();
  if (!normalized) return undefined;

  const tokenMatches = normalized.match(/-?\d+(?:\.\d+)?(?:조|억|만)/g);
  if (!tokenMatches?.length) return parseNum(normalized);

  let total = 0;
  for (const token of tokenMatches) {
    const match = token.match(/(-?\d+(?:\.\d+)?)(조|억|만)/);
    if (!match) continue;
    const value = Number(match[1]);
    if (!Number.isFinite(value)) continue;
    if (match[2] === "조") total += value * 1_0000_0000_0000;
    else if (match[2] === "억") total += value * 1_0000_0000;
    else total += value * 10_000;
  }
  return total > 0 ? Math.round(total) : parseNum(normalized);
}

function totalInfoValue(totalInfos: unknown, code: string): string {
  if (!Array.isArray(totalInfos)) return "";
  const hit = (totalInfos as TotalInfo[]).find((x) => x?.code === code);
  return String(hit?.value ?? "");
}

/** "6.68배" → 6.68 */
function parseMultiple(text: string): number | undefined {
  const m = text.match(/-?\d+(?:,\d{3})*(?:\.\d+)?/);
  return m ? parseNum(m[0]) : undefined;
}

export function buildMobileFinance(integration: any, financeAnnual: any): MobileFinanceData {
  const out: MobileFinanceData = { rows: {} };

  const infos = integration?.totalInfos;
  out.currentPer = parseMultiple(totalInfoValue(infos, "per"));
  out.currentPbr = parseMultiple(totalInfoValue(infos, "pbr"));
  out.marketCap = parseKoreanMoneyText(totalInfoValue(infos, "marketValue"));

  const info = financeAnnual?.financeInfo;
  const cols: AnnualCol[] = Array.isArray(info?.trTitleList) ? info.trTitleList : [];
  const rowList: AnnualRow[] = Array.isArray(info?.rowList) ? info.rowList : [];
  const actualKeys = cols.filter((c) => c?.isConsensus !== "Y" && c?.key).map((c) => String(c.key));
  const consensusKey = cols.find((c) => c?.isConsensus === "Y" && c?.key)?.key;

  // 최근 실적 3칸(모자라면 앞을 '-'로 채움) + 컨센서스 1칸
  const lastActual = actualKeys.slice(-ACTUAL_ANNUAL_COLUMN_COUNT);
  const pad = Array(Math.max(0, ACTUAL_ANNUAL_COLUMN_COUNT - lastActual.length)).fill("-");

  for (const row of rowList) {
    const title = String(row?.title ?? "").replace(/\s+/g, "").trim();
    if (!title || !row.columns) continue;
    const cell = (k: string) => String(row.columns?.[k]?.value ?? "-") || "-";
    out.rows[title] = [...pad, ...lastActual.map(cell), consensusKey ? cell(String(consensusKey)) : "-"];
  }

  return out;
}
