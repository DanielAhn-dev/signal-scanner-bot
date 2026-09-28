import test from "node:test";
import assert from "node:assert/strict";
import { classifyNegativeDisclosure, fetchNegativeDisclosureCodes } from "../src/services/dartDisclosureFilter";

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
