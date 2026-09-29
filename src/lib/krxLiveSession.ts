/**
 * 시장 데이터로 "오늘 실제로 장이 열렸는지" 확인한다 — 휴장일 목록(krxCalendar.ts)이 빠뜨린 날의 안전망.
 *
 * 목록은 사람이 매년 채워야 해서 빠지기 쉽다 (선거일·임시공휴일·임시 휴장처럼 연초에 모르는 날도 있다).
 * 2026-09-24(추석 연휴)엔 목록이 들어가기 전이라 정기 실행이 실제로 매수를 체결했다.
 * 네이버 코스피 지수의 마지막 체결 시각(localTradedAt)은 장이 열린 날 장중이면 오늘이고, 휴장일이면 직전 거래일로 남는다.
 */
import { isKrxTradingDay, toKstDateKey } from "./krxCalendar";

const KOSPI_BASIC_URL = "https://m.stock.naver.com/api/index/KOSPI/basic";
const FETCH_TIMEOUT_MS = 2500;
const CACHE_MS = 10 * 60 * 1000;

let cache: { dateKey: string; at: number; value: KrxLiveSessionCheck } | null = null;

export type KrxLiveSessionCheck = {
  /** true = 목록상 거래일인데 오늘 체결이 없음(휴장), false = 오늘 체결 있음, null = 판단 안 함/실패 */
  closed: boolean | null;
  /** 마지막 체결일 (YYYY-MM-DD) */
  lastTradedDate: string | null;
};

/** localTradedAt 날짜와 오늘을 비교한다 (순수 함수) */
export function judgeKrxSession(todayKey: string, localTradedAt: string | null | undefined): KrxLiveSessionCheck {
  const m = String(localTradedAt ?? "").match(/^(\d{4}-\d{2}-\d{2})/);
  if (!m) return { closed: null, lastTradedDate: null };
  const last = m[1];
  if (last === todayKey) return { closed: false, lastTradedDate: last };
  return { closed: last < todayKey, lastTradedDate: last };
}

/** 장 시작 직후는 첫 체결 전일 수 있어 09:10부터 본다 */
function isCheckWindow(base: Date): boolean {
  const kst = new Date(base.getTime() + 9 * 60 * 60 * 1000);
  const minutes = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  return minutes >= 9 * 60 + 10 && minutes < 15 * 60 + 30;
}

/**
 * 목록상 거래일의 장중(09:10~15:30)에만 확인한다. 조회 실패는 null — 목록 판단을 그대로 따른다.
 * 결과는 10분 동안 재사용한다.
 */
export async function checkKrxLiveSession(base: Date = new Date()): Promise<KrxLiveSessionCheck> {
  const todayKey = toKstDateKey(base);
  if (!isKrxTradingDay(base) || !isCheckWindow(base)) return { closed: null, lastTradedDate: null };
  if (cache && cache.dateKey === todayKey && base.getTime() - cache.at < CACHE_MS) return cache.value;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(KOSPI_BASIC_URL, { headers: { "User-Agent": "Mozilla/5.0" }, signal: controller.signal });
    if (!res.ok) return { closed: null, lastTradedDate: null };
    const data = (await res.json()) as { localTradedAt?: string };
    const value = judgeKrxSession(todayKey, data?.localTradedAt);
    if (value.closed != null) cache = { dateKey: todayKey, at: base.getTime(), value };
    return value;
  } catch {
    return { closed: null, lastTradedDate: null };
  } finally {
    clearTimeout(timer);
  }
}
