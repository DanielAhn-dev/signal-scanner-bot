/**
 * Supabase 응답 잘림 감지기.
 *
 * PostgREST는 한 번에 최대 1000행만 돌려준다. `.limit(5000)`이나 limit 없이 받으면 1000행에서 조용히 잘리는데,
 * 2026-10-06 점검에서 이 때문에 자동매매 후보 지표가 한 달 전 값, 섹터 점수가 두 달 전 값, 날짜 목록이 하루치로
 * 계산되던 곳이 10곳 넘게 나왔다. 코드를 눈으로 찾는 것만으로는 다시 생길 수 있어, 실행 중에 잡는다.
 *
 * 판정: GET 응답이 정확히 1000행이고, 요청한 limit이 없거나 1000보다 크면 잘렸다고 본다.
 * (`.range(a, b)`·selectPaged는 limit을 1000 이하로 명시하므로 걸리지 않는다. 결과가 우연히 딱 1000행인 경우도
 * 걸리지만, 그때도 limit을 명시하는 편이 맞다.)
 *
 * 설치: installSupabaseTruncationGuard() — 쿼리 빌더 프로토타입의 then을 감싼다. 프로토타입이라 설치 전에 만든
 * 클라이언트에도 적용된다. 여러 번 불러도 한 번만 설치된다.
 */
import { createClient } from "@supabase/supabase-js";

export const SUPABASE_MAX_ROWS = 1000;

export type TruncationEvent = { table: string; query: string; rows: number; at: string };

/** 잘림으로 볼 응답인가 (순수 함수) */
export function isLikelyTruncated(rowCount: number, url: URL | string | null | undefined): boolean {
  if (rowCount !== SUPABASE_MAX_ROWS) return false;
  let limit: string | null = null;
  try {
    limit = url ? new URL(String(url)).searchParams.get("limit") : null;
  } catch {
    limit = null;
  }
  if (limit != null && Number(limit) > 0 && Number(limit) <= SUPABASE_MAX_ROWS) return false;
  return true;
}

const events: TruncationEvent[] = [];
const seenKeys = new Set<string>();
let alertsSent = 0;
const MAX_ALERTS_PER_PROCESS = 3;
let installed = false;

export function getTruncationEvents(): TruncationEvent[] {
  return [...events];
}

export function resetTruncationEventsForTest(): void {
  events.length = 0;
  seenKeys.clear();
  alertsSent = 0;
}

function describe(url: URL): { table: string; query: string } {
  const table = url.pathname.split("/").filter(Boolean).pop() ?? "?";
  const params = [...url.searchParams.entries()]
    .map(([k, v]) => `${k}=${v.length > 60 ? `${v.slice(0, 60)}…` : v}`)
    .join("&");
  return { table, query: params.slice(0, 300) };
}

async function alertAdmin(ev: TruncationEvent): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;
  if (!token || !chatId || process.env.NODE_ENV === "test" || process.env.NODE_TEST_CONTEXT || process.env.SUPABASE_TRUNCATION_ALERT === "false") return;
  if (alertsSent >= MAX_ALERTS_PER_PROCESS) return;
  alertsSent += 1;
  const text = `⚠️ [조회 잘림 감지] ${ev.table} 응답이 ${ev.rows}행에서 잘렸을 수 있습니다.\n${ev.query}\n→ selectPaged/range로 끝까지 받도록 고쳐야 합니다 (src/lib/supabaseTruncationGuard.ts)`;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  }).catch(() => undefined);
}

function record(url: URL, rows: number): void {
  const { table, query } = describe(url);
  const key = `${table}?${query}`;
  if (seenKeys.has(key)) return;
  seenKeys.add(key);
  const ev = { table, query, rows, at: new Date().toISOString() };
  events.push(ev);
  if (events.length > 200) events.shift();
  console.warn(`[supabaseTruncationGuard] ${table} 응답 ${rows}행 — 잘림 의심: ${query}`);
  void alertAdmin(ev);
}

/** 쿼리 빌더 프로토타입의 then을 감싸 잘림을 기록한다 */
export function installSupabaseTruncationGuard(): void {
  if (installed) return;
  installed = true;
  try {
    const probe = createClient("http://truncation-guard.invalid", "guard-key", {
      auth: { persistSession: false, autoRefreshToken: false },
    })
      .from("probe")
      .select("*") as unknown as object;
    let proto: any = Object.getPrototypeOf(probe);
    while (proto && !Object.prototype.hasOwnProperty.call(proto, "then")) proto = Object.getPrototypeOf(proto);
    if (!proto) return;
    const originalThen = proto.then as (this: any, onF?: any, onR?: any) => Promise<unknown>;
    proto.then = function guardedThen(this: any, onFulfilled?: (v: any) => unknown, onRejected?: (e: unknown) => unknown) {
      const url: URL | undefined = this?.url;
      const method: string | undefined = this?.method;
      return originalThen.call(
        this,
        (res: any) => {
          try {
            if (method === "GET" && url && Array.isArray(res?.data) && isLikelyTruncated(res.data.length, url)) {
              record(url, res.data.length);
            }
          } catch {
            // 감지기는 조회 결과에 영향을 주지 않는다
          }
          return onFulfilled ? onFulfilled(res) : res;
        },
        onRejected
      );
    };
  } catch (e) {
    console.warn("[supabaseTruncationGuard] 설치 실패:", e);
  }
}
