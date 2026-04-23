import test from "node:test";
import assert from "node:assert/strict";
import { fmtPct, fmtPctFixed } from "../src/bot/messages/format";

test("fmtPct: 반올림 후 음수 0은 0.0%로 정규화한다", () => {
  assert.equal(fmtPct(-0.03), "0.0%");
  assert.equal(fmtPct(0.04), "0.0%");
});

test("fmtPctFixed: 자릿수를 유지하면서 ETF 괴리율을 2자리로 표현한다", () => {
  assert.equal(fmtPctFixed(-0.03, 2), "-0.03%");
  assert.equal(fmtPctFixed(0.257, 2), "+0.26%");
  assert.equal(fmtPctFixed(-0.004, 2), "0.00%");
});