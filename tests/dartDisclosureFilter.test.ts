import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyNegativeDisclosure,
  fetchNegativeDisclosureCodes,
  fetchNegativeDisclosures,
  formatDisclosureFilterNote,
} from "../src/services/dartDisclosureFilter";

function fakeFetch(body: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
}

test("classifyNegativeDisclosure: 희석·재무위험 공시만 악재로 분류", () => {
  assert.equal(classifyNegativeDisclosure("주요사항보고서(유상증자결정)"), "유상증자");
  assert.equal(classifyNegativeDisclosure("주요사항보고서(유무상증자결정)"), "유상증자");
  assert.equal(classifyNegativeDisclosure("[기재정정]주요사항보고서(전환사채권발행결정)"), "전환사채");
  assert.equal(classifyNegativeDisclosure("주요사항보고서(감자결정)"), "감자");
  assert.equal(classifyNegativeDisclosure("주요사항보고서(무상증자결정)"), null);
  assert.equal(classifyNegativeDisclosure("주요사항보고서(자기주식취득결정)"), null);
  assert.equal(classifyNegativeDisclosure("주요사항보고서(유상증자결정 철회)"), null);
});

test("fetchNegativeDisclosureCodes: API 키가 없으면 조회하지 않고 빈 결과", async () => {
  const hits = await fetchNegativeDisclosureCodes(5, "");
  assert.equal(hits.size, 0);
});

test("fetchNegativeDisclosures: 키 없음·키 오류·결과 없음·악재를 상태로 구분", async () => {
  const off = await fetchNegativeDisclosures(5, "");
  assert.equal(off.status, "off");
  assert.match(formatDisclosureFilterNote(off), /꺼짐/);

  const badKey = await fetchNegativeDisclosures(5, "k", fakeFetch({ status: "010", message: "등록되지 않은 키입니다." }));
  assert.equal(badKey.status, "error");
  assert.match(formatDisclosureFilterNote(badKey), /오류\(010/);

  const httpErr = await fetchNegativeDisclosures(5, "k", fakeFetch({}, 500));
  assert.equal(httpErr.status, "error");

  const empty = await fetchNegativeDisclosures(5, "k", fakeFetch({ status: "013", message: "조회된 데이타가 없습니다." }));
  assert.equal(empty.status, "ok");
  assert.equal(formatDisclosureFilterNote(empty), "공시필터 정상(악재 0)");

  const hit = await fetchNegativeDisclosures(
    5,
    "k",
    fakeFetch({
      status: "000",
      total_page: 1,
      list: [
        { stock_code: "123456", corp_cls: "K", report_nm: "주요사항보고서(유상증자결정)", rcept_dt: "20260925" },
        { stock_code: "654321", corp_cls: "Y", report_nm: "주요사항보고서(자기주식취득결정)", rcept_dt: "20260925" },
        { stock_code: "", corp_cls: "E", report_nm: "주요사항보고서(유상증자결정)", rcept_dt: "20260925" },
      ],
    })
  );
  assert.equal(hit.status, "ok");
  assert.deepEqual([...hit.hits.keys()], ["123456"]);
  assert.equal(formatDisclosureFilterNote(hit), "공시악재 1종목 제외");
});
