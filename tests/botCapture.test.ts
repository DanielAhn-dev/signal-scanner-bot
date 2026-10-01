import test from "node:test";
import assert from "node:assert/strict";
import { computeBotCapture, type DailyBar } from "../src/services/strategyForwardTest";

const bar = (date: string, close: number): DailyBar => ({ date, open: close, close, volume: 1 });
const pt = (date: string, total: number) => ({ date, total, seed: 1_000_000, cash: 0 }) as never;

test("하락 포착률: 지수가 내린 날 봇이 절반만 빠지면 약 50%", () => {
  // 지수는 −10%, +10%를 6번 반복하고, 봇은 하락일 −5%·상승일 +10%
  const dates: string[] = [];
  const index: DailyBar[] = [];
  const points: ReturnType<typeof pt>[] = [];
  let idx = 100;
  let bot = 1_000_000;
  for (let i = 0; i <= 12; i += 1) {
    const date = `202610${String(i + 1).padStart(2, "0")}`;
    if (i > 0) {
      const down = i % 2 === 1;
      idx *= down ? 0.9 : 1.1;
      bot *= down ? 0.95 : 1.1;
    }
    dates.push(date);
    index.push(bar(date, idx));
    points.push(pt(date, bot));
  }
  const cap = computeBotCapture({ points, startDate: "20261001", index })!;
  assert.equal(cap.downDays, 6);
  assert.equal(cap.upDays, 6);
  assert.ok(cap.downCapturePct != null && Math.abs(cap.downCapturePct - 50) < 8, `down ${cap.downCapturePct}`);
  assert.ok(cap.upCapturePct != null && cap.upCapturePct > 90, `up ${cap.upCapturePct}`);
});

test("하락 포착률: 하락일이 5일 미만이면 비율을 내지 않는다", () => {
  const index = [bar("20261001", 100), bar("20261002", 99), bar("20261005", 100)];
  const points = [pt("20261001", 1000), pt("20261002", 995), pt("20261005", 1000)];
  const cap = computeBotCapture({ points, startDate: "20261001", index })!;
  assert.equal(cap.downCapturePct, null);
});
