import test from "node:test";
import assert from "node:assert/strict";
import { INDEX_BUY_GUIDE_FOOTNOTE, INDEX_BUY_GUIDE_LINES, INDEX_BUY_GUIDE_TITLE } from "../src/lib/indexBuyGuide";

test("지수 사는 법 안내: 검증으로 뒤집힌 '50일선 위에서만 매수'를 권하지 않는다", () => {
  const text = INDEX_BUY_GUIDE_LINES.join("\n");
  assert.ok(INDEX_BUY_GUIDE_TITLE.length > 0);
  assert.match(text, /50일선 위에서만 사는 규칙은 이득이 없었습니다/);
  assert.doesNotMatch(text, /50일선 위에서만 매수하세요|50일선 위일 때만 사세요/);
  assert.match(INDEX_BUY_GUIDE_FOOTNOTE, /보장하지 않습니다/);
});
