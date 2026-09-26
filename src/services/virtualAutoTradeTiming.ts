import { isKrxTradingDay } from "../lib/krxCalendar";

function kstMinutes(base = new Date()): { day: number; minutes: number } {
  const kst = new Date(base.getTime() + 9 * 60 * 60 * 1000);
  return {
    day: kst.getUTCDay(),
    minutes: kst.getUTCHours() * 60 + kst.getUTCMinutes(),
  };
}

export function kstDateKey(base = new Date()): string {
  const d = new Date(base.getTime() + 9 * 60 * 60 * 1000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function kstWindowKey(base = new Date(), windowMinutes = 10): string {
  const safeWindow = Math.max(1, Math.floor(windowMinutes));
  const dateKey = kstDateKey(base);
  const { minutes } = kstMinutes(base);
  const bucket = Math.floor(minutes / safeWindow) * safeWindow;
  const hour = String(Math.floor(bucket / 60)).padStart(2, "0");
  const minute = String(bucket % 60).padStart(2, "0");
  return `${dateKey}T${hour}:${minute}`;
}

/** KRX 거래일 여부 (주말 + 공휴일·연말 휴장일 제외) */
export function isKrxMarketDay(base = new Date()): boolean {
  return isKrxTradingDay(base);
}

export function isKrxIntradayAutoTradeWindow(base = new Date()): boolean {
  if (!isKrxMarketDay(base)) return false;
  const { minutes } = kstMinutes(base);
  return minutes >= 9 * 60 && minutes < 15 * 60 + 30;
}
