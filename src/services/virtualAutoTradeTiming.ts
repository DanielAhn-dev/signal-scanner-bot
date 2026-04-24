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

export function isKrxMarketDay(base = new Date()): boolean {
  const { day } = kstMinutes(base);
  return day !== 0 && day !== 6;
}

export function isKrxIntradayAutoTradeWindow(base = new Date()): boolean {
  if (!isKrxMarketDay(base)) return false;
  const { minutes } = kstMinutes(base);
  return minutes >= 9 * 60 && minutes < 15 * 60 + 30;
}
