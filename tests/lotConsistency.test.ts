import test from "node:test";
import assert from "node:assert/strict";
import { buildLotConsistencyIssues } from "../src/lib/lotConsistency";

const CODE = "069500";
const bot = { id: 1, code: CODE, quantity: 10, broker_name: null, account_name: null, name: "KODEX 200" };
const isa = { id: 2, code: CODE, quantity: 50, broker_name: "키움", account_name: "ISA", name: "KODEX 200" };

test("같은 종목을 두 계좌가 들고 있어도 계좌별 로트가 맞으면 문제 없음", () => {
  const issues = buildLotConsistencyIssues([bot, isa], [
    { id: 10, code: CODE, remaining_quantity: 50, position_id: 2 },
    { id: 11, code: CODE, remaining_quantity: 10, position_id: 1 },
  ]);
  assert.deepEqual(issues, []);
});

test("한 계좌만 어긋나면 그 보유 행만 문제로 잡는다(종목 합계로 가리지 않음)", () => {
  // 종목 합계는 60 = 60이라 코드 기준이면 놓친다
  const issues = buildLotConsistencyIssues([bot, isa], [
    { id: 10, code: CODE, remaining_quantity: 55, position_id: 2 },
    { id: 11, code: CODE, remaining_quantity: 5, position_id: 1 },
  ]);
  assert.deepEqual(issues.map((i) => [i.position_id, i.kind, i.position_qty, i.lot_qty]), [
    [1, "mismatch", 10, 5],
    [2, "mismatch", 50, 55],
  ]);
  assert.match(issues[0].detail, /봇 가상 계좌/);
  assert.match(issues[1].detail, /키움 \/ ISA/);
});

test("봇 행에 로트가 없으면 실계좌 로트가 있어도 missing_lots", () => {
  const issues = buildLotConsistencyIssues([bot, isa], [{ id: 10, code: CODE, remaining_quantity: 50, position_id: 2 }]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, "missing_lots");
  assert.equal(issues[0].position_id, 1);
});

test("보유 행에 연결되지 않은 로트만 orphan으로, 닫을 로트 id를 함께 준다", () => {
  const issues = buildLotConsistencyIssues([isa], [
    { id: 10, code: CODE, remaining_quantity: 50, position_id: 2 },
    { id: 12, code: CODE, remaining_quantity: 5, position_id: null },
    { id: 13, code: CODE, remaining_quantity: 3, position_id: 99 }, // 보유 중이 아닌 행
  ]);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, "orphan_lots");
  assert.equal(issues[0].lot_qty, 8);
  assert.deepEqual(issues[0].lot_ids, [12, 13]);
});
