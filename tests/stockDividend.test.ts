import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import { parseDividendDecision, resolveCorpCode, fetchStockDividends } from "../src/services/stockDividend";
import { readZipEntries } from "../src/lib/zipReader";

// DART 배당결정 공시 본문(표) 모양만 줄여서 — 실제 삼성전자 2026-07-30 분기배당 / 2026-01-29 결산배당
const decision = (o: { kind?: string; common: string; pref: string; record: string; pay: string; agm?: string; decided: string }) => `
<?xml version="1.0" encoding="utf-8"?><DOCUMENT><BODY><style>.xforms td { color: #3D3D3D; }</style>
<TABLE><TR><TD>1. 배당구분</TD><TD>분기배당</TD></TR>
<TR><TD>2. 배당종류</TD><TD>${o.kind ?? "현금배당"}</TD></TR>
<TR><TD>3. 1주당 배당금(원)</TD><TD>보통주식</TD><TD>${o.common}</TD></TR>
<TR><TD>종류주식</TD><TD>${o.pref}</TD></TR>
<TR><TD>6. 배당기준일</TD><TD>${o.record}</TD></TR>
<TR><TD>7. 배당금지급 예정일자</TD><TD>${o.pay}</TD></TR>
<TR><TD>9. 주주총회 예정일자</TD><TD>${o.agm ?? "-"}</TD></TR>
<TR><TD>10. 이사회결의일(결정일)</TD><TD>${o.decided}</TD></TR></TABLE></BODY></DOCUMENT>`;

test("분기배당: 공시된 1주당 배당금·기준일·지급일을 그대로 읽는다", () => {
  const d = parseDividendDecision(
    decision({ common: "374", pref: "374", record: "2026-06-30", pay: "2026-08-28", decided: "2026-07-30" }),
    { code: "005930", preferred: false, rceptNo: "20260730800137" }
  );
  assert.deepEqual(
    d && { rec: d.recordDate, pay: d.payDate, ps: d.perShare, tax: d.taxablePerShare, est: d.payDateEstimated },
    { rec: "2026-06-30", pay: "2026-08-28", ps: 374, tax: 374, est: false }
  );
});

test("우선주는 종류주식 배당금을 쓴다", () => {
  const d = parseDividendDecision(
    decision({ common: "566", pref: "1,567", record: "2025-12-31", pay: "2026-04-17", decided: "2026-01-28" }),
    { code: "005935", preferred: true, rceptNo: "x" }
  );
  assert.equal(d?.perShare, 1567);
});

test("결산배당처럼 지급일이 없으면 주총일+30일, 주총일도 없으면 이듬해 4/30으로 추정", () => {
  const noAgm = parseDividendDecision(
    decision({ common: "566", pref: "567", record: "2025-12-31", pay: "-", decided: "2026-01-28" }),
    { code: "005930", preferred: false, rceptNo: "x" }
  );
  assert.equal(noAgm?.payDate, "2026-04-30");
  assert.equal(noAgm?.payDateEstimated, true);
  const withAgm = parseDividendDecision(
    decision({ common: "500", pref: "-", record: "2026-03-31", pay: "-", agm: "2026-03-20", decided: "2026-02-10" }),
    { code: "000000", preferred: false, rceptNo: "x" }
  );
  // 주총일+30 이 기준일보다 앞서지 않게
  assert.equal(withAgm?.payDate, "2026-04-19");
});

test("현물배당만이거나 금액이 없으면 넣지 않는다", () => {
  assert.equal(
    parseDividendDecision(decision({ kind: "현물배당", common: "100", pref: "-", record: "2026-06-30", pay: "2026-08-01", decided: "2026-07-01" }), {
      code: "005930",
      preferred: false,
      rceptNo: "x",
    }),
    null
  );
  assert.equal(
    parseDividendDecision(decision({ common: "-", pref: "-", record: "2026-06-30", pay: "2026-08-01", decided: "2026-07-01" }), {
      code: "005930",
      preferred: false,
      rceptNo: "x",
    }),
    null
  );
});

test("종목코드 → DART 회사 코드 (우선주는 보통주 회사로)", () => {
  assert.deepEqual(resolveCorpCode("005930"), { corpCode: "00126380", preferred: false });
  assert.deepEqual(resolveCorpCode("005935"), { corpCode: "00126380", preferred: true });
  assert.equal(resolveCorpCode("069500"), null); // ETF는 DART 회사가 아니다
});

function makeZip(name: string, content: string): Buffer {
  const data = deflateRawSync(Buffer.from(content, "utf8"));
  const nameBuf = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(8, 8);
  local.writeUInt32LE(0, 18); // 로컬 헤더 크기는 비워 둔다 (중앙 디렉터리로 읽어야 한다)
  local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(8, 10);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);
  const cdOffset = local.length + nameBuf.length + data.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + nameBuf.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, nameBuf, data, central, nameBuf, eocd]);
}

test("ZIP 읽기 (DART document.xml 응답 형식)", () => {
  const [entry] = readZipEntries(makeZip("a.xml", "배당기준일 2026-06-30"));
  assert.equal(entry.name, "a.xml");
  assert.equal(entry.data.toString("utf8"), "배당기준일 2026-06-30");
});

test("공시 목록 → 본문을 차례대로 받아 정정 공시가 같은 기준일을 덮어쓴다", async () => {
  const calls: string[] = [];
  const docs: Record<string, string> = {
    "20260730800137": decision({ common: "374", pref: "374", record: "2026-06-30", pay: "2026-08-28", decided: "2026-07-30" }),
    "20260801800001": decision({ common: "380", pref: "380", record: "2026-06-30", pay: "2026-08-28", decided: "2026-07-30" }),
  };
  const fakeFetch = (async (url: string) => {
    calls.push(url);
    if (url.includes("list.json")) {
      return new Response(
        JSON.stringify({
          status: "000",
          list: [
            { rcept_no: "20260801800001", report_nm: "[기재정정]현금ㆍ현물배당결정" },
            { rcept_no: "20260730800137", report_nm: "현금ㆍ현물배당결정" },
            { rcept_no: "20260701000001", report_nm: "기업설명회(IR)개최" },
            { rcept_no: "20260618800642", report_nm: "현금ㆍ현물배당결정(자회사의 주요경영사항)" },
            { rcept_no: "20260618800628", report_nm: "현금ㆍ현물배당을위한주주명부폐쇄(기준일)결정" },
          ],
        })
      );
    }
    const no = new URL(url).searchParams.get("rcept_no") ?? "";
    return new Response(makeZip(`${no}.xml`, docs[no]));
  }) as typeof fetch;
  const list = await fetchStockDividends("005930", "2026-09-29", "key", fakeFetch);
  assert.equal(list.length, 1);
  assert.equal(list[0].perShare, 380);
  assert.equal(calls.filter((c) => c.includes("document.xml")).length, 2);
});
