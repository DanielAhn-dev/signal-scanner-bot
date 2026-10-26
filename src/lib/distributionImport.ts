/**
 * 운용사 분배금 엑셀 → 분배금 행. 순수 함수라 DB 없이 테스트한다 (저장은 src/services/etfDistributionStore.ts).
 *
 * 운용사마다 파일 모양이 다르다 (2026-10 기준):
 *   KODEX  .xls   제목(상품명) / 조회일 / [지급기준일, 실지급일, 분배율(%), 분배금액(원), 주당 과세 표준액(원)]
 *   SOL    .xls   제목(신한 SOL …증권상장지수투자신탁[…]) / 기준일 / [No., 지급기준일, 실제지급일, 분배금액(원), 과표기준가…]
 *   RISE   .xlsx  제목 없음(상품명은 파일명) [지급기준일, 실지급일, 분배금액(원), 주당과세표준액(원), 분배율(%)]
 *   TIGER  .xls   실제로는 HTML 표 [No, 종목코드(ISIN), 종목명, 지급기준일, 실지급일, 분배금액(원), 과세표준액(원)]
 * 그래서 열 위치가 아니라 머리글 이름으로 열을 찾는다. 상품 코드는 TIGER만 ISIN으로 알 수 있고 나머지는 상품명으로 stocks와 맞춘다.
 * 이름이 정확히 같을 때만 코드를 정하고, 부분 일치는 후보로만 돌려 사람이 고르게 한다 (후보 1개면 채택했다가 오매칭이 났던 적이 있다).
 */
import * as XLSX from "xlsx";

export type DistributionRow = {
  recordDate: string;
  payDate: string | null;
  /** 세전 주당 분배금 (원) */
  perShare: number;
  /** 운용사가 적은 분배율(%) — 파일에 없으면 null */
  ratePct: number | null;
};

export type ParsedDistributionFile =
  | {
      ok: true;
      fileName: string;
      /** 파일 안에서 읽은 상품 코드 (TIGER ISIN) — 없으면 null */
      code: string | null;
      /** 시트 제목·종목명·파일명에서 정리한 상품명 (stocks.name과 맞출 때 쓴다) */
      nameHint: string;
      rows: DistributionRow[];
      warnings: string[];
    }
  | { ok: false; fileName: string; error: string };

const DATE_LIKE = /^(\d{4})[-/.]?(\d{2})[-/.]?(\d{2})$/;

function toDateKey(v: unknown): string | null {
  if (typeof v === "number" && v > 30_000 && v < 80_000) {
    const d = XLSX.SSF.parse_date_code(v);
    return d ? `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}` : null;
  }
  const m = String(v ?? "").trim().match(DATE_LIKE);
  if (!m) return null;
  const [, y, mo, d] = m;
  if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) return null;
  return `${y}-${mo}-${d}`;
}

function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v ?? "").replace(/,/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** 파일명·시트 제목에서 상품명만 남긴다 (날짜·운용사 내부 코드·신탁 설명 제거) */
export function cleanProductName(raw: string): string {
  return String(raw ?? "")
    .replace(/\.(xlsx?|html?)$/i, "")
    .replace(/_분배금_.*$/, "")
    .replace(/_\d{8}.*$/, "")
    .replace(/_[0-9A-Z]{4}$/, "")
    .replace(/증권(상장지수)?(투자)?신탁.*$/, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/^신한\s*/, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const norm = (s: string) => s.replace(/\s+/g, "").toUpperCase();

export type StockNameRow = { code: string; name: string };

/**
 * 상품명 → 종목 코드. 정리한 이름이 stocks.name과 (공백·대소문자 무시) 정확히 같고 하나뿐일 때만 code를 준다.
 * 그 밖에는 부분 일치 후보만 돌려준다 — 사람이 미리보기에서 확인하고 고른다.
 */
export function matchStockName(hint: string, stocks: StockNameRow[]): { code: string | null; candidates: StockNameRow[] } {
  const h = norm(cleanProductName(hint));
  if (!h) return { code: null, candidates: [] };
  const exact = stocks.filter((s) => norm(s.name) === h);
  if (exact.length === 1) return { code: exact[0].code, candidates: exact };
  if (exact.length > 1) return { code: null, candidates: exact };
  if (h.length < 6) return { code: null, candidates: [] };
  const part = stocks.filter((s) => {
    const n = norm(s.name);
    return n.includes(h) || h.includes(n);
  });
  return { code: null, candidates: part.slice(0, 5) };
}

type Grid = unknown[][];

function readGrid(bytes: Uint8Array): Grid | string {
  try {
    const wb = XLSX.read(bytes, { type: "array", raw: true, cellDates: false });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) return "빈 파일입니다.";
    return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "", blankrows: false });
  } catch {
    return "엑셀 파일로 읽을 수 없습니다.";
  }
}

