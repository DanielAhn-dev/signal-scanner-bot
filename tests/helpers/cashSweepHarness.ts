import { createCashSweepSteps, type CashSweepDeps, type CashSweepTradeLog } from "../../src/services/virtualAutoTradeCashSweepStep";

// 스윕·지수 모드 매매는 현금(prefs)·포지션·거래기록을 따로 쓴다. DB 트랜잭션이 없으므로
// 중간 단계가 실패해도 "현금 + 포지션" 자산이 어긋나지 않는지를 이 가짜 DB로 검증한다.
// 가짜 supabase는 필터(eq/in/is)를 무시하고 테이블별 고정 행을 돌려준다. 쓰기(insert/update/delete)는 기록만 한다.

export type Write = { table: string; op: "insert" | "update" | "delete"; values?: unknown };

export function createHarness(options: {
  prefs: Record<string, unknown>;
  positions?: Record<string, unknown>[];
  stocks?: Record<string, unknown>[];
  failPositionWrite?: boolean;
  failSetPrefsCall?: number; // n번째(1부터) setPrefs 호출을 실패시킨다
  failTradeLog?: boolean;
}) {
  const prefs = { ...options.prefs };
  const writes: Write[] = [];
  const tradeLogs: CashSweepTradeLog[] = [];
  let setPrefsCalls = 0;

  const supabase = {
    from(table: string) {
      let op: Write["op"] | null = null;
      let values: unknown;
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        is: () => builder,
        maybeSingle: () => builder,
        insert: (v: unknown) => ((op = "insert"), (values = v), builder),
        update: (v: unknown) => ((op = "update"), (values = v), builder),
        delete: () => ((op = "delete"), builder),
        then(resolve: (r: { data: unknown; error: unknown }) => unknown) {
          if (op) {
            if (options.failPositionWrite) return Promise.resolve({ data: null, error: new Error("write failed") }).then(resolve);
            writes.push({ table, op, values });
            return Promise.resolve({ data: null, error: null }).then(resolve);
          }
          const data = table === "stocks" ? options.stocks ?? [] : options.positions ?? [];
          return Promise.resolve({ data, error: null }).then(resolve);
        },
      };
      return builder;
    },
  };

  const deps = {
    getPrefs: async (_chatId: number) => ({ ...prefs }),
    setPrefs: async (_chatId: number, patch: Record<string, number>) => {
      setPrefsCalls += 1;
      if (setPrefsCalls === options.failSetPrefsCall) return { ok: false };
      Object.assign(prefs, patch);
      return { ok: true };
    },
    appendTradeLog: async (log: CashSweepTradeLog) => {
      if (options.failTradeLog) throw new Error("trade log failed");
      tradeLogs.push(log);
    },
    overlayIntradayPrices: async () => 0,
  } satisfies CashSweepDeps;
  const steps = createCashSweepSteps(deps);

  return { steps, deps, supabase, prefs, writes, tradeLogs };
}
