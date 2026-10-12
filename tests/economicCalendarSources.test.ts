import test from "node:test";
import assert from "node:assert/strict";
import {
  parseBeaSchedule,
  parseBlsSchedule,
  parseBokSchedule,
  parseFedCalendar,
} from "../src/lib/economicCalendarSources";

// 2026-10-12 실제 페이지 구조에서 줄인 조각

test("BLS 일정표에서 발표일만 뽑는다 (기준월 칸은 무시)", () => {
  const html = `
    <tr><td>October 2026</td><td>Nov. 10, 2026</td><td>08:30 AM</td></tr>
    <tr><td>December 2026</td>
        <td>Jan. 13, 2027</td><td>08:30 AM</td></tr>
    <tr><td>April 2027</td><td>May 12, 2027</td><td>08:30 AM</td></tr>`;
  assert.deepEqual(
    parseBlsSchedule(html, "us-cpi").map((e) => e.date),
    ["2026-11-10", "2027-01-13", "2027-05-12"],
  );
});

test("BEA 일정표: 표 머리글의 연도를 쓰고 GDP·PCE 행만 고른다", () => {
  const row = (date: string, title: string) => `
    <tr class="scheduled-releases-type-press">
    <td class="scheduled-date no-wrap"><div class="release-date">${date}</div>
    <small class="text-muted">8:30 AM</small></td>
    <td class="views-field"><div class="icon-letter">N</div></td>
    <td class="release-title views-field" headers="x">${title}        </td></tr>`;
  const html = `<table class="table" id="release-schedule-table"><thead><tr><th scope="col">Year 2027</th></tr></thead><tbody>
    ${row("January 28", "GDP (Advance Estimate), 4th Quarter and Year 2026")}
    ${row("January 28", "Personal Income and Outlays, December 2026")}
    ${row("February 3", "U.S. International Trade in Goods and Services, December 2026")}
    </tbody></table>`;
  assert.deepEqual(parseBeaSchedule(html), [
    { kind: "us-gdp", date: "2027-01-28" },
    { kind: "us-pce", date: "2027-01-28" },
  ]);
});

test("연준 FOMC: 회의 마지막 날이 결정일, 달을 걸친 회의와 임시 회의 처리", () => {
  const meeting = (month: string, date: string) => `
    <div class="fomc-meeting__month col-xs-5"><strong>${month}</strong></div>
    <div class="fomc-meeting__date col-xs-4">${date}</div>`;
  const html = `
    <h4><a id="1">2027 FOMC Meetings</a></h4>${meeting("January", "26-27")}${meeting("June", "8-9*")}
    <h4><a id="2">2020 FOMC Meetings</a></h4>${meeting("April/May", "28-1")}${meeting("March", "15 (unscheduled)")}`;
  assert.deepEqual(
    parseFedCalendar(html).map((e) => e.date),
    ["2020-05-01", "2027-01-27", "2027-06-09"],
  );
});

test("한국은행: 연도 페이지의 'MM월 DD일(요)' 항목, 공개 전이면 빈 배열", () => {
  const html = `<li>01월 15일(목)</li><li>10월 22일(목)</li><p>2026년 10월 1일 게시</p>`;
  assert.deepEqual(parseBokSchedule(html, 2026).map((e) => e.date), ["2026-01-15", "2026-10-22"]);
  assert.deepEqual(parseBokSchedule("<p>등록된 일정이 없습니다</p>", 2027), []);
});

test("합치기: 수집 일정이 덮는 기간 안의 하드코딩 날짜는 버리고, 기간 밖은 남긴다", async () => {
  const { mergeEconomicEvents } = await import("../src/utils/fetchEconomicCalendar");
  const base = [
    { id: "kr-old", name: "한국 기준금리 결정", country: "KR", category: "interest_rate", importance: "critical", scheduledAt: "2026-10-15T01:00:00Z" },
    { id: "cpi-oct", name: "미국 CPI (YoY)", country: "US", category: "inflation", importance: "critical", scheduledAt: "2026-10-14T12:30:00Z" },
  ] as const;
  const file = {
    generatedAt: "2026-10-12T00:00:00Z",
    sources: {
      "bok-this-year": { fetchedAt: "", ok: true, events: [{ kind: "kr-base-rate", date: "2026-01-15" }, { kind: "kr-base-rate", date: "2026-10-22" }, { kind: "kr-base-rate", date: "2026-11-26" }] },
      "bls-cpi": { fetchedAt: "", ok: true, events: [{ kind: "us-cpi", date: "2026-11-10" }] },
      "fed-fomc": { fetchedAt: "", ok: false, error: "HTTP 500", events: [{ kind: "us-fomc", date: "2026-10-28" }] },
    },
  } as const;
  const events = mergeEconomicEvents([...base] as never, file as never, new Date("2026-10-12T00:00:00Z"));
  const dates = (name: string) => events.filter((e) => e.name === name).map((e) => e.scheduledAt.slice(0, 10)).sort();
  assert.deepEqual(dates("한국 기준금리 결정"), ["2026-01-15", "2026-10-22", "2026-11-26"]);
  assert.deepEqual(dates("미국 CPI (YoY)"), ["2026-10-14", "2026-11-10"]);
  // 실패한 출처도 이전 결과는 쓰고, 의사록은 결정 3주 뒤(서머타임 끝난 뒤라 19:00Z)
  assert.deepEqual(dates("FOMC 금리 결정"), ["2026-10-28"]);
  assert.equal(events.find((e) => e.name === "FOMC 의사록")?.scheduledAt, "2026-11-18T19:00:00Z");
  assert.equal(dates("중국 제조업 PMI")[0], "2026-10-31");
});