export function parseDistributionFile(fileName: string, bytes: Uint8Array): ParsedDistributionFile {
  const fail = (error: string): ParsedDistributionFile => ({ ok: false, fileName, error });
  if (!bytes.length) return fail("빈 파일입니다.");
  if (bytes.length > 2_000_000) return fail("파일이 너무 큽니다 (2MB 이하).");
  const grid = readGrid(bytes);
  if (typeof grid === "string") return fail(grid);

  // 머리글 행: '기준일'과 '분배금'이 같이 있는 첫 행
  const headerIdx = grid.slice(0, 15).findIndex((r) => r.some((c) => /기준일/.test(String(c))) && r.some((c) => /분배금/.test(String(c))));
  if (headerIdx < 0) return fail("분배금 표를 찾지 못했습니다. 보유종목 표나 다른 파일일 수 있습니다.");
  const header = grid[headerIdx].map((c) => String(c).replace(/\s+/g, ""));
  const col = (re: RegExp) => header.findIndex((c) => re.test(c));
  const cRecord = col(/기준일/);
  const cPay = col(/지급일/);
  const cAmount = col(/분배금/);
  const cRate = col(/분배율/);
  const cIsin = col(/종목코드/);
  const cName = col(/종목명/);
  if (cRecord < 0 || cAmount < 0) return fail("지급기준일 또는 분배금액 열을 찾지 못했습니다.");

  const warnings: string[] = [];
  const byDate = new Map<string, DistributionRow>();
  const codes = new Set<string>();
  let nameFromRows = "";
  for (const r of grid.slice(headerIdx + 1)) {
    const recordDate = toDateKey(r[cRecord]);
    const perShare = toNumber(r[cAmount]);
    if (!recordDate || perShare == null) continue;
    if (perShare <= 0) {
      warnings.push(`${recordDate}: 분배금이 0 이하라 건너뜁니다.`);
      continue;
    }
    let payDate = cPay >= 0 ? toDateKey(r[cPay]) : null;
    if (payDate && payDate < recordDate) {
      warnings.push(`${recordDate}: 지급일(${payDate})이 기준일보다 빨라 지급일을 비웠습니다.`);
      payDate = null;
    }
    const rate = cRate >= 0 ? toNumber(r[cRate]) : null;
    if (cIsin >= 0) {
      const m = String(r[cIsin]).match(/^KR7([0-9A-Z]{6})/);
      if (m) codes.add(m[1]);
    }
    if (cName >= 0 && !nameFromRows) nameFromRows = String(r[cName]).trim();
    if (byDate.has(recordDate)) warnings.push(`${recordDate}: 같은 기준일이 두 번 있어 뒤의 값을 썼습니다.`);
    byDate.set(recordDate, { recordDate, payDate, perShare, ratePct: rate });
  }
  if (!byDate.size) return fail("분배금 행을 하나도 읽지 못했습니다.");
  if (codes.size > 1) return fail("한 파일에 상품이 둘 이상 들어 있습니다. 상품별로 나눠 올려 주세요.");

  // 상품명: 머리글 위쪽 제목(날짜 아닌 첫 칸) > 종목명 열 > 파일명
  const title = grid
    .slice(0, headerIdx)
    .flat()
    .map((c) => String(c).trim())
    .find((c) => c && !DATE_LIKE.test(c));
  const nameHint = cleanProductName(title || nameFromRows || fileName);
  const rows = [...byDate.values()].sort((a, b) => (a.recordDate < b.recordDate ? -1 : 1));
  return { ok: true, fileName, code: codes.size === 1 ? [...codes][0] : null, nameHint, rows, warnings };
}
