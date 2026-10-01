import test from "node:test";
import assert from "node:assert/strict";
import { findPositionAccountConflict } from "../src/lib/positionAccountGuard";

const botRow = { broker_name: null, account_name: null, quantity: 120, status: "holding" };
const isaRow = { broker_name: "키움", account_name: "ISA", quantity: 30, status: "holding" };

test("findPositionAccountConflict: 봇이 들고 있는 종목을 실계좌로 추가하면 덮어쓰지 않는다", () => {
  const msg = findPositionAccountConflict({ mode: "holdingrestore", existing: botRow, brokerName: "키움", accountName: "일반" });
  assert.match(msg ?? "", /봇 가상 계좌에 120주/);
});

test("findPositionAccountConflict: 다른 실계좌에 있는 종목을 추가해도 막는다", () => {
  const msg = findPositionAccountConflict({ mode: "holdingrestore", existing: isaRow, brokerName: "키움", accountName: "일반" });
  assert.match(msg ?? "", /'키움 \/ ISA' 계좌/);
});

test("findPositionAccountConflict: 같은 계좌 재입력·관심 종목·새 종목은 그대로 저장한다", () => {
  assert.equal(findPositionAccountConflict({ mode: "holdingrestore", existing: isaRow, brokerName: " 키움 ", accountName: "ISA" }), null);
  assert.equal(
    findPositionAccountConflict({ mode: "holdingrestore", existing: { ...botRow, quantity: 0, status: "watch" }, brokerName: "키움", accountName: "일반" }),
    null
  );
  assert.equal(findPositionAccountConflict({ mode: "holdingrestore", existing: null, brokerName: "키움", accountName: "일반" }), null);
});

test("findPositionAccountConflict: 수정에서 실계좌 이름 바꾸기는 허용하고, 봇 행을 실계좌로 바꾸는 건 막는다", () => {
  assert.equal(findPositionAccountConflict({ mode: "holdingedit", existing: isaRow, brokerName: "키움", accountName: "연금저축" }), null);
  assert.ok(findPositionAccountConflict({ mode: "holdingedit", existing: botRow, brokerName: "키움", accountName: "일반" }));
  assert.ok(findPositionAccountConflict({ mode: "holdingedit", existing: isaRow, brokerName: null, accountName: null }));
  assert.equal(findPositionAccountConflict({ mode: "holdingedit", existing: botRow, brokerName: null, accountName: null }), null);
});
