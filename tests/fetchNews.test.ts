import test from "node:test";
import assert from "node:assert/strict";
import { parseMainNewsRows } from "../src/utils/fetchNews";

test("parseMainNewsRows: 주요뉴스 API 응답을 링크·언론사·시각으로 변환하고 중복을 거른다", () => {
  const row = { oid: "014", aid: "0005581511", ohnm: "파이낸셜뉴스", tit: "연휴 뒤 코스피 개인 순매수", dt: "20260928104400" };
  const seen = new Set<string>();
  const items = parseMainNewsRows([row, row, { tit: "짧음", oid: "1", aid: "2" }, { tit: "링크 없는 기사 제목" }], seen);
  assert.deepEqual(items, [
    {
      title: "연휴 뒤 코스피 개인 순매수",
      link: "https://n.news.naver.com/mnews/article/014/0005581511",
      source: "파이낸셜뉴스",
      date: "09.28 10:44",
    },
  ]);
  assert.equal(parseMainNewsRows([row], seen).length, 0); // 다음 페이지에서 같은 기사가 다시 와도 제외
  assert.deepEqual(parseMainNewsRows({ error: "x" }), []);
});
