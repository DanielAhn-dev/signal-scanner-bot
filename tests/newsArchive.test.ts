import test from "node:test";
import assert from "node:assert/strict";
import { parseStockNewsForArchive } from "../src/services/newsArchive";

test("parseStockNewsForArchive: 기준 시각 이후 기사만, 기사ID 중복 제거, 필수값 없는 행 제외", () => {
  const item = { officeId: "009", articleId: "0005740638", officeName: "매일경제", datetime: "202609281047", title: "삼전닉스 동반 하락" };
  const rows = parseStockNewsForArchive(
    "005930",
    [
      { items: [item, item, { ...item, articleId: "1", datetime: "202609241500" }] },
      { items: [{ ...item, articleId: "2", title: "" }, { ...item, articleId: "3", datetime: "bad" }] },
    ],
    "202609250000"
  );
  assert.deepEqual(rows, [
    { code: "005930", id: "009-0005740638", datetime: "202609281047", office: "매일경제", title: "삼전닉스 동반 하락" },
  ]);
  assert.deepEqual(parseStockNewsForArchive("005930", { error: 1 }, "0"), []);
});
