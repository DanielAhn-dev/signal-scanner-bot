import test from "node:test";
import assert from "node:assert/strict";
import { parseTradeHistoryInput } from "../src/bot/commands/watchlistHistory";

const NOW = new Date("2026-04-20T03:00:00.000Z");

test("parseTradeHistoryInput: 기본 입력은 이번 달 범위를 사용한다", () => {
  const result = parseTradeHistoryInput("", NOW);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.range.mode, "month");
  assert.equal(result.range.label, "2026년 4월");
  assert.equal(result.range.periodText, "04.01~04.20");
  assert.equal(result.range.startIso, "2026-03-31T15:00:00.000Z");
  assert.equal(result.range.endIso, "2026-04-30T15:00:00.000Z");
});

test("parseTradeHistoryInput: 4월 1주는 해당 월의 1주 범위로 해석한다", () => {
  const result = parseTradeHistoryInput("4월 1주", NOW);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.range.mode, "month-week");
  assert.equal(result.range.label, "2026년 4월 1주");
  assert.equal(result.range.periodText, "04.01~04.07");
  assert.equal(result.range.startIso, "2026-03-31T15:00:00.000Z");
  assert.equal(result.range.endIso, "2026-04-07T15:00:00.000Z");
});

test("parseTradeHistoryInput: 숫자 입력은 최근 N일로 해석한다", () => {
  const result = parseTradeHistoryInput("7", NOW);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.range.mode, "days");
  assert.equal(result.range.label, "최근 7일");
  assert.equal(result.range.periodText, "04.14~04.20");
  assert.equal(result.range.startIso, "2026-04-13T15:00:00.000Z");
  assert.equal(result.range.endIso, "2026-04-20T15:00:00.000Z");
});

test("parseTradeHistoryInput: 지난달과 전체를 명시적으로 지원한다", () => {
  const prevMonth = parseTradeHistoryInput("지난달", NOW);
  assert.equal(prevMonth.ok, true);
  if (!prevMonth.ok) return;
  assert.equal(prevMonth.range.label, "2026년 3월");
  assert.equal(prevMonth.range.periodText, "03.01~03.31");

  const all = parseTradeHistoryInput("전체", NOW);
  assert.equal(all.ok, true);
  if (!all.ok) return;
  assert.equal(all.range.mode, "all");
  assert.equal(all.range.label, "전체 기록");
});

test("parseTradeHistoryInput: 지원하지 않는 주차는 예시와 함께 안내한다", () => {
  const result = parseTradeHistoryInput("4월 5주", NOW);
  assert.equal(result.ok, false);
  if (result.ok) return;

  assert.match(result.message, /1주부터 4주까지만/);
  assert.match(result.message, /거래기록 4월 1주/);
});