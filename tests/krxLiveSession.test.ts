import test from "node:test";
import assert from "node:assert/strict";
import { judgeKrxSession } from "../src/lib/krxLiveSession";
import { krxCalendarStatus } from "../src/lib/krxCalendar";

test("코스피 마지막 체결일이 오늘이면 개장, 이전 날짜면 휴장", () => {
  assert.deepEqual(judgeKrxSession("2026-09-29", "2026-09-29T10:15:00+09:00"), { closed: false, lastTradedDate: "2026-09-29" });
  // 2026-09-24(추석) 장중에 보면 마지막 체결은 9/23
  assert.deepEqual(judgeKrxSession("2026-09-24", "2026-09-23T15:30:00+09:00"), { closed: true, lastTradedDate: "2026-09-23" });
});

test("체결 시각이 없거나 형식이 다르면 판단하지 않는다 (목록 판단을 따름)", () => {
  assert.equal(judgeKrxSession("2026-09-29", undefined).closed, null);
  assert.equal(judgeKrxSession("2026-09-29", "garbage").closed, null);
});

test("휴장일 목록 상태: 올해 없음은 오류, 11월부터 내년 없음·추정치는 경고", () => {
  assert.equal(krxCalendarStatus("2026-09-29").level, "ok");
  assert.equal(krxCalendarStatus("2026-11-02").level, "warn"); // 2027은 추정치
  assert.equal(krxCalendarStatus("2027-11-02").level, "warn"); // 2028 없음
  assert.equal(krxCalendarStatus("2028-01-03").level, "error");
});
