import test from "node:test";
import assert from "node:assert/strict";
import {
  hasInlineKeyboard,
  isTelegramReplyContext,
  normalizeNotifyChannel,
  runAsTelegramReply,
} from "../src/services/notifyChannel";

test("알림 채널: push만 푸시, 나머지는 텔레그램", () => {
  assert.equal(normalizeNotifyChannel("push"), "push");
  assert.equal(normalizeNotifyChannel("telegram"), "telegram");
  assert.equal(normalizeNotifyChannel(undefined), "telegram");
  assert.equal(normalizeNotifyChannel("both"), "telegram");
});

test("명령 처리 중에는 답장 표시가 켜지고, 끝나면 꺼진다", async () => {
  assert.equal(isTelegramReplyContext(), false);
  const inside = await runAsTelegramReply(async () => {
    await new Promise((r) => setTimeout(r, 1));
    return isTelegramReplyContext();
  });
  assert.equal(inside, true);
  assert.equal(isTelegramReplyContext(), false);
});

test("버튼 달린 메시지 감지 (객체·JSON 문자열)", () => {
  assert.equal(hasInlineKeyboard({ inline_keyboard: [[{ text: "승인", callback_data: "promo:approve:x" }]] }), true);
  assert.equal(hasInlineKeyboard(JSON.stringify({ inline_keyboard: [[{ text: "a" }]] })), true);
  assert.equal(hasInlineKeyboard({ inline_keyboard: [] }), false);
  assert.equal(hasInlineKeyboard(undefined), false);
  assert.equal(hasInlineKeyboard("not json"), false);
});
