import test from "node:test";
import assert from "node:assert/strict";
import { buildFreshnessLabel, isBusinessStale } from "../src/utils/dataFreshness";

test("dataFreshness: 잘못된 날짜는 stale 처리", () => {
  assert.equal(isBusinessStale("not-a-date", 1), true);
  assert.equal(buildFreshnessLabel("not-a-date", 1), "기준일 확인 불가");
});

test("dataFreshness: 오늘 기준 날짜는 stale 아님", () => {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60 * 1000;
  const kst = new Date(utcMs + 9 * 60 * 60 * 1000);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  const today = `${y}-${m}-${d}`;

  assert.equal(isBusinessStale(today, 1), false);
});
