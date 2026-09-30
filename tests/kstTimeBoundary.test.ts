import test from "node:test";
import assert from "node:assert/strict";
import { toKstDateKey } from "../src/lib/krxCalendar";
import { kstDateKey, kstWindowKey } from "../src/services/virtualAutoTradeTiming";
import { applyDeposit, isDepositDue, readDepositSettings } from "../src/services/monthlyDeposit";

// 서버는 UTC로 돈다 — UTC 15:00이 KST 자정이다. 예전에 서버 UTC 날짜를 "오늘"로 쓴 곳이 20군데 있었다.
const BOUNDARIES: Array<[string, string]> = [
  ["2026-09-29T14:59:59.999Z", "2026-09-29"], // KST 23:59:59
  ["2026-09-29T15:00:00.000Z", "2026-09-30"], // KST 00:00:00
  ["2026-09-30T14:59:59.999Z", "2026-09-30"], // 월말 마지막 순간
  ["2026-09-30T15:00:00.000Z", "2026-10-01"], // 월초로 넘어감
  ["2026-12-31T15:00:00.000Z", "2027-01-01"], // 연말 → 연초
  ["2028-02-28T15:00:00.000Z", "2028-02-29"], // 윤일
  ["2028-02-29T15:00:00.000Z", "2028-03-01"],
];

test("KST 날짜 키: 구현 두 곳이 경계 시각에서 모두 같다", () => {
  for (const [iso, expected] of BOUNDARIES) {
    const d = new Date(iso);
    assert.equal(toKstDateKey(d), expected, `toKstDateKey ${iso}`);
    assert.equal(kstDateKey(d), expected, `kstDateKey ${iso}`);
  }
});

test("실행창 키: 같은 창 안에서는 같고 경계에서 바뀐다 (동시 실행 잠금의 기준)", () => {
  const a = kstWindowKey(new Date("2026-09-30T00:00:00.000Z"), 10);
  const b = kstWindowKey(new Date("2026-09-30T00:09:59.000Z"), 10);
  const c = kstWindowKey(new Date("2026-09-30T00:10:00.000Z"), 10);
  assert.equal(a, b);
  assert.notEqual(b, c);
});

test("월 입금: 입금일에 한 번만, 같은 날 재실행해도 다시 들어가지 않는다", () => {
  let prefs: Record<string, unknown> = {
    virtual_monthly_deposit: 500_000,
    virtual_deposit_day: 25,
    virtual_cash: 1_000_000,
    virtual_seed_capital: 10_000_000,
  };
  const today = "2026-10-25";
  let deposits = 0;
  for (let run = 0; run < 3; run++) {
    const s = readDepositSettings(prefs);
    if (!isDepositDue(s, today)) continue;
    prefs = { ...prefs, ...applyDeposit({ prefs, amount: s.monthlyDeposit, todayKey: today }) };
    deposits += 1;
  }
  assert.equal(deposits, 1);
  assert.equal(prefs.virtual_cash, 1_500_000);
  assert.equal(prefs.virtual_seed_capital, 10_500_000);
});

test("월 입금: 연말을 넘겨도 12월·1월 각각 한 번씩", () => {
  let prefs: Record<string, unknown> = { virtual_monthly_deposit: 100_000, virtual_deposit_day: 28, virtual_cash: 0, virtual_seed_capital: 1_000_000 };
  const days = ["2026-12-28", "2026-12-31", "2027-01-01", "2027-01-27", "2027-01-28", "2027-01-29"];
  const done: string[] = [];
  for (const day of days) {
    const s = readDepositSettings(prefs);
    if (!isDepositDue(s, day)) continue;
    prefs = { ...prefs, ...applyDeposit({ prefs, amount: s.monthlyDeposit, todayKey: day }) };
    done.push(day);
  }
  assert.deepEqual(done, ["2026-12-28", "2027-01-28"]);
});

test("월 입금: 입금일에 서버가 UTC 14:59(KST 23:59)에 돌면 그 KST 날짜로 판정한다", () => {
  const s = readDepositSettings({ virtual_monthly_deposit: 100_000, virtual_deposit_day: 28, virtual_last_deposit_month: "2026-09" });
  // UTC 날짜는 아직 27일이지만 KST는 28일 — 입금 대상
  assert.equal(isDepositDue(s, toKstDateKey(new Date("2026-10-27T15:00:00.000Z"))), true);
  assert.equal(isDepositDue(s, toKstDateKey(new Date("2026-10-27T14:59:59.000Z"))), false);
});
