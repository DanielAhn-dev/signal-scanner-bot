import test from "node:test";
import assert from "node:assert/strict";
import { isWebOnlyChatId, webAccountIdFor, WEB_ACCOUNT_ID_BASE } from "../src/services/webAccount";

test("webAccountIdFor: 로그인 계정마다 고정, 예약 번호대 안, 실제 텔레그램 ID와 구분", () => {
  const a = webAccountIdFor("1e37bfaa-4fdf-4634-9120-7c46ddbb531a");
  assert.equal(a, webAccountIdFor("1e37bfaa-4fdf-4634-9120-7c46ddbb531a"));
  assert.notEqual(a, webAccountIdFor("8026dd55-dee9-4a77-9687-00a92245942e"));
  assert.ok(isWebOnlyChatId(a) && a >= WEB_ACCOUNT_ID_BASE && Number.isSafeInteger(a));
  assert.equal(isWebOnlyChatId(8311154094), false);
  assert.equal(isWebOnlyChatId(String(a)), true);
  assert.equal(isWebOnlyChatId(null), false);
});
