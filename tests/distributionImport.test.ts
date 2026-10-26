import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { cleanProductName, matchStockName, parseDistributionFile } from "../src/lib/distributionImport";

function sheetBytes(aoa: unknown[][], bookType: "biff8" | "xlsx"): Uint8Array {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Sheet1");
  return new Uint8Array(XLSX.write(wb, { type: "array", bookType }));
}

const KODEX = sheetBytes(
  [
    ["KODEX 200커버드콜액티브", "", "", "", ""],
    ["2026/10/23", "", "", "", ""],
    ["지급기준일", "실지급일", "분배율(%)", "분배금액(원)", "주당 과세 표준액(원)"],
    ["20260930", "20261002", 2.0774, 175, 0],
    ["20260831", "20260902", 1.9389, 167, 0],
  ],
  "biff8",
);

const SOL = sheetBytes(
  [
    ["신한 SOL 200타겟위클리커버드콜증권상장지수투자신탁[주식-파생형]", "", "", "", "", ""],
    ["20260930", "", "", "", "", ""],
    ["No.", "지급기준일", "실제지급일", "분배금액(원)", "과표기준가(원)", "배당과표기준가(원)"],
    [1, "20260930", "20261001", "170", "9985.74", "9923.1"],
    [2, "20260831", "20260901", "168", "9925", "9926.84"],
  ],
  "biff8",
);

// RISE: 상품명이 파일 안에 없고, 한 행은 지급일이 기준일보다 앞선 오타(2026-05-15 → 2025-05-19)
const RISE = sheetBytes(
  [
    ["지급기준일", "실지급일", "분배금액(원)", "주당과세표준액(원)", "분배율(%)"],
    ["2026-10-15", "2026-10-19", "465", "46", "2.89"],
    ["2026-05-15", "2025-05-19", "390", "8", "1.84"],
  ],
  "xlsx",
);

const TIGER_HTML = new TextEncoder().encode(
  `<html><body><table>
  <tr><th>No</th><th>종목코드</th><th>종목명</th><th>지급기준일</th><th>실지급일</th><th>분배금액(원)</th><th>과세표준액(원)</th></tr>
  <tr><td>1</td><td>KR7472150002</td><td>TIGER 배당커버드콜액티브</td><td>2026-09-30</td><td>2026-10-02</td><td>425</td><td>0</td></tr>
  <tr><td>2</td><td>KR7472150002</td><td>TIGER 배당커버드콜액티브</td><td>2026-08-31</td><td>2026-09-02</td><td>1,413</td><td>6</td></tr>
  </table></body></html>`,
);

test("KODEX .xls: 제목이 상품명, 열은 머리글 이름으로 찾는다", () => {
  const r = parseDistributionFile("KODEX_200커버드콜액티브_20261023.xls", KODEX);
  assert.ok(r.ok);
  assert.equal(r.nameHint, "KODEX 200커버드콜액티브");
  assert.equal(r.code, null);
  assert.deepEqual(r.rows.map((x) => [x.recordDate, x.perShare, x.ratePct]), [
    ["2026-08-31", 167, 1.9389],
    ["2026-09-30", 175, 2.0774],
  ]);
  assert.equal(r.rows[1].payDate, "2026-10-02");
});

test("SOL .xls: 신탁 설명을 뗀 상품명, 분배금이 문자열이어도 숫자로", () => {
  const r = parseDistributionFile("SOL 200타겟위클리커버드콜.xls", SOL);
  assert.ok(r.ok);
  assert.equal(r.nameHint, "SOL 200타겟위클리커버드콜");
  assert.deepEqual(r.rows.map((x) => x.perShare), [168, 170]);
  assert.equal(r.rows[0].ratePct, null);
});

test("RISE .xlsx: 제목이 없으면 파일명에서 상품명, 지급일이 기준일보다 앞서면 비우고 경고", () => {
  const r = parseDistributionFile("RISE 코리아밸류업위클리고정커버드콜_44J2_분배금_2026-10-26.xlsx", RISE);
  assert.ok(r.ok);
  assert.equal(r.nameHint, "RISE 코리아밸류업위클리고정커버드콜");
  const may = r.rows.find((x) => x.recordDate === "2026-05-15")!;
  assert.equal(may.payDate, null);
  assert.equal(may.perShare, 390);
  assert.ok(r.warnings.some((w) => w.includes("2026-05-15")));
});

test("TIGER HTML(.xls): ISIN에서 코드, 천 단위 쉼표 분배금", () => {
  const r = parseDistributionFile("TIGER 배당커버드콜액티브.xls", TIGER_HTML);
  assert.ok(r.ok);
  assert.equal(r.code, "472150");
  assert.equal(r.nameHint, "TIGER 배당커버드콜액티브");
  assert.deepEqual(r.rows.map((x) => x.perShare), [1413, 425]);
});

test("분배금이 아닌 표(보유종목)·빈 파일은 이유와 함께 거절한다", () => {
  const holdings = sheetBytes([["KODEX 금융고배당 투자종목정보(PDF)"], ["종목", "수량", "비중"], ["삼성전자", 10, 5]], "biff8");
  const a = parseDistributionFile("holdings.xls", holdings);
  assert.equal(a.ok, false);
  const b = parseDistributionFile("empty.xls", new Uint8Array());
  assert.equal(b.ok, false);
});

test("한 파일에 상품이 둘이면 거절한다", () => {
  const html = new TextEncoder().encode(
    `<table><tr><th>종목코드</th><th>종목명</th><th>지급기준일</th><th>분배금액(원)</th></tr>
     <tr><td>KR7472150002</td><td>A</td><td>2026-09-30</td><td>425</td></tr>
     <tr><td>KR7498400003</td><td>B</td><td>2026-09-30</td><td>300</td></tr></table>`,
  );
  const r = parseDistributionFile("two.xls", html);
  assert.equal(r.ok, false);
});

test("cleanProductName: 날짜·운용사 내부 코드·신탁 설명 제거", () => {
  assert.equal(cleanProductName("KODEX_200커버드콜액티브_20261023.xls"), "KODEX 200커버드콜액티브");
  assert.equal(cleanProductName("RISE 코리아밸류업위클리고정커버드콜_44J2_분배금_2026-10-26.xlsx"), "RISE 코리아밸류업위클리고정커버드콜");
  assert.equal(cleanProductName("신한 SOL 200타겟위클리커버드콜증권상장지수투자신탁[주식-파생형]"), "SOL 200타겟위클리커버드콜");
});

test("matchStockName: 정확히 같고 하나뿐일 때만 코드, 부분 일치는 후보만", () => {
  const stocks = [
    { code: "0167B0", name: "SOL 200타겟위클리커버드콜" },
    { code: "498400", name: "KODEX 200타겟위클리커버드콜" },
    { code: "0219E0", name: "KODEX 200커버드콜액티브" },
  ];
  assert.equal(matchStockName("SOL 200타겟위클리커버드콜", stocks).code, "0167B0");
  assert.equal(matchStockName("sol200타겟위클리커버드콜", stocks).code, "0167B0");
  const part = matchStockName("200타겟위클리커버드콜", stocks);
  assert.equal(part.code, null);
  assert.equal(part.candidates.length, 2);
  assert.equal(matchStockName("없는 상품 이름입니다", stocks).candidates.length, 0);
  // 같은 이름이 둘이면 코드를 정하지 않는다
  assert.equal(matchStockName("A", [{ code: "1", name: "A" }, { code: "2", name: "A" }]).code, null);
});
