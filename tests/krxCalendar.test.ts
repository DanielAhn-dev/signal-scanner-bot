import test from "node:test";
import assert from "node:assert/strict";
import {
  countKrxTradingDaysBetween,
  isKrxCalendarCovered,
  isKrxRegularSession,
  isKrxTradingDate,
  nextKrxTradingDate,
  previousKrxTradingDate,
} from "../src/lib/krxCalendar";
import { isKrxIntradayAutoTradeWindow, isKrxMarketDay } from "../src/services/virtualAutoTradeTiming";
import { getBizDaysAgo } from "../src/lib/normalize";

test("krxCalendar: 2026 추석 연휴(9/24·25 목금)는 휴장, 주말도 휴장", () => {
  assert.equal(isKrxTradingDate("2026-09-23"), true);
  assert.equal(isKrxTradingDate("2026-09-24"), false);
  assert.equal(isKrxTradingDate("2026-09-25"), false);
  assert.equal(isKrxTradingDate("2026-09-26"), false);
  assert.equal(isKrxTradingDate("2026-09-28"), true);
});

test("krxCalendar: 대체공휴일·제헌절·연말 휴장 반영", () => {
  assert.equal(isKrxTradingDate("2026-10-05"), false); // 개천절(토) 대체
  assert.equal(isKrxTradingDate("2026-07-17"), false); // 제헌절 공휴일 재지정
  assert.equal(isKrxTradingDate("2026-12-31"), false); // 연말 휴장
  assert.equal(isKrxTradingDate("2026-05-22"), true); // 수집 누락일이지 휴장일이 아님
});

test("krxCalendar: 추석 당일 14:14 KST 자동매매 창은 닫혀 있다 (2026-09-24 오매수 재발 방지)", () => {
  const chuseokAfternoon = new Date("2026-09-24T05:14:00.000Z");
  assert.equal(isKrxMarketDay(chuseokAfternoon), false);
  assert.equal(isKrxIntradayAutoTradeWindow(chuseokAfternoon), false);
  assert.equal(isKrxRegularSession(chuseokAfternoon), false);
  assert.equal(isKrxIntradayAutoTradeWindow(new Date("2026-09-28T05:14:00.000Z")), true);
});

test("krxCalendar: 연휴 직후 영업일 지연은 1일로 계산 (주말만 빼면 3일)", () => {
  assert.equal(countKrxTradingDaysBetween("2026-09-23", "2026-09-28"), 1);
  assert.equal(countKrxTradingDaysBetween("2026-09-28", "2026-09-23"), 0);
  assert.equal(previousKrxTradingDate("2026-09-28"), "2026-09-23");
  assert.equal(nextKrxTradingDate("2026-09-23"), "2026-09-28");
  assert.equal(getBizDaysAgo("2026-09-28", 1), "2026-09-23");
});

test("krxCalendar: 올해와 내년 휴장일 목록이 있어야 한다 (연말에 갱신 필요)", () => {
  const year = new Date().getUTCFullYear();
  assert.equal(isKrxCalendarCovered(year), true, `${year}년 KRX 휴장일 목록 누락`);
  assert.equal(isKrxCalendarCovered(year + 1), true, `${year + 1}년 KRX 휴장일 목록 누락 — krxCalendar.ts·utils.py 갱신`);
});
